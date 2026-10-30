import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { config, encrypt, monthAfter } from './config.mjs';
export const db = new pg.Pool({ connectionString: config.database, max: 8 });
export async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS portal_accounts (
      id BIGSERIAL PRIMARY KEY, newapi_id BIGINT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL, password_enc TEXT NOT NULL,
      login_name TEXT,
      login_password_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS portal_upstream_sessions (
      session_key TEXT PRIMARY KEY,
      bundle_enc TEXT NOT NULL,
      access_expires_at BIGINT NOT NULL
    );
    ALTER TABLE portal_redemption_meta ADD COLUMN IF NOT EXISTS account_id BIGINT REFERENCES portal_accounts(id);
    ALTER TABLE portal_redemption_meta ADD COLUMN IF NOT EXISTS token_id BIGINT;
    ALTER TABLE portal_redemption_meta ADD COLUMN IF NOT EXISTS token_key_enc TEXT;
    ALTER TABLE portal_redemption_meta ADD COLUMN IF NOT EXISTS amount_cny NUMERIC(12,2);
    CREATE TABLE IF NOT EXISTS portal_sessions (
      id TEXT PRIMARY KEY, account_id BIGINT REFERENCES portal_accounts(id) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, terms_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portal_orders (
      id TEXT PRIMARY KEY, account_id BIGINT REFERENCES portal_accounts(id) NOT NULL,
      points BIGINT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS portal_meta_account ON portal_redemption_meta(account_id);
    ALTER TABLE portal_orders ADD COLUMN IF NOT EXISTS amount_cny NUMERIC(12,2);
    UPDATE portal_redemption_meta SET amount_cny=points/20.0 WHERE amount_cny IS NULL;
    UPDATE portal_orders SET amount_cny=points/20.0 WHERE amount_cny IS NULL;
    ALTER TABLE portal_redemption_meta ALTER COLUMN amount_cny SET NOT NULL;
    ALTER TABLE portal_orders ALTER COLUMN amount_cny SET NOT NULL;
    ALTER TABLE portal_accounts ADD COLUMN IF NOT EXISTS login_name TEXT;
    ALTER TABLE portal_accounts ADD COLUMN IF NOT EXISTS login_password_hash TEXT;
    UPDATE portal_accounts SET login_name=username WHERE login_name IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS portal_accounts_login_name_idx ON portal_accounts(login_name) WHERE login_name IS NOT NULL;
    UPDATE portal_redemption_meta SET validity='激活后一个月' WHERE validity <> '激活后一个月';
  `);
  // Import the previous local proof-of-concept once, retaining ownership and activation dates.
  let previous;
  try { previous = JSON.parse(await readFile(new URL('../data/portal-state.json', import.meta.url), 'utf8')); } catch { return; }
  for (const account of Object.values(previous.accounts || {})) {
    const user = (await db.query('SELECT id FROM users WHERE username=$1', [account.username])).rows[0];
    if (!user) continue;
    await db.query('INSERT INTO portal_accounts(newapi_id,username,password_enc) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [user.id, account.username, encrypt(account.password)]);
    const owner = (await db.query('SELECT id FROM portal_accounts WHERE newapi_id=$1', [user.id])).rows[0];
    for (const row of account.redemptions || []) {
      const activated = Math.floor(new Date(row.time).getTime() / 1000);
      await db.query('UPDATE portal_redemption_meta SET account_id=$1,activated_at=$2,expires_at=$3 WHERE code=$4 AND account_id IS NULL', [owner.id, activated, monthAfter(activated), row.rawCode || account.code]);
    }
  }
}
