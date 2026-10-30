// Update only the two legal settings via NewAPI so its in-memory cache is current.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { api, accessFor } from '../server/newapi.mjs';

const documents = [
  { key: 'legal.user_agreement', endpoint: '/api/user-agreement', file: '../docs/legal/user-agreement.md' },
  { key: 'legal.privacy_policy', endpoint: '/api/privacy-policy', file: '../docs/legal/privacy-policy.md' },
];
const admin = await accessFor(null);
const before = {};
for (const doc of documents) {
  doc.content = await readFile(new URL(doc.file, import.meta.url), 'utf8');
  if (!doc.content.trim() || /【|tokenhub\.wetok\.ai|运营主体全称/.test(doc.content)) throw new Error('文稿为空或存在占位内容');
  before[doc.key] = await api(doc.endpoint);
}
const backup = new URL('../backups/legal-newapi-' + Date.now() + '.json', import.meta.url);
await mkdir(new URL('../backups/', import.meta.url), { recursive: true });
await writeFile(backup, JSON.stringify(before, null, 2) + '\n');
for (const doc of documents) {
  await api('/api/option/', { method: 'PUT', body: JSON.stringify({ key: doc.key, value: doc.content }) }, admin);
  if (await api(doc.endpoint) !== doc.content) throw new Error('NewAPI协议回读不一致：' + doc.key);
  console.log(doc.key + ' updated and verified (' + doc.content.length + ' characters)');
}
