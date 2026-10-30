import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { catalogEntries, sortedModelIds } from '../shared/workbuddy-catalog.mjs';
import { pricingById } from '../shared/model-pricing.mjs';
import { setupLauncher } from '../src/setup-launcher.mjs';

test('member launchers embed only the selected account key and client', () => {
  const key = 'sk-test-only';
  const encoded = Buffer.from(key).toString('base64');
  for (const platform of ['windows', 'macos']) {
    const launcher = setupLauncher('codebuddy', platform, 'cn', key);
    assert.ok(launcher.includes(encoded));
    assert.ok(launcher.includes('codebuddy-setup'));
    assert.ok(launcher.includes(platform === 'windows' ? '-Region cn' : 'bash "$tmp" cn'));
    assert.ok(!launcher.includes(key));
    assert.ok(!launcher.includes('Read-Host'));
  }
  assert.throws(() => setupLauncher('codebuddy', 'windows', 'cn', ''), /密钥/);
});

test('catalog deduplicates aliases and sorts by published ratio', () => {
  const rows = catalogEntries(['cn:deepseek-v4-pro', 'deepseek-v4-pro', 'glm-5.3-flash', 'hy3', 'unknown']);
  assert.deepEqual(rows.map(row => row.id), ['hy3', 'glm-5.3-flash', 'deepseek-v4-pro', 'unknown']);
  assert.equal(rows[2].name, 'WBAI-d03-0.51x');
  assert.equal(rows[3].ratio, null);
  assert.match(rows[3].name, /^WBAI-u\d{2}-待核实$/);
  assert.deepEqual(sortedModelIds(['cn:unknown', 'unknown']), ['unknown']);
});

test('updated catalog uses WBAI names and only verified legacy ratios', () => {
  const entries = catalogEntries(['glm-5.1', 'glm-5v-turbo', 'kimi-k2.5', 'kimi-k2.6', 'minimax-m2.5', 'minimax-m2.7']);
  const byId = Object.fromEntries(entries.map(entry => [entry.id, entry]));
  assert.equal(byId['glm-5.1'].name, 'WBAI-g04-0.79x');
  assert.equal(byId['glm-5v-turbo'].name, 'WBAI-g05-0.71x');
  for (const id of ['kimi-k2.5', 'kimi-k2.6', 'minimax-m2.5', 'minimax-m2.7']) {
    assert.equal(byId[id].ratio, null);
    assert.match(byId[id].name, /^WBAI-[km]\d{2}-待核实$/);
  }
});

