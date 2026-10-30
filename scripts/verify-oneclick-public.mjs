// Download production's actual Windows installer; write only to a temporary user directory.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { activationURL } = JSON.parse(await readFile(new URL('../artifacts/oneclick-public-verification.json', import.meta.url), 'utf8'));
const base = new URL(activationURL).origin;
async function request(path, body) {
  const response = await fetch(new URL(path, base), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  assert.ok(response.ok, `${path}: ${response.status}`);
  return response;
}
const session = await (await request(new URL(activationURL).pathname.replace('/i/', '/api/session/'))).json();
assert.ok(session.models.length > 1);
const model = session.models.find(item => item.recommended) || session.models[0];
const second = session.models.find(item => item.id !== model.id);
const options = { activation_code: session.activation_code, model: model.id, models: [model.id, second.id],
  clients: ['WorkBuddy', 'CodeBuddy', 'ZCode', 'DSH', 'Hermes'], platform: 'windows', install_mode: 'sandbox' };
const task = await (await request('/api/tasks', options)).json();
const resultPath = `/api/tasks/${task.task_id}/result`;
assert.equal((await (await request(resultPath)).json()).status, 'pending');
const cmd = await (await request(task.download_cmd_url)).text();
assert.ok(cmd.includes('WB_PAYLOAD=') && !cmd.includes('CONFIG_URL='));
const bytes = Buffer.from(await (await request('/bin/setup-windows-amd64.exe')).arrayBuffer());
const local = await readFile(new URL('../oneclick/public/bin/setup-windows-amd64.exe', import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), createHash('sha256').update(local).digest('hex'), 'Public binary is stale');
const home = await mkdtemp(join(tmpdir(), 'oneclick-production-verified-'));
for (const dir of ['.workbuddy', '.codebuddycn', '.zcode', '.dsh', '.hermes']) await mkdir(join(home, dir));
const old = JSON.stringify([{ id: 'customer-existing', name: 'Keep', url: 'https://foreign.example/v1/chat/completions', apiKey: 'keep' }]);
await writeFile(join(home, '.workbuddy/models.json'), old);
const exe = join(home, 'verified-setup.exe');
await writeFile(exe, bytes);
async function run(args) {
  const child = spawn(exe, args, { windowsHide: true });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const timeout = setTimeout(() => child.kill(), 60000);
  const status = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
  clearTimeout(timeout);
  assert.equal(status, 0, 'Production installer failed in isolated directory');
}
await run(['--config-url', `${base}/api/tasks/${task.task_id}/config`, '--home', home, '--no-restart']);
const result = await (await request(resultPath)).json();
assert.equal(result.result.success, true);
assert.equal(result.result.results.filter(item => item.status === 'configured').length, 5);
assert.equal(result.result.restart_attempted, false);
const models = JSON.parse(await readFile(join(home, '.workbuddy/models.json'), 'utf8'));
assert.equal(models.length, 3);
assert.deepEqual(models[0], JSON.parse(old)[0]);
assert.equal(JSON.parse(await readFile(join(home, '.workbuddy/settings.json'), 'utf8')).model, model.id);
const zcode = JSON.parse(await readFile(join(home, '.zcode/v2/config.json'), 'utf8'));
assert.equal(zcode.provider['newapi-oneclick'].name, 'WBAI微:36612995');
assert.equal(zcode.provider['newapi-oneclick'].models[model.id].name, model.id);
const report = JSON.parse(await readFile(join(home, '.newapi-oneclick/last-result.json'), 'utf8'));
await run(['--home', home, '--restore', report.backup_dir]);
assert.equal(await readFile(join(home, '.workbuddy/models.json'), 'utf8'), old);
const realTask = await (await request('/api/tasks', { ...options, install_mode: 'real' })).json();
const realScript = await (await request(realTask.download_cmd_url)).text();
assert.ok(realScript.includes('WB_PAYLOAD=') && realScript.includes('workbuddy999.top'));
const realConfig = await (await request(`/api/tasks/${realTask.task_id}/config`)).json();
assert.equal(realConfig.restart, true);
assert.equal(realConfig.base_url, 'https://api.workbuddy999.top/v1');
assert.equal(realConfig.models.length, 2);
assert.equal((await (await request(`/api/tasks/${realTask.task_id}/result`)).json()).status, 'pending');
const compressedTask = await (await request('/api/tasks', options)).json();
const compressedScript = await (await request(compressedTask.download_cmd_url)).text();
assert.ok(compressedScript.includes('WB_PAYLOAD=') && !compressedScript.includes('CONFIG_URL='));
const launcher = join(home, 'downloaded-install.cmd');
await writeFile(launcher, compressedScript);
const launched = spawn('cmd.exe', ['/d', '/c', launcher], { windowsHide: true });
let launcherOutput = '';
launched.stdout.on('data', bytes => { launcherOutput += bytes; });
launched.stderr.on('data', bytes => { launcherOutput += bytes; });
launched.stdin.end('\n');
const launcherTimer = setTimeout(() => launched.kill(), 90000);
const launcherExit = await new Promise((done, reject) => { launched.once('error', reject); launched.once('exit', done); });
clearTimeout(launcherTimer);
assert.equal(launcherExit, 0, 'Production compressed launcher failed');
assert.ok(launcherOutput.includes('校验通过') && launcherOutput.includes('隔离测试成功'));
const compressedResult = await (await request(`/api/tasks/${compressedTask.task_id}/result`)).json();
assert.equal(compressedResult.result.success, true);
assert.equal(compressedResult.result.restart_attempted, false);
console.log(JSON.stringify({ status: 'passed', site: base, liveModels: session.models.length,
  publicBinaryMatches: true, selectedModels: options.models, configuredClients: options.clients,
  foreignModelsPreserved: true, resultCallback: true, backupRestored: true,
  realInstallScriptVerified: true, compressedLauncherExecuted: true, realClientRestartNotExecuted: true, isolatedHome: home }));
