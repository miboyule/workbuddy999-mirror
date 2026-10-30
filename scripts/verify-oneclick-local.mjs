import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { db } from '../server/db.mjs';

const base = 'http://127.0.0.1:8787';
try {
  const rows = await db.query(`SELECT m.code FROM portal_redemption_meta m JOIN tokens t ON m.token_id=t.id
    WHERE m.account_id IS NOT NULL AND m.expires_at>extract(epoch from now())
      AND t.status=1 AND t.remain_quota>0 AND t.deleted_at IS NULL
    ORDER BY m.activated_at DESC LIMIT 1`);
  assert.ok(rows.rowCount, '没有已激活且有效的测试套餐；停止测试以免兑换新码');
  const start = await fetch(base + '/api/portal/oneclick/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: rows.rows[0].code, agreed: true }),
  });
  assert.equal(start.status, 200, '无法启动真实激活码配置');
  const activationURL = (await start.json()).data.url;
  const landing = await fetch(activationURL);
  assert.equal(landing.status, 200, '配置页无法打开');
  const sessionURL = activationURL.replace('/i/', '/api/session/');
  const modelsResponse = await fetch(sessionURL);
  assert.equal(modelsResponse.status, 200, `模型接口未就绪：${modelsResponse.status}`);
  const session = await modelsResponse.json();
  assert.ok(session.models.length > 0, '实际授权模型目录为空');
  const model = session.models.find(item => item.recommended) || session.models[0];
  const task = await fetch(new URL('/api/tasks', activationURL), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activation_code: session.activation_code, model: model.id, clients: ['WorkBuddy'], platform: 'windows' }),
  });
  assert.equal(task.status, 201, `无法生成安装任务：${task.status}`);
  const created = await task.json();
  const resultURL = new URL(`/api/tasks/${created.task_id}/result`, activationURL);
  const pending = await (await fetch(resultURL)).json();
  assert.equal(pending.status, 'pending', '运行脚本前网页不能显示安装完成');
  const cmd = await (await fetch(created.download_cmd_url)).text();
  assert.ok(cmd.includes('WB_PAYLOAD=') && !cmd.includes('CONFIG_URL='), '本地脚本未使用压缩引导器');
  const home = await mkdtemp(join(tmpdir(), 'oneclick-integrated-'));
  const launcher = join(home, 'install.cmd');
  await writeFile(launcher, cmd);
  const launched = spawnSync('cmd.exe', ['/d', '/c', launcher], { encoding: 'utf8', windowsHide: true, timeout: 45000, input: '\n' });
  assert.equal(launched.status, 0, '下载后的 .cmd 脚本运行失败：' + (launched.stdout || launched.stderr || '').slice(-500));
  assert.ok(launched.stdout.includes('隔离测试'), '测试脚本未明确提示真实客户端未重启');
  await mkdir(join(home, '.workbuddy'));
  const binary = join(import.meta.dirname, '..', 'oneclick', 'public', 'bin', 'setup-windows-amd64.exe');
  const installed = spawnSync(binary, ['--config-url', new URL(`/api/tasks/${created.task_id}/config`, activationURL).href, '--home', home, '--no-restart'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(installed.status, 0, '安装器在临时目录中执行失败：' + (installed.stderr || '').slice(0, 300));
  const completed = await (await fetch(resultURL)).json();
  assert.equal(completed.status, 'completed', '安装器未向网页上报结果');
  assert.equal(completed.result.mode, 'sandbox');
  assert.equal(completed.result.success, true);
  assert.equal(completed.result.restart_attempted, false);
  assert.equal(completed.result.model, model.id);
  const settings = JSON.parse(await readFile(join(home, '.workbuddy', 'settings.json'), 'utf8'));
  assert.equal(settings.model, model.id, '默认模型未写入');
  const report = JSON.parse(await readFile(join(home, '.newapi-oneclick', 'last-result.json'), 'utf8'));
  const restored = spawnSync(binary, ['--home', home, '--restore', report.backup_dir], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(restored.status, 0, '恢复配置失败');
  const realTask = await fetch(new URL('/api/tasks', activationURL), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activation_code: session.activation_code, model: model.id, clients: ['WorkBuddy'], platform: 'windows', install_mode: 'real' }),
  });
  assert.equal(realTask.status, 201, '无法生成真实安装脚本');
  const realCreated = await realTask.json();
  assert.equal((await (await fetch(new URL(`/api/tasks/${realCreated.task_id}/result`, activationURL))).json()).status, 'pending', '真实脚本未运行不能显示成功');
  const realScript = await (await fetch(realCreated.download_cmd_url)).text();
  assert.ok(realScript.includes('WB_PAYLOAD=') && realScript.includes('workbuddy999.top'), '真实脚本缺少品牌和压缩标记');
  const realConfig = await (await fetch(new URL(`/api/tasks/${realCreated.task_id}/config`, activationURL))).json();
  assert.equal(realConfig.base_url, 'https://api.workbuddy999.top/v1', '真实客户端 API 地址错误');
  assert.equal(realConfig.restart, true, '真实安装未请求客户端重启');
  console.log(JSON.stringify({ result: 'passed', liveModels: session.models.length, chosenModel: model.id, launcherRan: true, installedAndRestored: true, realScriptReady: true, realScriptNotExecuted: true, isolatedHome: home }));
} finally { await db.end(); }
