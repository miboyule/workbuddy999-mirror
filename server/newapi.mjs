import { config, decrypt, encrypt, PortalError } from './config.mjs';
import { db } from './db.mjs';
const cache = new Map();
const pending = new Map();
async function request(path, options = {}, access = '') {
  const response = await fetch(config.upstream + path, {
    ...options, signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const translations = { 'Invalid token': '密钥无效', 'Token quota is exhausted': '密钥额度不足', 'Redemption code has been used': '兑换码已使用' };
    const error = new PortalError(response.status >= 400 ? response.status : 400, translations[body.message] || body.message || 'NewAPI 暂时不可用');
    error.code = body.code;
    throw error;
  }
  return { data: body.data, response };
}
export async function api(path, options = {}, access = '') { return (await request(path, options, access)).data; }
export async function accessFor(account) {
  const key = account ? account.username : '__admin:' + process.env.NEW_API_ADMIN_USERNAME;
  const saved = cache.get(key);
  if (saved && saved.until > Date.now()) return saved.token;
  if (pending.has(key)) return pending.get(key);
  const work = acquireAccess(key, account);
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
async function acquireAccess(key, account) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(872004,hashtext($1))', [key]);
    const row = (await client.query('SELECT * FROM portal_upstream_sessions WHERE session_key=$1', [key])).rows[0];
    const stored = row ? JSON.parse(decrypt(row.bundle_enc)) : null;
    if (stored?.token && Number(row.access_expires_at) * 1000 > Date.now() + 10000) {
      await client.query('COMMIT');
      cache.set(key, { token: stored.token, until: Number(row.access_expires_at) * 1000 - 10000 });
      return stored.token;
    }
    let result;
    if (stored?.refresh) {
      try {
        result = await request('/api/user/auth/refresh', { method: 'POST', headers: {
          Cookie: 'new_api_refresh=' + stored.refresh,
          Origin: new URL(config.upstream).origin,
          'X-Auth-Session': stored.sid,
        } });
      } catch (error) {
        if (![401, 403, 409].includes(error.status)) throw error;
      }
    }
    if (!result) {
      const username = account?.username || process.env.NEW_API_ADMIN_USERNAME;
      const password = account ? decrypt(account.password_enc) : process.env.NEW_API_ADMIN_PASSWORD;
      result = await request('/api/user/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    }
    const { data, response } = result;
    if (!data?.access_token) throw new PortalError(502, 'NewAPI 未返回登录凭证');
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('new_api_refresh='));
    const refresh = cookie?.split(';')[0].slice('new_api_refresh='.length) || stored?.refresh;
    const expires = Number(data.access_expires_at) || Math.floor(Date.now() / 1000) + 300;
    const bundle = { token: data.access_token, refresh, sid: data.session?.sid || stored?.sid };
    await client.query('INSERT INTO portal_upstream_sessions(session_key,bundle_enc,access_expires_at) VALUES($1,$2,$3) ON CONFLICT(session_key) DO UPDATE SET bundle_enc=excluded.bundle_enc,access_expires_at=excluded.access_expires_at', [key, encrypt(JSON.stringify(bundle)), expires]);
    await client.query('COMMIT');
    cache.set(key, { token: data.access_token, until: expires * 1000 - 10000 });
    return data.access_token;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
export async function userApi(account, path, options = {}) { return api(path, options, await accessFor(account)); }
