import React, { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { portalRequest } from './portal.mjs';
export function DailyNews() {
  const [data, setData] = useState(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => portalRequest('/news').then(value => { if (alive) setData(value); }).catch(() => {});
    load(); const timer = setInterval(load, 300000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const items = (data?.items || []).slice(0,20);
  return <section className="login-insights" aria-labelledby="daily-insights-title">
    <div className="login-insights-head"><span className="eyebrow">国内中文资讯 · {items.length} 条</span><span>{data?.updatedAt ? new Date(data.updatedAt).toLocaleDateString('zh-CN', { timeZone:'Asia/Shanghai', month:'long',day:'numeric' }) + '更新' : '正在加载'}</span></div>
    <div className="news-heading"><h2 id="daily-insights-title">人工智能与 WorkBuddy 动态</h2><a href="/guide/workbuddy-news/">查看来源与资讯</a><button className="icon-button" aria-label={paused?'继续自动滚动':'暂停自动滚动'} onClick={()=>setPaused(!paused)}>{paused?<Play size={14}/>:<Pause size={14}/>}</button></div>
    {items.length ? <div className="news-window" aria-label="20 条中文新闻，5 行自动向上循环"><div className={'news-track '+(paused?'paused':'')}>
      {[0,1].map(copy=><div className="news-group" key={copy} aria-hidden={copy===1?true:undefined}>{items.map((item,i)=><article key={item.id} className="news-row"><span className="news-number">{String(i+1).padStart(2,'0')}</span><div><strong title={item.title}>{item.title}</strong><p>{item.source} · {new Date(item.publishedAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'})}<span>{item.kicker}</span></p></div></article>)}</div>)}
    </div></div> : <p className="help-text">正在读取最新中文新闻，请稍候。</p>}
  </section>;
}
