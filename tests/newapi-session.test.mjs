import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';

test('upstream sessions coalesce concurrent login, survive restart, and refresh in place', async () => {
  let logins = 0, refreshes = 0;
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain request */ }
    const refresh = req.url === '/api/user/auth/refresh';
    if (refresh) {
      assert.equal(req.headers.cookie, 'new_api_refresh=refresh-1');
      assert.equal(req.headers['x-auth-session'], 'session-1');
      refreshes++;
    } else {
      assert.equal(req.url, '/api/user/login');
      logins++;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'new_api_refresh=refresh-' + (refresh ? 2 : 1) + '; HttpOnly' });
    res.end(JSON.stringify({ success: true, data: { access_token: refresh ? 'access-2' : 'access-1', access_expires_at: Math.floor(Date.now() / 1000) + 60, session: { sid: 'session-1' } } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.NEW_API_URL = 'http://127.0.0.1:' + server.address().port;
  process.env.NEW_API_ADMIN_USERNAME = 'session-test-' + Date.now();
  process.env.NEW_API_ADMIN_PASSWORD = 'test-only';
  const { db } = await import('../server/db.mjs');
  const { decrypt } = await import('../server/config.mjs');
  const key = '__admin:' + process.env.NEW_API_ADMIN_USERNAME;
  try {
    await db.query('CREATE TABLE IF NOT EXISTS portal_upstream_sessions(session_key TEXT PRIMARY KEY,bundle_enc TEXT NOT NULL,access_expires_at BIGINT NOT NULL)');
    const first = await import('../server/newapi.mjs?test=first');
    assert.deepEqual(await Promise.all(Array.from({ length: 12 }, () => first.accessFor(null))), Array(12).fill('access-1'));
    assert.equal(logins, 1);
    const restart = await import('../server/newapi.mjs?test=restart');
    assert.equal(await restart.accessFor(null), 'access-1');
    assert.equal(logins, 1);
    await db.query('UPDATE portal_upstream_sessions SET access_expires_at=0 WHERE session_key=$1', [key]);
    const expired = await import('../server/newapi.mjs?test=expired');
    assert.equal(await expired.accessFor(null), 'access-2');
    assert.equal(logins, 1);
    assert.equal(refreshes, 1);
    const row = (await db.query('SELECT bundle_enc FROM portal_upstream_sessions WHERE session_key=$1', [key])).rows[0];
    assert.equal(JSON.parse(decrypt(row.bundle_enc)).refresh, 'refresh-2');
    assert.ok(!row.bundle_enc.includes('refresh-2'));
  } finally {
    await db.query('DELETE FROM portal_upstream_sessions WHERE session_key=$1', [key]);
    await db.end();
    await new Promise(resolve => server.close(resolve));
  }
});
