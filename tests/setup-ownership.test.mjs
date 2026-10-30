import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

for (const runtime of ['powershell', 'python']) {
  for (const scenario of ['merge-object', 'merge-array', 'foreign-conflict']) {
    test(`${runtime} setup preserves ownership: ${scenario}`, async t => {
      const dir = await mkdtemp(join(tmpdir(), 'setup-ownership-'));
      t.after(() => rm(dir, { recursive: true, force: true }));
      const path = join(dir, 'models.json');
      const server = createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(req.url === '/v1/models'
          ? { data: [{ id: 'selected' }] }
          : { success: true, data: { models: [{ id: 'selected', name: 'WBAI-new' }] } }));
      });
      await new Promise(done => server.listen(0, '127.0.0.1', done));
      t.after(() => new Promise(done => server.close(done)));
      const base = `http://127.0.0.1:${server.address().port}`;
      const models = [
        { id: 'selected', name: 'Old', url: scenario === 'foreign-conflict' ? 'https://other.example/v1/chat/completions' : base + '/v1/chat/completions', custom: 'keep' },
        { id: 'unselected', name: 'WBAI-old', url: base + '/v1/chat/completions' },
        { id: 'foreign', url: 'https://other.example/v1/chat/completions', apiKey: 'foreign-key' },
      ];
      const original = JSON.stringify(scenario === 'merge-array' ? models : { models, untouched: 7 });
      await writeFile(path, original);
      let program, args;
      if (runtime === 'powershell') {
        program = 'powershell.exe';
        args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('public/setup/workbuddy-setup.ps1'), '-ApiUrl', base + '/v1', '-CatalogUrl', base + '/catalog', '-ConfigPath', path];
      } else {
        // Execute the exact macOS script's Python payload, without substituting a reimplementation.
        const shell = await readFile('public/setup/workbuddy-setup.sh', 'utf8');
        const python = shell.split("<<'PY'\n")[1].split('\nPY')[0];
        const script = join(dir, 'setup.py');
        await writeFile(script, python);
        program = 'python';
        args = [script, base + '/v1', 'test-key', path, base + '/catalog'];
      }
      async function run() {
        const child = spawn(program, args, { windowsHide: true, env: { ...process.env, WORKBUDDY_API_KEY: 'test-key', PYTHONIOENCODING: 'utf-8' } });
        let output = '';
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        const status = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done); });
        return { status, output };
      }
      const first = await run();
      if (scenario === 'foreign-conflict') {
        assert.notEqual(first.status, 0, first.output);
        assert.equal(await readFile(path, 'utf8'), original, 'cross-provider collision changed original file');
        return;
      }
      assert.equal(first.status, 0, first.output);
      const second = await run();
      assert.equal(second.status, 0, second.output);
      const saved = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(Array.isArray(saved), scenario === 'merge-array');
      const merged = Array.isArray(saved) ? saved : saved.models;
      assert.equal(merged.length, 3, 'repeat install duplicated or removed models');
      assert.deepEqual(merged.slice(1), models.slice(1), 'unselected/foreign models changed');
      assert.equal(merged[0].name, 'WBAI-new');
      assert.equal(merged[0].custom, 'keep');
      assert.equal(merged[0].apiKey, 'test-key');
      if (!Array.isArray(saved)) assert.equal(saved.untouched, 7);
    });
  }
}
