// Real downloaded launcher and executable, isolated customer files, no database required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const testHome = await mkdtemp(join(tmpdir(), 'oneclick-verified-'));
const binary = join(root, 'oneclick/public/bin/setup-windows-amd64.exe');
const key = 'test-key-' + randomBytes(8).toString('hex');
const admin = randomBytes(24).toString('hex');
const allClients = ['WorkBuddy', 'CodeBuddy', 'ZCode', 'DSH', 'Hermes'];
const upstream = createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer ' + key) { res.writeHead(401).end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ data: [{ id: 'test-flash' }, { id: 'test-pro' }] }));
});
await new Promise(done => upstream.listen(0, '127.0.0.1', done));
const reserve = createServer();
await new Promise(done => reserve.listen(0, '127.0.0.1', done));
const port = reserve.address().port;
await new Promise(done => reserve.close(done));
const base = `http://127.0.0.1:${port}`;
const api = `http://127.0.0.1:${upstream.address().port}/v1`;
const service = spawn(join(root, 'oneclick/bin/server-local.exe'), [], {
  cwd: join(root, 'oneclick'), windowsHide: true,
  env: { ...process.env, PORT: String(port), PUBLIC_BASE_URL: base, ADMIN_TOKEN: admin,
    CUSTOMERS_FILE: join(testHome, 'customers.json'), ONECLICK_LOCAL_FIXTURES: '0' },
  stdio: 'ignore',
});
async function json(path, body, authorized = false) {
  const response = await fetch(base + path, body ? { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer ' + admin } : {}),
  }, body: JSON.stringify(body) } : undefined);
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
async function run(program, args, expected = 0) {
  const child = spawn(program, args, { windowsHide: true, env: { ...process.env, HERMES_HOME: join(testHome, '.hermes') } });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  child.stdin.end('\n');
  const timer = setTimeout(() => child.kill(), 60000);
  const status = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
  clearTimeout(timer);
  assert.equal(status, expected, output.replaceAll(key, '[hidden]'));
  return output;
}
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch {}
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(ready, 'test service did not start');
  const activation = await json('/admin/ephemeral', {
    schema_version: 1, customer: 'Isolated verification', base_url: api, api_key: key,
    model: 'test-flash', provider_name: 'WBAI微:36612995', verify: true,
  }, true);
  const session = await json('/api/session/' + activation.token);
  assert.equal(session.models.length, 2);
  assert.ok(!JSON.stringify(session).includes(key), 'public session leaked key');
  const task = await json('/api/tasks', { activation_code: session.activation_code, model: 'test-pro',
    models: ['test-flash', 'test-pro'], clients: allClients, install_mode: 'sandbox', platform: 'windows' });
  const resultPath = `/api/tasks/${task.task_id}/result`;
  assert.equal((await json(resultPath)).status, 'pending');
  const script = await (await fetch(task.download_cmd_url)).text();
  assert.ok(!script.includes(key), 'downloaded launcher leaked key');
  const launcher = join(testHome, 'install.cmd');
  await writeFile(launcher, script);
  const output = await run('cmd.exe', ['/d', '/c', launcher]);
  assert.ok(output.includes('隔离测试成功'));
  const completed = await json(resultPath);
  assert.equal(completed.result.success, true);
  assert.equal(completed.result.results.filter(item => item.status === 'configured').length, 5);
  assert.equal(completed.result.restart_attempted, false);

  // Existing foreign provider, unselected owned model and CN variant must survive.
  for (const dir of ['.workbuddy', '.codebuddycn', '.zcode', '.dsh', '.hermes']) await mkdir(join(testHome, dir), { recursive: true });
  const initial = JSON.stringify({ model: 'original', unrelated: true });
  const settingsPath = join(testHome, '.workbuddy/settings.json');
  await writeFile(settingsPath, initial);
  await writeFile(join(testHome, '.workbuddy/models.json'), JSON.stringify([
    { id: 'test-flash', url: api + '/chat/completions', custom: 'keep' },
    { id: 'old-owned', url: api + '/chat/completions' },
    { id: 'foreign', url: 'https://foreign.example/v1/chat/completions', apiKey: 'foreign-key' },
  ]));
  const beforeModels = await readFile(join(testHome, '.workbuddy/models.json'), 'utf8');
  await run(binary, ['--config-url', `${base}/api/tasks/${task.task_id}/config`, '--home', testHome, '--no-restart']);
  const models = JSON.parse(await readFile(join(testHome, '.workbuddy/models.json'), 'utf8'));
  assert.equal(models.length, 4);
  assert.equal(models[0].custom, 'keep');
  assert.equal(models[2].apiKey, 'foreign-key');
  assert.equal(JSON.parse(await readFile(settingsPath, 'utf8')).model, 'test-pro');
  const report = JSON.parse(await readFile(join(testHome, '.newapi-oneclick/last-result.json'), 'utf8'));
  await run(binary, ['--home', testHome, '--restore', report.backup_dir]);
  assert.equal(await readFile(settingsPath, 'utf8'), initial);
  assert.equal(await readFile(join(testHome, '.workbuddy/models.json'), 'utf8'), beforeModels);

  // A late client failure must restore a previously configured client.
  await writeFile(join(testHome, '.codebuddycn/models.json'), JSON.stringify([
    { id: 'test-pro', url: 'https://foreign.example/v1/chat/completions', apiKey: 'keep-foreign' },
  ]));
  const failedTask = await json('/api/tasks', { activation_code: session.activation_code, model: 'test-pro',
    models: ['test-flash', 'test-pro'], clients: ['WorkBuddy', 'CodeBuddy'], install_mode: 'sandbox' });
  await run(binary, ['--config-url', `${base}/api/tasks/${failedTask.task_id}/config`, '--home', testHome, '--no-restart'], 3);
  assert.equal(await readFile(settingsPath, 'utf8'), initial);
  assert.equal(await readFile(join(testHome, '.workbuddy/models.json'), 'utf8'), beforeModels);
  const failed = await json(`/api/tasks/${failedTask.task_id}/result`);
  assert.equal(failed.result.success, false);
  assert.ok(failed.result.results.some(item => item.client === 'WorkBuddy' && item.status === 'restored'));
  console.log(JSON.stringify({ status: 'passed', downloadedLauncherExecuted: true, configuredClients: allClients,
    selectedModels: 2, defaultModel: 'test-pro', additiveMerge: true, resultCallback: true,
    backupRestored: true, multiClientFailureRestored: true, customerFilesUntouched: true, testHome }));
} finally {
  service.kill();
  await new Promise(done => upstream.close(done));
}

