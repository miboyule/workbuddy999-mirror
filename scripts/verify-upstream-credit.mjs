import assert from 'node:assert/strict';
import { db } from '../server/db.mjs';
import { config } from '../server/config.mjs';
import { quotaForPoints } from '../shared/billing.mjs';

const tokenId = Number(process.argv.find(value => value.startsWith('--token-id='))?.split('=')[1]);
if (!Number.isSafeInteger(tokenId) || tokenId <= 0) {
  await db.end();
  throw new Error('请指定内部联调测试密钥：--token-id=数字。测试会产生少量实际消耗。');
}
try {
  const token = (await db.query('SELECT id,key FROM tokens WHERE id=$1 AND deleted_at IS NULL', [tokenId])).rows[0];
  assert.ok(token, '测试密钥不存在');
  for (const stream of [false, true]) {
    const before = (await db.query('SELECT remain_quota FROM tokens WHERE id=$1', [tokenId])).rows[0];
    const lastId = (await db.query('SELECT coalesce(max(id),0) AS id FROM logs')).rows[0].id;
    const response = await fetch(config.upstream + '/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer sk-' + token.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'glm-5.3-flash', messages: [{ role: 'user', content: stream ? '只回复OK' : '校验积分 ' + 'abcdefghij '.repeat(900) + ' 只回复OK' }], max_tokens: 32, stream, ...(stream ? { stream_options: { include_usage: true } } : {}) }),
      signal: AbortSignal.timeout(45000),
    });
    const body = await response.text();
    assert.equal(response.status, 200, '网关返回 HTTP ' + response.status);
    let usage;
    if (stream) {
      for (const line of body.split('\n')) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
        const chunk = JSON.parse(line.slice(6));
        if (chunk.usage?.credit !== undefined) usage = chunk.usage;
      }
    } else usage = JSON.parse(body).usage;
    assert.equal(typeof usage?.credit, 'number', '上游未返回数字 credit');
    const expected = quotaForPoints(usage.credit);
    let log, after;
    for (let attempt = 0; attempt < 40; attempt++) {
      log = (await db.query('SELECT quota,other FROM logs WHERE token_id=$1 AND id>$2 AND type=2 ORDER BY id DESC LIMIT 1', [tokenId, lastId])).rows[0];
      after = (await db.query('SELECT remain_quota FROM tokens WHERE id=$1', [tokenId])).rows[0];
      if (log && Number(before.remain_quota) - Number(after.remain_quota) === expected) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(log, '缺少消费日志');
    const other = JSON.parse(log.other);
    assert.equal(Number(log.quota), expected);
    assert.equal(Number(before.remain_quota) - Number(after.remain_quota), expected);
    assert.equal(other.billing_status, 'settled');
    assert.equal(other.upstream_credit, usage.credit);
    console.log(JSON.stringify({ stream, upstreamCredit: usage.credit, chargedQuota: expected, walletAndLogMatch: true }));
  }
} finally { await db.end(); }
