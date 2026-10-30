import React, { useEffect, useState } from 'react';
import { ArrowRight, ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, KeyRound, ShieldCheck } from 'lucide-react';
import { Badge, CopyField, EmptyState, PageHeading, ProviderMark, SectionHead } from './ui.jsx';
import { portalRequest } from './portal.mjs';
import { SITE, providers } from './data.mjs';
import { sortModelRanking } from './model-ranking.mjs';
const number = n => Number(n || 0).toLocaleString('zh-CN');
const providerForModel = id => {
  const name = String(id || '').replace(/^cn:/i, '').toLowerCase();
  const providerId = name.startsWith('glm') ? 'zhipu' :
    name.startsWith('deepseek') ? 'deepseek' : name.startsWith('minimax') ? 'minimax' :
    name.startsWith('kimi') ? 'kimi' : name.startsWith('hy') ? 'tencent' :
    name.startsWith('step') ? 'step' : name.startsWith('qwen') ? 'qwen' :
    name.startsWith('mimo') ? 'mimo' : name === 'auto' ? 'auto' : 'space';
  return providers.find(provider => provider.id === providerId);
};
function RankingBadge({ rank }) {
  return <span className={`ranking-badge ${rank <= 3 ? `ranking-badge-${rank}` : 'ranking-badge-rest'}`} aria-label={`积分消耗排名第 ${rank} 名`}><small>{rank <= 3 ? 'TOP' : 'NO.'}</small><strong>{String(rank).padStart(2, '0')}</strong></span>;
}
export function UsageOverview({ledger,go}) {
  const rows = ledger.usage || [];
  const recent = rows.filter(x=>Date.now()-Date.parse(x.time)<86400000);
  const success = recent.filter(x=>x.status==='成功');
  const average = success.length ? success.reduce((s,x)=>s+Number(x.duration),0)/success.length : null;
  return <section className="panel usage-overview"><SectionHead title="用量概览" text="余额、消耗与请求量同步自 NewAPI。" action={<button className="text-link" onClick={()=>go('dashboard')}>数据看板<ArrowRight size={14}/></button>}/><div className="stats-grid">{[['可用积分',ledger.balance],['历史消耗',ledger.totals?.used],['请求总数',ledger.totals?.requests]].map(([label,value])=><article key={label}><span>{label}</span><strong>{number(value)}</strong></article>)}</div><div className="health-strip"><span><ShieldCheck size={16}/>最近 100 条调用表现</span><span>成功率 <b>{recent.length?(success.length/recent.length*100).toFixed(1)+'%':'暂无调用'}</b></span><span>平均耗时 <b>{average===null?'—':average.toFixed(2)+' 秒'}</b></span><span>已接入模型 <b>{ledger.models?.length||0}</b></span></div></section>;
}
export function DashboardPage({ledger,onToast,go}) {
  const [days,setDays]=useState(7);const [data,setData]=useState(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [rankingSort,setRankingSort]=useState({field:'quota',direction:'desc'});
  const load=async()=>{setBusy(true);setError('');try{setData(await portalRequest('/dashboard?days='+days));}catch(e){setError(e.message);}finally{setBusy(false);}};
  useEffect(()=>{load();},[days]);
  const series=Array.isArray(data?.series)?data.series:[];
  const byDay=new Map(),byModel=new Map();
  for(const row of series){const date=new Date(row.created_at*1000).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'});byDay.set(date,(byDay.get(date)||0)+Number(row.quota||0));const model=byModel.get(row.model_name)||{model:row.model_name,quota:0,count:0,tokens:0};model.quota+=Number(row.quota||0);model.count+=Number(row.count||0);model.tokens+=Number(row.token_used||0);byModel.set(row.model_name,model);}
  const max=Math.max(1,...byDay.values());
  const changeRankingSort = field => setRankingSort(current => ({
    field,
    direction: current.field === field && current.direction === 'desc' ? 'asc' : 'desc',
  }));
  const rankingColumns = [['model','模型'],['count','请求次数'],['quota','积分消耗'],['tokens','Token 用量']];
  const ranking = sortModelRanking([...byModel.values()], rankingSort.field, rankingSort.direction);
  const rankPositions = new Map(sortModelRanking([...byModel.values()]).map((row, index) => [row.model, index + 1]));
  const highestQuota = Math.max(0, ...[...byModel.values()].map(row => row.quota));
  return <><PageHeading title="数据看板" text="查看模型调用、积分消耗和使用趋势。" eyebrow="用量分析" action={<button className="button secondary" disabled={busy} onClick={load}><RefreshCw size={16}/>刷新</button>}/><UsageOverview ledger={ledger} go={go}/><section className="panel"><div className="section-heading"><h2>消耗趋势</h2><div className="segmented">{[1,7,30].map(d=><button className={days===d?'selected':''} key={d} onClick={()=>setDays(d)}>近 {d} 天</button>)}</div></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="stats-grid">{[['统计积分',data?.stats?.quota],['输入与输出量',data?.stats?.token],['每分钟请求',data?.stats?.rpm]].map(([label,value])=><article key={label}><span>{label}</span><strong>{number(value)}</strong></article>)}</div>{byDay.size?<div className="usage-chart" role="img" aria-label="每日积分消耗柱状图">{[...byDay].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=><div className="usage-bar" key={date}><span>{number(value)}</span><i style={{height:Math.max(3,value/max*150)}}/><small>{date}</small></div>)}</div>:<EmptyState title={busy?'正在读取统计':'暂无调用数据'} text="配置模型渠道并发起调用后，这里会显示真实消耗趋势。"/>}</section><section className="panel"><SectionHead title="模型排行榜" text="名次始终按积分消耗排列；点击表头可按请求次数、积分或 Token 用量查看。"/>{ranking.length?<div className="table-scroll"><table className="data-table ranking-table"><thead><tr>{rankingColumns.map(([field,label])=><th key={field} scope="col" aria-sort={rankingSort.field===field?(rankingSort.direction==='desc'?'descending':'ascending'):'none'}><button type="button" className="ranking-sort" onClick={()=>changeRankingSort(field)}>{label}{rankingSort.field===field?(rankingSort.direction==='desc'?<ArrowDown size={14}/>:<ArrowUp size={14}/>):<ArrowUpDown size={14}/>}</button></th>)}</tr></thead><tbody>{ranking.map(row=><tr key={row.model}><td><span className="record-model-cell"><RankingBadge rank={rankPositions.get(row.model)}/><ProviderMark provider={providerForModel(row.model)}/><span><b>{row.model||'未知模型'}</b><small>{providerForModel(row.model)?.name}</small></span></span></td><td><strong className="ranking-value">{number(row.count)}</strong><small className="ranking-unit">次请求</small></td><td><span className="ranking-credit"><strong className="ranking-value">{number(row.quota)}</strong><small className="ranking-unit">积分</small></span><span className="ranking-meter" role="img" aria-label={`相当于榜首积分消耗的 ${highestQuota ? Math.round(row.quota / highestQuota * 100) : 0}%`}><span style={{width:`${highestQuota ? Math.max(0, Math.min(100, row.quota / highestQuota * 100)) : 0}%`}}/></span></td><td><strong className="ranking-value">{number(row.tokens)}</strong><small className="ranking-unit">Token</small></td></tr>)}</tbody></table></div>:<EmptyState title={busy?'正在读取模型用量':'暂无模型调用'} text="调用模型后，这里会显示可排序的排行榜。"/>}</section></>;
}
export function KeysPage({ledger,onRefresh,onToast,onRedeem}) {
  const [visible,setVisible]=useState({});const [busy,setBusy]=useState(false);const [code,setCode]=useState('');
  const reveal=async id=>{try{const d=await portalRequest(`/keys/${id}/reveal`,{});setVisible(v=>({...v,[id]:d.key}));}catch(e){onToast(e.message,'error');}};
  const toggle=async key=>{setBusy(true);try{await portalRequest(`/keys/${key.id}/status`,{enabled:key.status==='已停用'});await onRefresh();onToast('密钥状态已更新');}catch(e){onToast(e.message,'error');}finally{setBusy(false);}};
  return <><PageHeading title="API 密钥" text="每个兑换套餐对应独立密钥，额度和到期时间由 NewAPI 校验。" eyebrow="模型接入"/><section className="panel"><CopyField label="接口地址" value={SITE.baseUrl} onToast={onToast}/><form className="key-activate-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onRedeem(code);setCode('');}catch(err){onToast(err.message,'error');}finally{setBusy(false);}}}><label>激活新套餐，添加密钥<input value={code} onChange={e=>setCode(e.target.value)} placeholder="输入未兑换的套餐兑换码" required/></label><button className="button primary" disabled={busy}><KeyRound size={16}/>激活并创建密钥</button></form>{import.meta.env.DEV&&<a className="button secondary" href="http://127.0.0.1:8787/setup/">体验一键配置 Agent（本地测试）</a>}</section><section className="panel"><SectionHead title="我的套餐密钥" text="可查看、复制、停用或重新启用。已到期套餐不能重新启用。"/>{(ledger.keys||[]).map(key=><article className="member-key" key={key.id}><div className="member-key-heading"><div><h3>{key.name}</h3><small>{key.code}</small></div><Badge neutral={key.status!=='已启用'}>{key.status}</Badge></div><div className="key-numbers"><span>剩余 <b>{number(key.remaining)}</b> 积分</span><span>已用 <b>{number(key.used)}</b></span><span>到期 {new Date(key.expiresAt*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</span></div>{visible[key.id]?<CopyField label="API Key" value={visible[key.id]} secret onToast={onToast}/>:<button className="button secondary" onClick={()=>reveal(key.id)}>显示并复制完整密钥</button>}<button className="text-link" disabled={busy||!['已启用','已停用'].includes(key.status)} onClick={()=>toggle(key)}>{key.status==='已停用'?'启用密钥':'停用密钥'}</button></article>)}{!ledger.keys?.length&&<EmptyState title="暂无密钥" text="激活兑换码后即可获得模型接口密钥。"/>}</section></>;
}

