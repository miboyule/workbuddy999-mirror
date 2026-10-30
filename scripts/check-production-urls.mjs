import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { MODEL_API_BASE_URL } from '../shared/endpoints.mjs';

export function checkProductionAssets(files) {
  if (!files.some(content => content.includes(MODEL_API_BASE_URL))) throw new Error('生产构建缺少模型 API 地址');
  if (files.some(content => /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/v1\b/i.test(content))) {
    throw new Error('生产构建包含本地模型接口地址');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const assets = new URL('../dist/assets/', import.meta.url);
  const files = await Promise.all((await readdir(assets)).filter(name => name.endsWith('.js')).map(name => readFile(new URL(name, assets), 'utf8')));
  checkProductionAssets(files);
  console.log('生产接口地址检查通过');
}
