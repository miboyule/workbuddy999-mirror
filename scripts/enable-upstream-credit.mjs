import { mkdir, writeFile } from 'node:fs/promises';
import { db } from '../server/db.mjs';
import { config } from '../server/config.mjs';
import { quotaPerPoint } from '../shared/billing.mjs';

const apply = process.argv.includes('--apply');
const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(872003)');
  const channels = (await client.query("SELECT id,name,base_url,models,setting FROM channels WHERE name='WorkBuddy' AND status=1 FOR UPDATE")).rows;
  if (!channels.length) throw new Error('没有找到已启用的 WorkBuddy 渠道，未修改配置。');
  const options = (await client.query('SELECT key,value FROM options')).rows;
  const optionMap = Object.fromEntries(options.map(row => [row.key, row.value]));
  const modelIds = [...new Set(channels.flatMap(row => row.models.split(',')).flatMap(id => [id, id.replace(/^cn:/, ''), 'cn:' + id.replace(/^cn:/, '')]))];
  const updated = {};
  for (const key of ['ModelPrice', 'billing_setting.billing_mode', 'billing_setting.billing_expr']) {
    const values = JSON.parse(optionMap[key] || '{}');
    for (const id of modelIds) delete values[id];
    updated[key] = JSON.stringify(values);
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', channels: channels.map(({ id, name }) => ({ id, name })), modelAliases: modelIds.length, quotaPerPoint, preservesBalancesAndHistory: true }, null, 2));
  if (apply) {
    const response = await fetch(config.upstream + '/api/status', { signal: AbortSignal.timeout(10000) });
    const status = await response.json();
    if (!response.ok || !status.data?.upstream_credit_billing) throw new Error('网关尚未启用 upstream_credit_billing，停止迁移。请先替换定制网关。');
    await mkdir(new URL('../backups/', import.meta.url), { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const snapshot = { createdAt: stamp, channels: channels.map(({ id, setting }) => ({ id, setting })), options: options.filter(row => Object.hasOwn(updated, row.key)) };
    await writeFile(new URL('../backups/upstream-credit-' + stamp + '.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' });
    for (const channel of channels) {
      const setting = JSON.parse(channel.setting || '{}');
      setting.upstream_credit_quota = quotaPerPoint;
      await client.query('UPDATE channels SET setting=$1 WHERE id=$2', [JSON.stringify(setting), channel.id]);
    }
    for (const [key, value] of Object.entries(updated)) await client.query('INSERT INTO options(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
    await client.query("UPDATE models SET description=$1,updated_time=extract(epoch from now())::bigint WHERE model_name=ANY($2::text[]) AND deleted_at IS NULL", ['按上游 usage.credit 实扣积分1:1结算；20积分=¥1面值。模型倍率、缓存及活动已包含在实扣中，不重复收费。', modelIds]);
    await client.query('COMMIT');
    console.log('已启用。请立即重启 NewAPI 刷新渠道和定价缓存；余额及历史记录未改变。');
  } else {
    await client.query('ROLLBACK');
  }
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await db.end();
}
