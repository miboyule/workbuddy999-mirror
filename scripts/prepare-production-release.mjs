import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(root, 'deploy', 'releases', stamp);
await mkdir(target, { recursive: true });
for (const name of ['dist', 'server.mjs', 'server', 'shared', 'oneclick', 'public', 'package.json', 'package-lock.json']) {
  await cp(path.join(root, name), path.join(target, name), { recursive: true });
}
for (const name of ['scripts', 'src', 'data', 'credit', 'backups', 'docs/legal']) await mkdir(path.join(target, name), { recursive: true });
for (const name of ['privacy-policy.md', 'user-agreement.md']) {
  await cp(path.join(root, 'docs/legal', name), path.join(target, 'docs/legal', name));
}
for (const name of ['news.mjs', 'render-news-page.mjs', 'enable-upstream-credit.mjs', 'verify-upstream-credit.mjs', 'sync-legal.mjs', 'production-smoke.mjs']) {
  await cp(path.join(root, 'scripts', name), path.join(target, 'scripts', name));
}
await cp(path.join(root, 'src/legal.json'), path.join(target, 'src/legal.json'));
await cp(path.join(root, 'data/daily-insights-sources.json'), path.join(target, 'data/daily-insights-sources.json'));
for (const name of ['docker-compose.yml', 'Dockerfile.bff', 'nginx.conf', 'configure-host-nginx.py', 'start-release.sh']) {
  await cp(path.join(root, 'deploy/prod', name), path.join(target, name));
}
for (const name of ['new-api-credit', 'Dockerfile.credit', '.dockerignore']) {
  await cp(path.join(root, 'deploy', name), path.join(target, 'credit', name));
}
await writeFile(path.join(target, '.dockerignore'), ['.env*', 'credit', 'backups', '*.dump', 'dist', 'docker-compose.yml', '.git'].join('\n') + '\n');
process.loadEnvFile(path.join(root, '.env.server'));
const databasePassword = randomBytes(32).toString('hex');
const values = {
  WB_DB_PASSWORD: databasePassword,
  WB_DB_PASSWORD_URL: encodeURIComponent(databasePassword),
  WB_REDIS_PASSWORD: randomBytes(32).toString('hex'),
  WB_SESSION_SECRET: randomBytes(48).toString('hex'),
  PORTAL_SECRET: process.env.PORTAL_SECRET,
  NEW_API_ADMIN_USERNAME: process.env.NEW_API_ADMIN_USERNAME,
  NEW_API_ADMIN_PASSWORD: process.env.NEW_API_ADMIN_PASSWORD,
};
for (const [key, value] of Object.entries(values)) {
  if (!value || /[\r\n]/.test(value)) throw new Error('Missing or invalid environment variable: ' + key);
}
await writeFile(path.join(target, '.env'), Object.entries(values).map(([key, value]) => key + '=' + JSON.stringify(value).replaceAll('$', '$$')).join('\n') + '\n', { mode: 0o600 });
const bundle = await readFile(path.join(target, 'dist/index.html'), 'utf8');
if (!bundle.includes('/assets/')) throw new Error('Missing frontend build');
console.log(JSON.stringify({ release: target, secrets: 'stored separately in .env; do not publish', database: 'fresh snapshot must be added and compared with previous production before restore' }));
