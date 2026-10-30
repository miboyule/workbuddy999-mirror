import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProductionAssets } from '../scripts/check-production-urls.mjs';
import { MODEL_API_BASE_URL } from '../shared/endpoints.mjs';
import { setupLauncher } from '../src/setup-launcher.mjs';

test('portal and downloaded launchers share the production model endpoint', () => {
  assert.ok(setupLauncher('workbuddy', 'windows', 'cn', 'sk-test-only').includes(MODEL_API_BASE_URL));
  checkProductionAssets([`baseUrl: '${MODEL_API_BASE_URL}'`]);
  assert.throws(() => checkProductionAssets([`baseUrl: '${MODEL_API_BASE_URL}'; fallback: 'http://localhost:5173/v1'`]), /本地模型接口/);
});
