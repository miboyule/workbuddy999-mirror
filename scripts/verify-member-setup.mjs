import assert from 'node:assert/strict';
import { db } from '../server/db.mjs';
import { decrypt } from '../server/config.mjs';

const base = 'http://127.0.0.1:8787';
try {
  const account = (await db.query(`SELECT m.token_key_enc,m.token_id FROM portal_redemption_meta m
    JOIN tokens t ON t.id=m.token_id WHERE m.token_key_enc IS NOT NULL AND m.expires_at > extract(epoch from now())
    AND t.status=1 AND t.remain_quota>0 ORDER BY m.token_id DESC LIMIT 1`)).rows[0];
  assert.ok(account, 'No active testable membership key');
  const key = decrypt(account.token_key_enc);
  const modelsResponse = await fetch(base + '/v1/models', { headers: { Authorization: 'Bearer ' + key } });
  assert.equal(modelsResponse.status, 200);
  const modelIds = (await modelsResponse.json()).data.map(row => row.id);
  assert.ok(modelIds.length > 20, `Only ${modelIds.length} models visible`);
  const catalog = (await (await fetch(base + '/api/portal/setup/catalog')).json()).data.models;
  assert.ok(catalog.length > 20);
  const ratios = catalog.map(row => row.ratio).filter(value => value !== null);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => a - b));
  const login = await fetch(base + '/api/portal/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credentialType: 'key', credential: key, agreed: true }) });
  assert.equal(login.status, 200, `Member login failed: ${(await login.json()).message || 'unknown'}`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const accountResponse = await fetch(base + '/api/portal/account', { headers: { Cookie: cookie } });
  assert.equal(accountResponse.status, 200, 'Session did not persist');
  const download = await fetch(base + `/api/portal/setup/windows/${account.token_id}`, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200, `Setup download failed: ${download.status === 200 ? '' : (await download.json()).message}`);
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  const launcher = await download.text();
  assert.ok(launcher.includes(Buffer.from(key).toString('base64')));
  assert.ok(!launcher.includes(key));
  const rejected = await fetch(base + `/api/portal/setup/windows/${account.token_id}`);
  assert.equal(rejected.status, 401);
  const options = new Map((await db.query("SELECT key,value FROM options WHERE key IN ('ModelRatio','CompletionRatio')")).rows.map(row => [row.key, JSON.parse(row.value)]));
  assert.ok(Object.keys(options.get('ModelRatio')).length >= 20);
  const badSettings = (await db.query(`SELECT count(*)::int AS count FROM portal_accounts a JOIN users u ON u.id=a.newapi_id
    WHERE coalesce(nullif(u.setting,'')::jsonb->>'accept_unset_model_ratio_model','false') <> 'true'`)).rows[0].count;
  assert.equal(badSettings, 0);
  const logout = await fetch(base + '/api/portal/logout', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal(logout.status, 200);
  console.log(JSON.stringify({ status: 'passed', visibleModels: modelIds.length, catalogModels: catalog.length, referencePricedModels: Object.keys(options.get('ModelRatio')).length, sessionAndDownload: true }));
} finally {
  await db.end();
}
