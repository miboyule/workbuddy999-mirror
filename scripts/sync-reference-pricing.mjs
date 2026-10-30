import { db } from '../server/db.mjs';
import { modelPrices } from '../shared/model-pricing.mjs';

const apply = process.argv.includes('--apply');
const client = await db.connect();
try {
  await client.query('BEGIN');
  const options = new Map((await client.query("SELECT key,value FROM options WHERE key IN ('ModelRatio','CompletionRatio','ModelPrice') FOR UPDATE")).rows.map(row => [row.key, JSON.parse(row.value || '{}')]));
  const ratio = options.get('ModelRatio') || {};
  const completion = options.get('CompletionRatio') || {};
  const fixed = options.get('ModelPrice') || {};
  const channels = (await client.query("SELECT models FROM channels WHERE name='WorkBuddy' AND status=1")).rows;
  const ids = new Set(channels.flatMap(row => row.models.split(',').map(id => id.trim()).filter(Boolean)));
  const changes = [];
  for (const id of ids) {
    const official = modelPrices.find(row => row.id === id.replace(/^cn:/, ''))?.official;
    const tier = official?.tiers?.[0];
    if (!tier || !Number.isFinite(tier.input) || tier.input <= 0 || !Number.isFinite(tier.output)) continue;
    if (Object.hasOwn(fixed, id)) continue;
    const inputRatio = Number((tier.input / 14).toFixed(8));
    const outputRatio = Number((tier.output / tier.input).toFixed(8));
    if (ratio[id] === inputRatio && completion[id] === outputRatio) continue;
    if (!Object.hasOwn(ratio, id)) ratio[id] = inputRatio;
    if (!Object.hasOwn(completion, id)) completion[id] = outputRatio;
    changes.push({ id, inputCnyPerMillion: tier.input, outputCnyPerMillion: tier.output, ratio: ratio[id], completionRatio: completion[id] });
  }
  const users = (await client.query('SELECT u.id,u.setting FROM users u JOIN portal_accounts a ON a.newapi_id=u.id FOR UPDATE OF u')).rows;
  const changedUsers = [];
  for (const user of users) {
    const setting = user.setting ? JSON.parse(user.setting) : {};
    if (setting.accept_unset_model_ratio_model === true) continue;
    setting.accept_unset_model_ratio_model = true;
    changedUsers.push(user.id);
    if (apply) await client.query('UPDATE users SET setting=$1 WHERE id=$2', [JSON.stringify(setting), user.id]);
  }
  if (apply) {
    for (const [key, value] of [['ModelRatio', ratio], ['CompletionRatio', completion]]) {
      await client.query('INSERT INTO options(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', [key, JSON.stringify(value)]);
    }
    await client.query('COMMIT');
  } else await client.query('ROLLBACK');
  console.log(JSON.stringify({ applied: apply, referencePrices: changes, userIdsToUpdate: changedUsers }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await db.end();
}
