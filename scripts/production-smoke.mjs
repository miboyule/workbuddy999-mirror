import assert from 'node:assert/strict';
import { db } from '../server/db.mjs';
import { config, decrypt } from '../server/config.mjs';
import { accessFor } from '../server/newapi.mjs';

try {
  const status = await (await fetch(config.upstream + '/api/status')).json();
  assert.equal(status.data?.upstream_credit_billing, true, 'Custom billing gateway must be running');
  const counts = (await db.query(`SELECT
    (SELECT count(*) FROM redemptions) AS redemptions,
    (SELECT count(*) FROM portal_accounts) AS accounts,
    (SELECT count(*) FROM tokens WHERE deleted_at IS NULL) AS tokens,
    (SELECT count(*) FROM logs WHERE type=2) AS successful_logs`)).rows[0];
  const account = (await db.query('SELECT a.* FROM portal_accounts a JOIN users u ON u.id=a.newapi_id WHERE u.status=1 AND u.deleted_at IS NULL ORDER BY a.id DESC LIMIT 1')).rows[0];
  assert.ok(account && decrypt(account.password_enc), 'Migrated account encryption must remain readable');
  assert.ok(await accessFor(account), 'Migrated account must authenticate with NewAPI');
  assert.ok(await accessFor(null), 'Configured administrator must authenticate with NewAPI');
  const channel = (await db.query("SELECT setting FROM channels WHERE name='WorkBuddy' AND status=1")).rows[0];
  assert.ok(JSON.parse(channel.setting).upstream_credit_quota > 0, 'Upstream credit settlement must be configured');
  for (const domain of ['www.workbuddy999.top', 'api.workbuddy999.top', 'yeradminer.workbuddy999.top']) {
    const response = await fetch('https://' + domain + (domain.startsWith('api.') ? '/health' : '/'));
    assert.equal(response.status, 200, domain + ' must return HTTP 200');
  }
  const launcher = await fetch('https://www.workbuddy999.top/setup/workbuddy-setup.cmd');
  assert.equal(launcher.status, 200);
  assert.ok((await launcher.text()).includes('workbuddy-setup.ps1'));
  console.log(JSON.stringify({ status: 'passed', counts, migratedAccountLogin: true, adminLogin: true, publicHttps: true, setupDownload: true }));
} finally {
  await db.end();
}
