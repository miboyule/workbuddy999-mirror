import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from './db.mjs';
import { config, PortalError } from './config.mjs';
import { activate, cleanCode, keyFor } from './membership.mjs';
import { redemptionPattern } from '../shared/billing.mjs';
import { setupRanking } from './setup-ranking.mjs';
import { catalogEntries, modelLabel, modelProfile } from '../shared/workbuddy-catalog.mjs';

const root = dirname(fileURLToPath(new URL('../server.mjs', import.meta.url)));
let child;
let internalURL;
let publicBaseURL;
let adminToken;

const oneclickEnabled = () => process.env.ONECLICK_LOCAL_ENABLED === '1' || process.env.ONECLICK_ENABLED === '1';
const localOneclickEnabled = () => process.env.ONECLICK_LOCAL_ENABLED === '1';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

export async function startOneclick() {
  if (!oneclickEnabled()) return;
  if (localOneclickEnabled() && process.env.BIND_HOST !== '127.0.0.1' && process.env.BIND_HOST !== 'localhost') {
    throw new Error('一键安装本地联调只允许 BIND_HOST=127.0.0.1');
  }
  const port = await freePort();
  internalURL = `http://127.0.0.1:${port}`;
  publicBaseURL = localOneclickEnabled()
    ? `http://127.0.0.1:${config.port}`
    : String(process.env.ONECLICK_PUBLIC_BASE_URL || config.publicUrl).replace(/\/$/, '');
  adminToken = randomBytes(32).toString('hex');
  const program = join(root, 'oneclick', 'bin', process.platform === 'win32' ? 'server.exe' : 'server');
  const customersFile = process.env.ONECLICK_CUSTOMERS_FILE || join(root, 'oneclick', 'customers.json');
  child = spawn(program, [], { cwd: join(root, 'oneclick'), env: {
    ...process.env, PORT: String(port), PUBLIC_BASE_URL: publicBaseURL,
    ADMIN_TOKEN: adminToken, CUSTOMERS_FILE: customersFile,
  }, stdio: 'ignore', windowsHide: true });
  child.once('error', error => { console.error('[oneclick] 子服务无法启动:', error.message); });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(internalURL + '/healthz', { signal: AbortSignal.timeout(500) });
      if (response.ok) { console.log('[oneclick] 本地配置助手已就绪'); return; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  child = undefined;
  throw new Error('一键安装子服务启动失败；请检查 oneclick/bin/server 是否已构建');
}

export function stopOneclick() { child?.kill(); }

export async function proxyOneclick(req, res) {
  if (!internalURL || !child || child.exitCode !== null) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: false, message: '本地配置助手未运行，请刷新页面重试' }));
    return;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', abort);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  headers['x-portal-origin-validated'] = '1';
  try {
    const response = await fetch(new URL(req.url, internalURL), {
      method: req.method,
      headers,
      ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: req, duplex: 'half' }),
      signal: controller.signal,
    });
    const responseHeaders = {};
    response.headers.forEach((value, name) => {
      if (!['connection', 'keep-alive', 'transfer-encoding'].includes(name)) responseHeaders[name] = value;
    });
    res.writeHead(response.status, responseHeaders);
    if (response.body) Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
    else res.end();
  } catch (error) {
    if (!res.headersSent && error.name !== 'AbortError') {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: false, message: '本地配置助手连接失败，请刷新页面重试' }));
    }
  } finally {
    req.removeListener('aborted', abort);
    res.removeListener('close', abort);
  }
}

export async function provisionOneclick(rawCode) {
  if (!oneclickEnabled() || !child || child.exitCode !== null) throw new PortalError(503, '一键配置助手未运行');
  const code = cleanCode(rawCode);
  if (!redemptionPattern.test(code)) throw new PortalError(400, '请填写完整兑换码');
  const account = await activate(code);
  const meta = (await db.query('SELECT token_id,expires_at,account_id FROM portal_redemption_meta WHERE code=$1', [code])).rows[0];
  if (!meta || String(meta.account_id) !== String(account.id)) throw new PortalError(403, '兑换码不属于当前账户');
  const key = await keyFor(account, Number(meta.token_id));
  if (Number(meta.expires_at) <= Date.now() / 1000 || Number(key.remain_quota) <= 0 || Number(key.token_status) !== 1 || key.deleted_at) {
    throw new PortalError(403, '兑换码已到期、停用或额度不足');
  }
  const defaultModel = 'deepseek-v4-flash';
  const channels = (await db.query("SELECT models FROM channels WHERE name='WorkBuddy' AND status=1")).rows;
  const models = catalogEntries(channels.flatMap(row => String(row.models || '').split(',').map(id => id.trim()).filter(Boolean)))
    .map(model => ({
      id: model.id, display_name: model.name,
      description: model.ratio === null ? '倍率待核实' : `参考倍率 ${model.ratio.toFixed(2)}x`,
      status: 'available', recommended: model.id === defaultModel,
    }));
  if (!models.some(model => model.id === defaultModel)) {
    models.push({ id: defaultModel, display_name: modelLabel(defaultModel),
      description: `参考倍率 ${modelProfile(defaultModel).ratio.toFixed(2)}x`, status: 'available', recommended: true });
  }
  let ranking = [];
  try { ranking = (await setupRanking()).models; } catch { console.warn('[oneclick] Model ranking temporarily unavailable'); }
  const statsByID = new Map(ranking.map(row => [row.id, row]));
  for (const model of models) { const stats = statsByID.get(model.id); if (stats) Object.assign(model, stats); }
  const payload = {
    customer: '当前兑换码用户', base_url: config.modelApiUrl,
    api_key: key.key, model: defaultModel, display_name: modelLabel(defaultModel),
    models,
    provider_name: 'WBAI微:36612995', verify: true, restart: false,
  };
  const response = await fetch(internalURL + '/admin/ephemeral', {
    method: 'POST', headers: { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new PortalError(502, '创建本地配置任务失败');
  const data = await response.json();
  return { url: data.activation_url, expiresInMinutes: 30 };
}
