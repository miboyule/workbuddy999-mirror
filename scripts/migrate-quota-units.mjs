import { mkdir, writeFile } from 'node:fs/promises';
import { db, migrate } from '../server/db.mjs';
import { config } from '../server/config.mjs';

const migrationKey = 'portal-points-to-newapi-quota-v1';
const factor = 25000; // Historical v1 only; current units are applied by unify-billing.mjs.
await migrate();

const backupStamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const backupPath = new URL(`../backups/quota-units-before-${backupStamp}.json`, import.meta.url);
const snapshot = {
  migrationKey,
  factor,
  createdAt: new Date().toISOString(),
  redemptions: (await db.query(`
    SELECT trim(m.code) AS code, m.points, r.quota, r.status, r.used_user_id
    FROM portal_redemption_meta m
    LEFT JOIN redemptions r ON trim(r.key)=trim(m.code)
    ORDER BY m.prefix, m.code
  `)).rows,
  accounts: (await db.query(`
    SELECT a.id AS portal_account_id, a.newapi_id, a.username, u.quota, u.used_quota
    FROM portal_accounts a JOIN users u ON u.id=a.newapi_id
    ORDER BY a.id
  `)).rows,
  tokens: (await db.query(`
    SELECT t.id, t.user_id, t.name, t.remain_quota, t.used_quota
    FROM tokens t
    WHERE t.id IN (SELECT token_id FROM portal_redemption_meta WHERE token_id IS NOT NULL)
    ORDER BY t.id
  `)).rows,
};
await mkdir(new URL('../backups/', import.meta.url), { recursive: true });
await writeFile(backupPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(872002)');
  await client.query(`CREATE TABLE IF NOT EXISTS portal_migrations (
    migration_key TEXT PRIMARY KEY,
    factor BIGINT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const existing = (await client.query('SELECT factor FROM portal_migrations WHERE migration_key=$1', [migrationKey])).rows[0];
  if (existing) {
    if (Number(existing.factor) !== factor) throw new Error(`迁移已执行，但单位倍率不一致：${existing.factor} != ${factor}`);
    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'already-applied', migrationKey, factor, backup: backupPath.pathname }, null, 2));
  } else {
    const redemptions = await client.query(`
      UPDATE redemptions r
      SET quota = ROUND(m.points * $1)::bigint
      FROM portal_redemption_meta m
      WHERE trim(r.key)=trim(m.code)
      RETURNING r.key
    `, [factor]);
    const tokens = await client.query(`
      UPDATE tokens t
      SET remain_quota = ROUND(t.remain_quota * $1)::bigint,
          used_quota = ROUND(t.used_quota * $1)::bigint
      WHERE t.id IN (SELECT token_id FROM portal_redemption_meta WHERE token_id IS NOT NULL)
      RETURNING t.id
    `, [factor]);
    const users = await client.query(`
      UPDATE users u
      SET quota = ROUND(u.quota * $1)::bigint,
          used_quota = ROUND(u.used_quota * $1)::bigint
      WHERE u.id IN (SELECT newapi_id FROM portal_accounts)
      RETURNING u.id
    `, [factor]);
    await client.query('INSERT INTO portal_migrations(migration_key,factor) VALUES($1,$2)', [migrationKey, factor]);
    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'applied', migrationKey, factor, redemptions: redemptions.rowCount, tokens: tokens.rowCount, users: users.rowCount, backup: backupPath.pathname }, null, 2));
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await db.end();
}
