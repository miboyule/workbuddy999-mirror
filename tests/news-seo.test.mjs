import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNewsPage } from '../scripts/render-news-page.mjs';

test('news page shows dated source links without rendering untrusted HTML', () => {
  const html = renderNewsPage({ updatedAt: '2026-10-28T01:00:00Z', items: [
    { title: '<script>alert(1)</script>', summary: '<img src=x>', source: '新闻来源', sourceUrl: 'https://example.com/news', publishedAt: '2026-10-27T01:00:00Z' },
    { title: 'danger', sourceUrl: 'javascript:alert(1)', publishedAt: '2026-10-27T01:00:00Z' },
  ] });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /href="https:\/\/example.com\/news"/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /最近一次采集/);
  assert.match(html, /guide\/workbuddy-credits/);
});
