import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const safeSource = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
};

export function renderNewsPage(data) {
  const updated = Number.isFinite(Date.parse(data.updatedAt)) ? new Date(data.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }) : '未记录';
  const items = (data.items || []).filter(item => safeSource(item.sourceUrl) && Number.isFinite(Date.parse(item.publishedAt))).slice(0, 20);
  const rows = items.map(item => `<div class="news-card"><h3><a href="${escapeHtml(safeSource(item.sourceUrl))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a></h3><small>${escapeHtml(item.source)} · <time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(new Date(item.publishedAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }))}</time></small>${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}</div>`).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WorkBuddy 与 AI 模型资讯 | 原文来源及更新记录</title><meta name="description" content="汇集 WorkBuddy 与国内 AI 模型相关新闻摘要，附原文来源与发布时间；了解积分购买、模型配置和真实消耗规则。"><meta name="robots" content="index,follow"><link rel="canonical" href="https://www.workbuddy999.top/guide/workbuddy-news/"><link rel="icon" href="/brand/workbuddy-icon.png" type="image/png"><link rel="stylesheet" href="/guide/guide.css"></head><body>
<header><div class="inner"><a class="brand" href="/"><img src="/brand/workbuddy-icon.png" alt="" width="38" height="38">WorkBuddy 积分服务</a><nav aria-label="主要导航"><a href="/guide/workbuddy-credits/">积分规则</a><a href="/guide/workbuddy-setup/">模型配置</a><a href="/guide/workbuddy-news/" aria-current="page">模型资讯</a><a href="/">会员登录</a></nav></div></header>
<main><div class="hero"><span class="eyebrow">News & sources · 资讯</span><h1>WorkBuddy 与 AI 模型资讯</h1><p>自动整理公开 RSS 的相关新闻标题与摘要，保留原文出处和发布时间。资料仅供了解行业动态；模型可用性、倍率与积分消耗请以本站会员中心实时记录为准。</p><p>最近一次采集：${escapeHtml(updated)}。没有新消息时保留最近的已核实来源，不会虚构每日更新。</p><div class="actions"><a class="button" href="/guide/workbuddy-credits/">了解积分购买和消耗</a><a class="button secondary" href="/guide/workbuddy-setup/">模型接入教程</a></div></div>
<div class="layout"><aside class="toc"><strong>相关阅读</strong><a href="/guide/workbuddy-credits/">积分价格、领取与兑换</a><a href="/guide/workbuddy-setup/">模型配置与余额不足排查</a></aside><article class="article"><section><h2>新闻与原文链接</h2><p>摘要来自第三方公开新闻源，点击标题前往原文；本站不复制原文全文，也不将第三方新闻当成官方声明。</p>${rows || '<p>暂无可用的资讯来源，请稍后再查看。</p>'}</section></article></div></main><footer>WorkBuddy 积分兑换服务 · 独立第三方服务 <a href="/terms">用户协议</a><a href="/privacy">隐私政策</a></footer></body></html>`;
}

export async function writeNewsPage(data) {
  const directory = new URL('../public/guide/workbuddy-news/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const temporary = new URL('index.html.tmp', directory);
  await writeFile(temporary, renderNewsPage(data));
  await rename(temporary, new URL('index.html', directory));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const data = JSON.parse(await readFile(new URL('../public/daily-insights.json', import.meta.url), 'utf8'));
  await writeNewsPage(data);
}
