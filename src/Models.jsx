import React, { useEffect, useState } from 'react';
import { ArrowRight, Search, SlidersHorizontal, Image, Layers, Copy, Check, ArrowUpRight } from 'lucide-react';
import { models, providers, SITE } from './data.mjs';
import { pricingById } from '../shared/model-pricing.mjs';
import { modelLabel } from '../shared/workbuddy-catalog.mjs';
import { portalRequest } from './portal.mjs';
import { Badge, CopyButton, EmptyState, PageHeading, ProviderMark, SectionHead } from './ui.jsx';

export const formatTokens = n => n == null ? '待核实' : n.toLocaleString();
export const sourceLabel = m => ({reference:'常用模型',capabilities:'配置清单',manual:'手动配置',screenshot:'客户端收录'}[m.source]);
const money = value => '¥' + Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 6 });
function OfficialPrice({ pricing }) {
  const ref = pricing?.official;
  return ref ? <section className="official-price"><h4>厂商官方 API 参考价</h4><p>人民币 / 百万 Token · 核对于 {ref.checkedAt}</p><div className="table-scroll"><table className="data-table"><thead><tr><th>适用档位</th><th>输入</th><th>输出</th><th>缓存读取</th></tr></thead><tbody>{ref.tiers.map(t=><tr key={t.name}><td>{t.name}</td><td>{money(t.input)}</td><td>{money(t.output)}</td><td>{t.cache===undefined?'未列出':money(t.cache)}</td></tr>)}</tbody></table></div>{ref.note&&<p className="fine-print">{ref.note}</p>}<a className="text-link" href={ref.url} target="_blank" rel="noreferrer">厂商官方定价来源<ArrowUpRight size={14}/></a></section> : <p className="fine-print">该型号的官方人民币 API 价格尚待核实。</p>;
}
export function ModelDetail({ model: m, onToast, go }) {
  const p=providers.find(p=>p.id===m.provider);
  return <><div className="model-detail-heading"><ProviderMark provider={p}/><div><h3>{m.name}</h3><p>{p.name} · {p.sub}</p></div></div><p>{m.scene||p.desc}</p><div className="detail-grid"><div><span>最大输入</span><strong>{formatTokens(m.input)}</strong></div><div><span>最大输出</span><strong>{formatTokens(m.output)}</strong></div><div><span>图片输入</span><strong>{m.vision===undefined?'待同步':m.vision?'支持':'不支持'}</strong></div><div><span>积分结算</span><strong>按实际消耗</strong></div></div>
  <div className="info-callout"><b>上游实扣积分 × 1 · 20积分 = ¥1面值</b><p>积分随输入、输出、缓存及活动变化，成功请求按返回的实际积分结算，明确返回0积分时不收费。一次任务可能包含多次接口请求。</p><p>倍率已包含在实扣积分中，不重复相乘；未返回有效扣费信息的请求显示为待核对。</p></div>
  <OfficialPrice pricing={m.pricing}/>
  {m.id?<div className="model-id"><code>{m.id}</code><CopyButton value={m.id} label="复制模型 ID" onToast={onToast}/></div>:<div className="info-callout">该名称来自你提供的 WorkBuddy 客户端列表；接口 ID 和能力参数将在服务接入后同步。</div>}
  <p className="fine-print">本站按上游实际积分结算，厂商 API 参考价不参与本站扣费。能否调用以账户已开通渠道为准。</p>
  <button className="button primary full" onClick={()=>go('workbuddy?mode=manual')}>前往配置教程<ArrowRight size={16}/></button></>;
}
export function ModelGroups({ onModel, go, compact = false }) {
  return <section className="panel model-groups"><SectionHead title="国内主流模型，一站看全" eyebrow="MODEL COLLECTION" text="按厂家查找模型，把合适的能力放进你的工作流。" action={<button className="text-link" onClick={()=>go('models')}>全部 {models.length} 款<ArrowRight size={16}/></button>}/><div className="provider-grid">
    {providers.filter(p=>!['auto','space'].includes(p.id)).map(p=><article className="provider-card" key={p.id}><div className="provider-heading"><ProviderMark provider={p}/><div><h3>{p.name}</h3><span>{p.sub}</span></div><span className="provider-count">{models.filter(m=>m.provider===p.id).length}</span></div><div className="model-tags">{models.filter(m=>m.provider===p.id).map(m=><button key={m.name} onClick={()=>onModel(m)} title={'查看 '+m.name+' 详情'}>{m.name.replace('Xiaomi ','')}<ArrowUpRight size={12}/></button>)}</div></article>)}
  </div><div className="extra-models"><span>更多选择</span>{models.filter(m=>['space','auto'].includes(m.provider)).map(m=><button key={m.name} onClick={()=>onModel(m)}>{m.name}<ArrowUpRight size={13}/></button>)}<span className="fine-print">模型持续更新</span></div></section>;
}
export function ModelsPage({ onModel, onToast, initialProvider='', availableModels=[] }) {
  const [query,setQuery]=useState('');const [provider,setProvider]=useState(initialProvider);const [filter,setFilter]=useState('all');
  const [catalog,setCatalog]=useState(null);
  useEffect(()=>{let live=true;portalRequest('/setup/catalog').then(data=>{if(live)setCatalog(data.models||[]);}).catch(()=>{});return()=>{live=false;};},[]);
  const providerFor=id=>{const name=String(id||'').replace(/^cn:/i,'').toLowerCase();if(name.startsWith('deepseek'))return 'deepseek';if(name.startsWith('glm'))return 'zhipu';if(name.startsWith('minimax'))return 'minimax';if(name.startsWith('kimi'))return 'kimi';if(name.startsWith('hy'))return 'tencent';if(name.startsWith('step'))return 'step';if(name.startsWith('qwen'))return 'qwen';if(name.startsWith('mimo'))return 'mimo';return name==='auto'?'auto':'space';};
  const listed=catalog?catalog.map(entry=>({id:entry.id,name:entry.name,provider:providerFor(entry.id),input:entry.maxInputTokens??undefined,output:entry.maxOutputTokens??undefined,vision:entry.supportsImages??undefined,source:'reference',pricing:pricingById[entry.id.replace(/^cn:/,'')]})):models.map(model=>({...model,name:modelLabel(model.id)}));
  const normalizedQuery=query.trim().toLowerCase();
  const filtered=listed.filter(m=>(!provider||m.provider===provider)&&(!normalizedQuery||[m.id,m.name,providers.find(p=>p.id===m.provider)?.name].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery))&&(filter!=='vision'||m.vision===true)&&(filter!=='setup'||m.source==='reference'));
  const available = new Set(availableModels.flatMap(id=>[id,String(id).replace(/^cn:/,'')]));
  const isAvailable = id => available.has(id) || available.has('cn:'+id);
  const clearFilters=()=>{setQuery('');setProvider('');setFilter('all');};
  return <><PageHeading title="模型中心" text="从厂家到模型，找到适合你的每一种能力。" eyebrow="EXPLORE MODELS" action={<Badge>{listed.length} 款模型</Badge>}/><div className="panel"><div className="info-callout">当前账户从 NewAPI 渠道清单读取到 {availableModels.length} 个模型。已开通表示账户已获得该模型的渠道授权；实际请求仍会受渠道状态、模型映射和上游服务状态影响。</div>
    <div className="filter-row"><label className="search-input"><Search size={18}/><input aria-label="搜索模型" placeholder="搜索模型名称、ID 或厂家" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="select-label"><SlidersHorizontal size={16}/><select aria-label="模型能力筛选" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部能力</option><option value="vision">支持图片输入</option><option value="setup">一键配置模型</option></select></label></div>
    <div className="filter-chips model-provider-filters" aria-label="厂家筛选"><button className={!provider?'selected':''} onClick={()=>setProvider('')}>全部厂家</button>{providers.map(p=><button className={provider===p.id?'selected':''} key={p.id} onClick={()=>setProvider(p.id)}><ProviderMark provider={p}/>{p.name}</button>)}</div>
    <div className="table-caption"><span>找到 <b>{filtered.length}</b> 款模型</span><small>实扣积分 1:1 · 20积分 = ¥1面值</small></div>
    {filtered.length?<div className="table-scroll"><table className="data-table model-table"><thead><tr><th>模型 / 厂家</th><th>最大输入 / 输出</th><th>图片输入</th><th>结算方式</th><th>积分换算</th><th>账户可用性</th><th>操作</th></tr></thead><tbody>{filtered.map(m=>{const modelProvider=providers.find(p=>p.id===m.provider)||providers.find(p=>p.id==='space');return <tr key={m.id}><td><button className="table-model" onClick={()=>onModel(m)}><ProviderMark provider={modelProvider}/><span><b>{m.name}</b><small>{modelProvider.name} · {String(m.id).replace(/^cn:/,'')}</small></span></button></td><td className="mono token-cell">{formatTokens(m.input)}<small>{formatTokens(m.output)}</small></td><td>{m.vision==null?<span className="muted">待同步</span>:m.vision?<span className="capability"><Check size={14}/>支持</span>:<span className="muted">不支持</span>}</td><td><span className="price-cell">实扣积分 1:1</span></td><td><span className="price-cell">20积分 = ¥1</span></td><td><Badge neutral={!isAvailable(m.id)}>{isAvailable(m.id)?'渠道已开通':'待开通渠道'}</Badge></td><td><button className="text-link" onClick={()=>onModel(m)}>价格详情</button></td></tr>;})}</tbody></table></div>:<EmptyState title="没有找到匹配的模型" text="换一个名称，或清除厂家和能力筛选。" action={<button className="button secondary" onClick={clearFilters}>清除筛选</button>}/>}
    <p className="fine-print table-note">模型倍率与输入输出上限优先按 2026-10-27 上游国内版目录核对；未收录的旧渠道模型仅保留已核实资料，无法核实的字段明确标记。所有已接入模型仍按上游实扣积分结算，包含缓存、倍率和活动优惠；历史记录不追溯补扣。</p>
  </div></>;
}
