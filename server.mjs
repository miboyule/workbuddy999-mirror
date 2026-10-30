import http from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { config, hash, decrypt, PortalError } from './server/config.mjs';
import { db, migrate } from './server/db.mjs';
import { api, userApi } from './server/newapi.mjs';
import { activate, accountData, keyFor, cleanCode, pointsFromQuota } from './server/membership.mjs';
import { updateNews } from './scripts/news.mjs';
import { billing, creditPlans, redemptionPattern } from './shared/billing.mjs';
import { modelPrices } from './shared/model-pricing.mjs';
import { catalogEntries } from './shared/workbuddy-catalog.mjs';
import { startOneclick, stopOneclick, provisionOneclick, proxyOneclick } from './server/oneclick.mjs';
const legalVersion = JSON.parse(await readFile(new URL('./src/legal.json', import.meta.url), 'utf8')).meta.version;
await migrate();
await startOneclick();
const oneclickEnabled = () => process.env.ONECLICK_LOCAL_ENABLED === '1' || process.env.ONECLICK_ENABLED === '1';
const attempts = new Map();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const json = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); };
const ok = (res, data, headers) => json(res, 200, { success: true, data }, headers);
async function bodyOf(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 1024 * 1024) throw new PortalError(413, '请求内容过大'); }
  try { return JSON.parse(text || '{}'); } catch { throw new PortalError(400, '请求格式错误'); }
}
const sessionId = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('wb_session='))?.slice(11) || '';
async function session(req) {
  const account = (await db.query('SELECT a.* FROM portal_sessions s JOIN portal_accounts a ON a.id=s.account_id WHERE s.id=$1 AND s.expires_at>now()', [hash(sessionId(req))])).rows[0];
  if (!account) throw new PortalError(401, '登录状态已失效，请重新输入兑换码');
  return account;
}
function normalizedApiKey(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '').replace(/^sk-/i, '');
}
function sameSecret(left, right) {
  const a = Buffer.from(hash(String(left || '')));
  const b = Buffer.from(hash(String(right || '')));
  return a.length === b.length && timingSafeEqual(a, b);
}
function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}
function passwordMatches(password, encoded) {
  const match = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([^$]+)\$([^$]+)$/.exec(String(encoded || ''));
  if (!match) return false;
  const [, n, r, p, saltText, digestText] = match;
  try {
    const actual = scryptSync(password, Buffer.from(saltText, 'base64url'), 32, { N: Number(n), r: Number(r), p: Number(p) });
    const expected = Buffer.from(digestText, 'base64url');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}
async function accountForLogin(body) {
  // Keep older cached clients compatible: infer the intended mode when they
  // submit a password or an sk- credential without the new discriminator.
  const inferred = body.password ? 'username' : /^\s*sk-/i.test(String(body.credential || body.code || '')) ? 'key' : 'code';
  const type = ['code', 'username', 'key'].includes(body.credentialType) ? body.credentialType : inferred;
  const credential = String(body.credential ?? body.code ?? '').trim();
  if (!credential) throw new PortalError(400, '请输入登录凭据');
  if (type === 'code') return activate(credential);
  if (type === 'username') {
    const account = (await db.query('SELECT * FROM portal_accounts WHERE login_name=$1', [credential])).rows[0];
    const password = String(body.password || '');
    if (!account || !password || !passwordMatches(password, account.login_password_hash)) throw new PortalError(401, '会员名或密码不正确');
    return account;
  }
  const key = normalizedApiKey(credential);
  const row = (await db.query(`SELECT a.* FROM tokens t JOIN portal_accounts a ON a.newapi_id=t.user_id
    WHERE t.key=$1 AND t.deleted_at IS NULL AND t.status=1
      AND (t.expired_time=-1 OR t.expired_time>extract(epoch from now())::bigint)
      AND (t.unlimited_quota=true OR t.remain_quota>0) LIMIT 1`, [key])).rows[0];
  if (!row) throw new PortalError(401, 'API 密钥无效、已停用、已到期或额度不足');
  return row;
}
async function loginSession(req, res, account) {
  const sid = randomBytes(32).toString('hex');
  await db.query('DELETE FROM portal_sessions WHERE id=$1 OR expires_at<now()', [hash(sessionId(req))]);
  await db.query("INSERT INTO portal_sessions(id,account_id,expires_at,terms_version) VALUES($1,$2,now()+interval '7 days',$3)", [hash(sid), account.id, legalVersion]);
  return ok(res, await accountData(account), { 'Set-Cookie': `wb_session=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${config.publicUrl.startsWith('https:') ? '; Secure' : ''}` });
}
function limit(req) {
  const key = req.socket.remoteAddress;
  const current = attempts.get(key);
  const entry = current && current.until > Date.now() ? current : { count: 0, until: Date.now() + 900000 };
  attempts.set(key, entry);
  if (++entry.count > 40) throw new PortalError(429, '尝试次数过多，请稍后再试');
}
let wallpaper;
async function getWallpaper() {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  if (wallpaper?.date === date) return wallpaper;
  try {
    const response = await fetch('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN', { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    const item = data.images?.[0];
    if (item?.url?.startsWith('/')) wallpaper = { date, url: 'https://www.bing.com' + item.url, copyright: item.copyright };
  } catch {}
  return wallpaper || { date, url: null };
}
async function relay(req, res, url) {
  let key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const redemptionCode = cleanCode(key);
  if (redemptionPattern.test(redemptionCode)) {
    limit(req);
    await activate(redemptionCode);
    const row = (await db.query('SELECT token_key_enc,expires_at FROM portal_redemption_meta WHERE code=$1', [redemptionCode])).rows[0];
    if (Number(row.expires_at) <= nowSeconds()) throw new PortalError(403, '套餐已到期，请充值新的兑换码');
    key = decrypt(row.token_key_enc);
  }
  if (!key) throw new PortalError(401, '请提供 API Key 或兑换码');
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const upstream = await fetch(config.upstream + url.pathname + url.search, {
    method: req.method,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': req.headers['content-type'] || 'application/json', Accept: req.headers.accept || 'application/json' },
    ...(req.method === 'GET' ? {} : { body: req, duplex: 'half' }),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]),
  });
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (path.startsWith('/v1/')) return relay(req, res, url);
  const localOneclickOrigin = process.env.ONECLICK_LOCAL_ENABLED === '1' && isLocalOneclickOrigin(req.headers.origin);
  if (req.method !== 'GET' && ((req.headers.origin && !config.origins.includes(req.headers.origin) && !localOneclickOrigin) || (req.headers['sec-fetch-site'] === 'cross-site' && !localOneclickOrigin))) throw new PortalError(403, '不允许跨站提交');
  if (oneclickEnabled() && (path === '/setup' || path === '/setup/')) {
    if (req.method !== 'GET') throw new PortalError(405, '请求方式无效');
    return proxyOneclick(req, res);
  }
  if (oneclickEnabled() && path === '/api/portal/oneclick/start' && req.method === 'POST') {
    limit(req);
    const body = await bodyOf(req);
    if (body.agreed !== true) throw new PortalError(400, '请确认激活兑换码并了解本地测试不会改动真实客户端');
    return ok(res, await provisionOneclick(body.code));
  }
  if (oneclickEnabled() && isOneclickProxyPath(path)) return proxyOneclick(req, res);
  if (path === '/health') { await db.query('SELECT 1'); return ok(res, { database: true, upstream: (await api('/api/status'))?.version }); }
  if (path === '/api/portal/config') return ok(res, { wechatEnabled: false, baseUrl: config.modelApiUrl, shopUrl: 'https://wzyp.cn/shop/qiyue888', billing, plans: creditPlans });
  if (path === '/api/portal/pricing' && req.method === 'GET') return ok(res, { billing, models: modelPrices });
  if (path === '/api/portal/setup/catalog' && req.method === 'GET') {
    const channels = (await db.query("SELECT models FROM channels WHERE name='WorkBuddy' AND status=1")).rows;
    return ok(res, { models: catalogEntries(channels.flatMap(row => row.models.split(','))) });
  }
  if (path === '/api/portal/wallpaper' && req.method === 'GET') return ok(res, await getWallpaper());
  if (path === '/api/portal/news' && req.method === 'GET') return ok(res, JSON.parse(await readFile(new URL('./public/daily-insights.json', import.meta.url), 'utf8')));
  if (path === '/api/portal/login' && req.method === 'POST') {
    limit(req);
    const body = await bodyOf(req);
    if (body.agreed !== true) throw new PortalError(400, '请先阅读并同意用户协议和隐私政策');
    const account = await accountForLogin(body);
    return loginSession(req, res, account);
  }
  if (path === '/api/portal/logout' && req.method === 'POST') {
    await db.query('DELETE FROM portal_sessions WHERE id=$1', [hash(sessionId(req))]);
    return ok(res, null, { 'Set-Cookie': 'wb_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (path === '/api/portal/wechat/start') throw new PortalError(503, '微信扫码登录待接入微信开放平台，请先使用兑换码登录');
  if (!path.startsWith('/api/portal/')) throw new PortalError(404, '接口不存在');
  const account = await session(req);
  const setupMatch = path.match(/^\/api\/portal\/setup\/windows\/(\d+)$/);
  if (setupMatch && req.method === 'GET') {
    const meta = await keyFor(account, Number(setupMatch[1]));
    if (meta.deleted_at || Number(meta.expires_at) <= nowSeconds() || Number(meta.remain_quota) <= 0 || Number(meta.token_status) !== 1) throw new PortalError(400, '请选择有效套餐密钥');
    const encoded = Buffer.from(meta.key, 'utf8').toString('base64');
    const launcher = `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "WORKBUDDY_API_URL=${config.modelApiUrl}"\r\nset "WORKBUDDY_API_KEY_B64=${encoded}"\r\nset "WB_SETUP_PS1=%TEMP%\\workbuddy-setup-%RANDOM%.ps1"\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri 'https://www.workbuddy999.top/setup/workbuddy-setup.ps1' -OutFile $env:WB_SETUP_PS1"\r\nif errorlevel 1 goto fail\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%WB_SETUP_PS1%"\r\nset "WB_SETUP_EXIT=%ERRORLEVEL%"\r\ndel /q "%WB_SETUP_PS1%" 2>nul\r\npause\r\nexit /b %WB_SETUP_EXIT%\r\n:fail\r\necho Failed to download WorkBuddy setup script.\r\npause\r\nexit /b 1\r\n`;
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="workbuddy-setup.cmd"', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(launcher);
    return;
  }
  if (path === '/api/portal/account' && req.method === 'GET') return ok(res, await accountData(account));
  if (path === '/api/portal/profile' && req.method === 'POST') {
    const body = await bodyOf(req);
    const loginName = String(body.loginName || '').trim();
    const password = String(body.password || '');
    if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(loginName)) throw new PortalError(400, '会员名需为3-32位中文、字母、数字、下划线或短横线');
    if (password.length < 8 || password.length > 128) throw new PortalError(400, '会员密码需为8-128位');
    const existing = (await db.query('SELECT id FROM portal_accounts WHERE login_name=$1 AND id<>$2', [loginName, account.id])).rows[0];
    if (existing) throw new PortalError(409, '该会员名已被使用');
    await db.query('UPDATE portal_accounts SET login_name=$1,login_password_hash=$2 WHERE id=$3', [loginName, passwordHash(password), account.id]);
    return ok(res, { loginName });
  }
  if (path === '/api/portal/redeem' && req.method === 'POST') { await activate((await bodyOf(req)).code, account); return ok(res, await accountData(account)); }
  if (path === '/api/portal/orders' && req.method === 'POST') {
    const points = Number((await bodyOf(req)).points);
    const plan = creditPlans.find(plan => plan.points === points);
    if (!plan) throw new PortalError(400, '请选择有效套餐');
    const id = 'WB' + Date.now() + randomBytes(3).toString('hex');
    await db.query("INSERT INTO portal_orders(id,account_id,points,amount_cny,status) VALUES($1,$2,$3,$4,'已前往商城')", [id, account.id, points, plan.amountCny]);
    return ok(res, { id, points, amount: plan.amountCny, amountType: 'face', status: '已前往商城', checkoutUrl: 'https://wzyp.cn/shop/qiyue888' });
  }
  if (path === '/api/portal/usage' && req.method === 'GET') {
    const query = new URLSearchParams();
    for (const name of ['p','page_size','model_name','start_timestamp','end_timestamp','type']) if (url.searchParams.has(name)) query.set(name, url.searchParams.get(name));
    return ok(res, await userApi(account, '/api/log/self?' + query));
  }
  if (path === '/api/portal/dashboard' && req.method === 'GET') {
    const end = nowSeconds();
    const days = [1,7,30].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 7;
    const query = `start_timestamp=${end - days * 86400}&end_timestamp=${end}`;
    const [stats, series] = await Promise.all([userApi(account, '/api/log/self/stat?' + query), userApi(account, '/api/data/self?' + query)]);
    return ok(res, {
      stats: stats ? { ...stats, quota: pointsFromQuota(stats.quota) } : stats,
      series: Array.isArray(series) ? series.map(row => ({ ...row, quota: pointsFromQuota(row.quota) })) : series,
      days,
    });
  }
  const keyMatch = path.match(/^\/api\/portal\/keys\/(\d+)\/(reveal|status)$/);
  if (keyMatch && req.method === 'POST') {
    const meta = await keyFor(account, Number(keyMatch[1]));
    if (keyMatch[2] === 'reveal') return ok(res, { key: meta.key });
    const { enabled } = await bodyOf(req);
    if (typeof enabled !== 'boolean') throw new PortalError(400, '密钥状态格式错误');
    if (enabled && Number(meta.expires_at) <= nowSeconds()) throw new PortalError(400, '已到期套餐不能重新启用');
    await userApi(account, '/api/token/?status_only=true', { method: 'PUT', body: JSON.stringify({ id: Number(meta.token_id), status: enabled ? 1 : 2 }) });
    return ok(res, null);
  }
  throw new PortalError(404, '接口不存在');
}

function isOneclickProxyPath(path) {
  return path === '/brand/clients/workbuddy.svg' || path === '/healthz' || path === '/api/tasks' || path.startsWith('/i/') || path.startsWith('/api/session/') || path.startsWith('/api/tasks/') || path.startsWith('/api/models') || path === '/api/model-check' || path.startsWith('/download/task/') || path.startsWith('/bin/');
}

function isLocalOneclickOrigin(origin) {
  if (!origin || process.env.ONECLICK_LOCAL_ENABLED !== '1') return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) && [String(config.port), '4184'].includes(parsed.port);
  } catch {
    return false;
  }
}
const server = http.createServer((req, res) => handle(req, res).catch(error => {
  if (res.headersSent) return res.destroy();
  const status = error.status || 502;
  const message = error.status ? error.message : '服务暂时不可用，请稍后重试';
  if (!error.status) console.error('[portal]', error.message);
  json(res, status, { success: false, message, ...(req.url.startsWith('/v1/') ? { error: { message, type: 'portal_error' } } : {}) });
}));
server.listen(config.port, process.env.BIND_HOST || '0.0.0.0', () => console.log(`WorkBuddy portal ready: http://${process.env.BIND_HOST || '0.0.0.0'}:${config.port}`));
setInterval(() => { for (const [key, value] of attempts) if (value.until < Date.now()) attempts.delete(key); }, 60000).unref();
const shutdown = () => { stopOneclick(); server.close(() => db.end().then(() => process.exit(0))); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
let newsBusy = false;
async function refreshDailyNews() {
  if (newsBusy) return;
  const date = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai' });
  const today = date.format(new Date());
  let last;
  try { last = JSON.parse(await readFile(new URL('./public/daily-insights.json', import.meta.url), 'utf8')).updatedAt; } catch {}
  if (last && date.format(new Date(last)) === today) return;
  newsBusy = true;
  try { await updateNews(); console.log('[news] Updated Chinese headlines'); }
  catch (error) { console.error('[news]', error.message); }
  finally { newsBusy = false; }
}
refreshDailyNews();
setInterval(refreshDailyNews, 3600000).unref();