test('catalog covers every live channel model without inventing unknown ratios', () => {
  const ids = ['hy3', 'deepseek-v4.1-flash', 'hy3-x', 'glm-5.3-flash', 'minimax-m3.1-flash', 'space-bunny', 'mimo-v2.6-pro', 'deepseek-v4-flash', 'minimax-m3', 'hy4-preview', 'step-5-preview', 'deepseek-v4-pro', 'kimi-k2.7', 'kimi-k2.8-preview', 'glm-5.2', 'glm-5.3', 'kimi-k3.1-pro', 'kimi-k3-1', 'glm-5.1', 'glm-5v-turbo', 'kimi-k2.5', 'kimi-k2.6', 'minimax-m2.5', 'minimax-m2.7'];
  const rows = catalogEntries(ids);
  assert.equal(rows.length, ids.length);
  const byId = Object.fromEntries(rows.map(row => [row.id, row]));
  for (const row of rows) {
    assert.ok(pricingById[row.id], `Missing price information for ${row.id}`);
    if (row.ratio !== null && row.id !== 'hy3') assert.equal(pricingById[row.id].multiplier, row.ratio, row.id);
  }
  assert.deepEqual([byId['glm-5.1'].ratio, byId['glm-5.1'].maxInputTokens, byId['glm-5.1'].maxOutputTokens], [0.79, 200000, 48000]);
  assert.deepEqual([byId['glm-5v-turbo'].ratio, byId['glm-5v-turbo'].maxOutputTokens], [0.71, 64000]);
  assert.equal(byId['deepseek-v4.1-flash'].ratio, 0.11);
  assert.equal(byId['glm-5.3'].ratio, 0.69);
  assert.equal(byId['glm-5.2'].name, 'WBAI-g01-0.79x');
  assert.equal(new Set(rows.map(row => row.name.split('-')[1])).size, ids.length);
  assert.deepEqual(byId['glm-5.2'].reasoning, { supportedEfforts: ['high', 'xhigh'], defaultEffort: 'high', canDisableThinking: false });
  assert.equal(byId['glm-5.2'].onlyReasoning, true);
  assert.deepEqual(byId['glm-5.1'].reasoning.supportedEfforts, ['medium']);
  assert.deepEqual(byId['minimax-m3.1-flash'].reasoning.supportedEfforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(byId['deepseek-v4-pro'].reasoning, { supportedEfforts: ['high', 'xhigh'], defaultEffort: 'high' });
  assert.deepEqual([byId['kimi-k3.1-pro'].maxInputTokens, byId['kimi-k3.1-pro'].maxOutputTokens], [1000000, 32000]);
  assert.equal(byId['minimax-m3'].maxOutputTokens, 64000);
  for (const id of ['kimi-k2.5', 'kimi-k2.6', 'minimax-m2.5', 'minimax-m2.7']) {
    assert.equal(byId[id].ratio, null);
    assert.match(byId[id].name, /^WBAI-[a-z]\d{2}-待核实$/);
    assert.equal(byId[id].reasoning, undefined);
  }
  assert.equal(byId['kimi-k2.5'].maxInputTokens, null);
  assert.equal(byId['kimi-k2.5'].maxOutputTokens, null);
});

test('Windows setup merges all available models without prompting', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'models.json');
  await writeFile(path, JSON.stringify({ otherSetting: 7, models: [
    { id: 'existing', name: 'Existing' },
    { id: 'old-glm', name: 'QiYueAI-0.79x:glm-5.1', url: 'https://www.workbuddy999.top/v1/chat/completions' },
    { id: 'old-local', name: 'QiYueAI:glm-5v-turbo', url: 'http://localhost:5173/v1/chat/completions' },
    { id: 'external', name: 'QiYueAI-external', url: 'https://other.example/v1/chat/completions' },
  ] }));
  const catalog = catalogEntries(['deepseek-v4-pro', 'hy3', 'glm-5.2', 'unknown']);
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/v1/models'
      ? { data: catalog.map(row => ({ id: row.id })) }
      : { success: true, data: { models: catalog } }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('public/setup/workbuddy-setup.ps1'), '-ApiUrl', base + '/v1', '-CatalogUrl', base + '/catalog', '-ConfigPath', path], {
    env: { ...process.env, WORKBUDDY_API_KEY_B64: Buffer.from('sk-test-only').toString('base64') },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
  assert.equal(code, 0, stderr);
  const raw = await readFile(path);
  assert.equal(raw[0], 123);
  const config = JSON.parse(raw.toString('utf8'));
  assert.equal(config.otherSetting, 7);
  assert.deepEqual(config.models.map(row => row.id), ['hy3', 'deepseek-v4-pro', 'glm-5.2', 'unknown', 'existing', 'old-glm', 'old-local', 'external']);
  assert.equal(config.models[1].apiKey, 'sk-test-only');
  assert.equal(config.models[1].supportsImages, true);
  assert.equal(config.models[2].name, 'WBAI-g01-0.79x');
  assert.deepEqual(config.models[2].reasoning.supportedEfforts, ['high', 'xhigh']);
  assert.equal(config.models[2].onlyReasoning, true);
  assert.equal(config.models[3].supportsImages, undefined);
  assert.ok((await readdir(dir)).some(name => name.endsWith('.backup')));
});

test('CodeBuddy setup accepts the member key without an interactive prompt', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cb-setup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(dir, 'models.json');
  const server = createServer((req, res) => {
    if (req.url !== '/catalog') assert.equal(req.headers.authorization, 'Bearer sk-test-only');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/catalog'
      ? { success: true, data: { models: catalogEntries(['glm-5.2']) } }
      : { data: [{ id: 'glm-5.2' }] }));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('public/setup/codebuddy-setup.ps1'), '-ApiUrl', `http://127.0.0.1:${server.address().port}`, '-CatalogUrl', `http://127.0.0.1:${server.address().port}/catalog`, '-Region', 'cn', '-ConfigPath', configPath], {
    env: { ...process.env, WORKBUDDY_API_KEY_B64: Buffer.from('sk-test-only').toString('base64') },
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
  assert.equal(code, 0, stderr);
  const saved = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')).models[0];
  assert.equal(saved.apiKey, 'sk-test-only');
  assert.equal(saved.name, 'WBAI-g01-0.79x');
  assert.deepEqual(saved.reasoning.supportedEfforts, ['high', 'xhigh']);
});
