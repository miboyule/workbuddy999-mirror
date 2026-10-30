import { createHmac } from 'node:crypto';
import { db } from './db.mjs';
import { api, accessFor, userApi } from './newapi.mjs';
import { config, encrypt, decrypt, hash, monthAfter, PortalError } from './config.mjs';
import { redemptionPattern, quotaForPoints, pointsFromQuota } from '../shared/billing.mjs';
export { quotaForPoints, pointsFromQuota } from '../shared/billing.mjs';
export const cleanCode = value => String(value || '').trim().toLowerCase();
const mask = code => code.slice(0, code.indexOf('-') + 5) + '••••' + code.slice(-4);
export async function activate(raw, owner = null) {
  const code = cleanCode(raw);
  if (!redemptionPattern.test(code)) throw new PortalError(400, '请填写完整兑换码，例如 wb1k-加16位兑换串');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const meta = (await client.query('SELECT * FROM portal_redemption_meta WHERE code=$1 FOR UPDATE', [code])).rows[0];
    if (!meta) throw new PortalError(400, '兑换码无效');
    let account = meta.account_id ? (await client.query('SELECT * FROM portal_accounts WHERE id=$1', [meta.account_id])).rows[0] : owner;
    if (owner && meta.account_id && String(meta.account_id) !== String(owner.id)) throw new PortalError(409, '此兑换码已经绑定其他账户');
    if (owner && meta.account_id && meta.token_id) throw new PortalError(409, '此兑换码已经兑换，请勿重复提交');
    if (!account) {
      const username = 'wb_' + hash(code).slice(0, 15) + 'x';
      const existing = (await client.query('SELECT * FROM portal_accounts WHERE username=$1', [username])).rows[0];
      if (existing) account = existing;
      else {
        const password = createHmac('sha256', process.env.PORTAL_SECRET).update(code).digest('base64url');
        const user = (await client.query('SELECT id FROM users WHERE username=$1', [username])).rows[0];
        if (!user) await api('/api/user/', { method: 'POST', body: JSON.stringify({ username, password, role: 1, display_name: 'WorkBuddy 会员' }) }, await accessFor(null));
        const id = (await client.query('SELECT id FROM users WHERE username=$1', [username])).rows[0]?.id;
        if (!id) throw new PortalError(502, '会员账户创建失败，请重试');
        // Previous prototype accounts used a deterministic local password.
        let actualPassword = password;
        if (user) {
          try { await api('/api/user/login', { method:'POST', body:JSON.stringify({ username, password }) }); }
          catch {
            const { createHash } = await import('node:crypto');
            actualPassword = createHash('sha256').update(code + ':workbuddy-local-account').digest('base64url').slice(0, 32);
            await api('/api/user/login', { method:'POST', body:JSON.stringify({ username, password:actualPassword }) });
          }
        }
        account = (await client.query('INSERT INTO portal_accounts(newapi_id,username,password_enc,login_name) VALUES($1,$2,$3,$2) RETURNING *', [id, username, encrypt(actualPassword)])).rows[0];
      }
    }
    let redemption = (await client.query('SELECT status,used_user_id,redeemed_time FROM redemptions WHERE key=$1', [code])).rows[0];
    if (!redemption) throw new PortalError(400, 'NewAPI 中不存在此兑换码');
    if (Number(redemption.status) === 3 && String(redemption.used_user_id) !== String(account.newapi_id)) throw new PortalError(409, '此兑换码已经使用');
    if (Number(redemption.status) !== 3) {
      await userApi(account, '/api/user/topup', { method: 'POST', body: JSON.stringify({ key: code }) });
      redemption = (await client.query('SELECT status,used_user_id,redeemed_time FROM redemptions WHERE key=$1', [code])).rows[0];
    }
    const activated = Number(meta.activated_at) || Number(redemption.redeemed_time);
    const expires = monthAfter(activated);
    if (!meta.token_id) {
      const name = 'WB-' + hash(code).slice(0, 20);
      let token = (await client.query('SELECT id FROM tokens WHERE user_id=$1 AND name=$2 AND deleted_at IS NULL', [account.newapi_id, name])).rows[0];
      if (!token) {
        await userApi(account, '/api/token/', { method: 'POST', body: JSON.stringify({ name, remain_quota: quotaForPoints(meta.points), unlimited_quota: false, expired_time: expires, group: '', model_limits_enabled: false }) });
        token = (await client.query('SELECT id FROM tokens WHERE user_id=$1 AND name=$2 AND deleted_at IS NULL', [account.newapi_id, name])).rows[0];
      }
      if (!token) throw new PortalError(502, '模型密钥生成失败，请重试，不会重复充值');
      const full = await userApi(account, `/api/token/${token.id}/key`, { method: 'POST', body: '{}' });
      await client.query('UPDATE portal_redemption_meta SET account_id=$1,token_id=$2,token_key_enc=$3,activated_at=$4,expires_at=$5 WHERE code=$6', [account.id, token.id, encrypt('sk-' + full.key.replace(/^sk-/, '')), activated, expires, code]);
    }
    await client.query('COMMIT');
    return account;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function hydrateLegacy(account) {
  const rows = (await db.query('SELECT code FROM portal_redemption_meta WHERE account_id=$1 AND token_id IS NULL', [account.id])).rows;
  for (const row of rows) await activate(row.code.trim());
}
export async function accountData(account) {
  await hydrateLegacy(account);
  const [self, packages, logs, topups, orders, available] = await Promise.all([
    userApi(account, '/api/user/self'),
    db.query(`SELECT m.*,t.remain_quota,t.used_quota,t.status AS token_status,t.name AS token_name,t.deleted_at FROM portal_redemption_meta m LEFT JOIN tokens t ON t.id=m.token_id WHERE m.account_id=$1 ORDER BY m.activated_at DESC`, [account.id]),
    userApi(account, '/api/log/self?p=1&page_size=100&type=0'),
    userApi(account, '/api/user/topup/self?p=1&page_size=100'),
    db.query('SELECT * FROM portal_orders WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100', [account.id]),
    userApi(account, '/api/user/models'),
  ]);
  const now = Date.now() / 1000;
  const redemptions = packages.rows.map(row => ({ id: String(row.token_id), code: mask(row.code.trim()), points: Number(row.points), amountCny: Number(row.amount_cny), time: new Date(Number(row.activated_at) * 1000).toISOString(), activatedAt: Number(row.activated_at), expiresAt: Number(row.expires_at), status: Number(row.expires_at) <= now ? '已到期' : '已兑换', remaining: pointsFromQuota(row.remain_quota), used: pointsFromQuota(row.used_quota) }));
  const usage = (logs?.items || []).filter(row => [2, 5].includes(row.type)).map(row => {
    let other = {}; try { other = JSON.parse(row.other || '{}'); } catch {}
    const pending = other.billing_mode === 'upstream_credit' && other.billing_status !== 'settled';
    const chargedPoints = other.billing_mode === 'upstream_credit' && Number.isFinite(other.upstream_credit) && other.upstream_credit >= 0 ? other.upstream_credit : pointsFromQuota(row.quota);
    return { id: row.id, model: row.model_name, points: pending ? null : chargedPoints, reservedPoints: pending ? pointsFromQuota(row.quota) : 0, upstreamCredit: other.upstream_credit ?? null, billingMode: other.billing_mode || 'legacy', billingStatus: pending ? 'pending' : 'settled', input: row.prompt_tokens, output: row.completion_tokens, cache: other.cache_tokens || other.cached_tokens || 0, duration: row.use_time, time: new Date(row.created_at * 1000).toISOString(), status: row.type === 5 ? '失败' : pending ? '待核对' : '成功' };
  });
  const activePackageQuota = packages.rows.filter(row => Number(row.expires_at) > now && !row.deleted_at).reduce((sum, row) => sum + Math.max(0, Number(row.remain_quota || 0)), 0);
  return {
    balance: Math.min(pointsFromQuota(self.quota), pointsFromQuota(activePackageQuota)),
    username: self.username, loginName: account.login_name || self.username, redemptions, usage, usageTotal: logs?.total || 0,
    totals: { used: pointsFromQuota(self.used_quota), requests: self.request_count || 0 },
    models: Array.isArray(available) ? available : [],
    keys: packages.rows.map(row => ({ id: Number(row.token_id), name: row.label, code: mask(row.code.trim()), key: 'sk-••••••••', remaining: pointsFromQuota(row.remain_quota), used: pointsFromQuota(row.used_quota), expiresAt: Number(row.expires_at), status: Number(row.expires_at) <= now ? '已到期' : row.deleted_at ? '已删除' : Number(row.token_status) === 2 ? '已停用' : Number(row.remain_quota) <= 0 ? '已用尽' : '已启用' })),
    orders: [...(topups?.items || []).map(row => ({ id: row.trade_no, points: pointsFromQuota(row.amount), amount: row.money, amountType: 'paid', method: row.payment_method, status: row.status, time: new Date(row.create_time * 1000).toISOString() })), ...orders.rows.map(row => ({ id: row.id, points: Number(row.points), amount: Number(row.amount_cny), amountType: 'face', method: 'shop', status: row.status, time: row.created_at }))],
    redeemed: redemptions.map(row => row.code),
  };
}
export async function keyFor(account, id) {
  const row = (await db.query('SELECT m.*,t.remain_quota,t.status AS token_status,t.deleted_at FROM portal_redemption_meta m JOIN tokens t ON t.id=m.token_id WHERE m.account_id=$1 AND m.token_id=$2', [account.id, id])).rows[0];
  if (!row) throw new PortalError(404, '密钥不存在');
  return { ...row, key: decrypt(row.token_key_enc) };
}
