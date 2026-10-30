import assert from 'node:assert/strict';
import { db } from '../server/db.mjs';
import { decrypt } from '../server/config.mjs';

try {
  const account = (await db.query(`SELECT m.token_key_enc,t.user_id FROM portal_redemption_meta m
    JOIN tokens t ON t.id=m.token_id WHERE m.token_key_enc IS NOT NULL AND m.expires_at>extract(epoch from now())
    AND t.status=1 AND t.remain_quota>0 ORDER BY m.token_id DESC LIMIT 1`)).rows[0];
  assert.ok(account);
  const before = Number((await db.query('SELECT coalesce(max(id),0) AS id FROM logs WHERE user_id=$1', [account.user_id])).rows[0].id);
  const response = await fetch('http://127.0.0.1:8787/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + decrypt(account.token_key_enc), 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, stream: false }),
    signal: AbortSignal.timeout(60000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, result.error?.message || result.message || 'Model request failed');
  const credit = Number(result.usage?.credit);
  assert.ok(Number.isFinite(credit) && credit >= 0, 'Upstream credit missing');
  let log;
  for (let attempt = 0; attempt < 15; attempt++) {
    log = (await db.query('SELECT id,other FROM logs WHERE user_id=$1 AND id>$2 AND type=2 ORDER BY id DESC LIMIT 1', [account.user_id, before])).rows[0];
    if (log) break;
    await new Promise(done => setTimeout(done, 500));
  }
  assert.ok(log, 'Usage log missing');
  const billed = Number(JSON.parse(log.other || '{}').upstream_credit);
  assert.ok(Math.abs(credit - billed) < 0.000001, `Credit mismatch: upstream ${credit}, billed ${billed}`);
  console.log(JSON.stringify({ status: 'passed', upstreamCredit: credit, billedCredit: billed, model: 'deepseek-v4-pro' }));
} finally {
  await db.end();
}
