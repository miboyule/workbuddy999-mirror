// Run inside the BFF container. Reuses an already activated, valid entitlement.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { db } from '../server/db.mjs';

try {
  const rows = await db.query(`SELECT m.code FROM portal_redemption_meta m JOIN tokens t ON m.token_id=t.id
    WHERE m.account_id IS NOT NULL AND m.expires_at>extract(epoch from now())
      AND t.status=1 AND t.remain_quota>0 AND t.deleted_at IS NULL
    ORDER BY m.activated_at ASC LIMIT 1`);
  assert.ok(rows.rowCount, 'No existing active entitlement available; no new code will be redeemed');
  const response = await fetch('http://127.0.0.1:8787/api/portal/oneclick/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: rows.rows[0].code, agreed: true }),
  });
  assert.equal(response.status, 200, 'Existing entitlement could not open setup');
  const { data } = await response.json();
  assert.ok(data.url.startsWith('https://www.workbuddy999.top/i/'));
  const landing = await fetch(data.url);
  assert.equal(landing.status, 200);
  const html = await landing.text();
  assert.ok(html.includes('name="installMode"') && html.includes('已恢复原配置'));
  const session = await (await fetch(data.url.replace('/i/', '/api/session/'))).json();
  assert.ok(session.models.length > 1);
  assert.equal(session.provider_name, 'WBAI微:36612995');
  assert.ok(session.models.some(item => item.display_name.startsWith('WBAI-')));
  const ranked = session.models.filter(item => item.popularity_rank > 0);
  assert.ok(ranked.length > 0, 'NewAPI ranking was not passed to setup');
  assert.ok(ranked.every(item => item.popularity_stars >= 1 && item.popularity_stars <= 5 && item.sample_count > 0));
  assert.ok(ranked.some(item => item.latency_ms > 0 && item.speed_stars > 0));
  const setup = await (await fetch('https://www.workbuddy999.top/setup/')).text();
  assert.ok(setup.includes('id="activationForm"') && setup.includes('id="clientGrid"') && !setup.includes('下一步'));
  const logo = await fetch('https://www.workbuddy999.top/brand/clients/workbuddy.svg');
  assert.equal(logo.status, 200);
  assert.ok(logo.headers.get('content-type').includes('image/svg+xml'));
  const release = await (await fetch('https://www.workbuddy999.top/bin/releases.json')).json();
  const windows = release.files.find(item => item.name === 'setup-windows-amd64.exe');
  assert.ok(windows.size < 6943232 && windows.archive_size < 2800000);
  await writeFile('/tmp/oneclick-public-verification.json', JSON.stringify({ activationURL: data.url }), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'passed', publicLanding: true, realModels: session.models.length,
    providerName: session.provider_name, rankedModels: ranked.length, singlePage: true, windowsBytes: windows.size,
    downloadBytes: windows.archive_size, usesExistingActivatedCode: true, newRedemption: false,
    verificationFile: '/tmp/oneclick-public-verification.json' }));
} finally { await db.end(); }
