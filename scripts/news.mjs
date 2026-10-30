import { XMLParser } from 'fast-xml-parser';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { writeNewsPage } from './render-news-page.mjs';
const parser = new XMLParser({ ignoreAttributes: false });
export const chineseNews = title => (title.match(/[\u4e00-\u9fff]/g) || []).length >= 6 && (title.match(/[\u4e00-\u9fff]/g) || []).length >= (title.match(/[A-Za-z]/g) || []).length * .4;
const related = /人工智能|\bAI\b|大模型|智能体|机器人|推理|算力|WorkBuddy|DeepSeek|GLM|MiniMax|千问|豆包|具身|模型|编程/i;
const domestic = /国内|国产|中国|全国|腾讯|百度|阿里|千问|智谱|清华|北大|北京|上海|南京|深圳|飞书|豆包|小米|商汤|星辰|生数|通研院|是石|启元|哲源|WorkBuddy|DeepSeek|MiniMax|Kimi|GLM|Qwen|科大讯飞/i;
const clean = value => String(value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
export async function updateNews() {
  const sources = JSON.parse(await readFile(new URL('../data/daily-insights-sources.json', import.meta.url), 'utf8'));
  const output = new URL('../public/daily-insights.json', import.meta.url);
  let previous = []; try { const data = JSON.parse(await readFile(output, 'utf8')); previous = (data.items || data).filter(x => x.sourceUrl && x.publishedAt); } catch {}
  const reports = [];
  const batches = await Promise.all(sources.map(async source => {
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'WorkBuddyNews/1.0' } });
      const raw = await res.text();
      if (!res.ok || !raw.includes('<rss')) throw new Error('未返回有效 RSS');
      const items = parser.parse(raw)?.rss?.channel?.item || [];
      const selected = (Array.isArray(items) ? items : [items]).flatMap(item => {
        const title = clean(item.title), summary = clean(item.description).slice(0, 180);
        if (!chineseNews(title) || !related.test(title) || !domestic.test(title + summary)) return [];
        const published = Date.parse(item.pubDate);
        if (!published || published > Date.now() + 86400000) return [];
        const sourceUrl = clean(item.link);
        return [{ id: createHash('sha256').update(sourceUrl).digest('hex').slice(0,16), kicker: /WorkBuddy/i.test(title) ? 'WorkBuddy 动态' : '国内人工智能', title, summary, source: source.name, sourceUrl, publishedAt: new Date(published).toISOString() }];
      });
      reports.push({ source: source.name, url: source.url, count: selected.length, ok: true });
      return selected;
    } catch (error) { reports.push({ source: source.name, url: source.url, ok: false, message: error.message }); return []; }
  }));
  const unique = [...new Map([...batches.flat(), ...previous].map(x => [x.id, x])).values()].sort((a,b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (!reports.some(report => report.ok)) throw new Error('所有资讯源均不可用，保留上次有效新闻');
  // Keep recent WorkBuddy coverage visible even when the general AI feed is busy.
  const wb = unique.filter(x => /WorkBuddy/i.test(x.title)).slice(0, 2);
  const items = [...wb, ...unique.filter(x => !wb.some(y => y.id === x.id))].slice(0,20);
  if (!items.length) throw new Error('资讯源暂时不可用，保留上次有效新闻');
  const result = { updatedAt: new Date().toISOString(), items, count: items.length };
  await writeFile(new URL('../data/news-update-report.json', import.meta.url), JSON.stringify({ ...result, items: undefined, sources: reports }, null, 2));
  await writeNewsPage(result);
  await writeFile(new URL('../public/daily-insights.json.tmp', import.meta.url), JSON.stringify(result, null, 2));
  await rename(new URL('../public/daily-insights.json.tmp', import.meta.url), output);
  return { count: items.length, sourcesOk: reports.filter(x => x.ok).length, workbuddy: wb.length };
}
