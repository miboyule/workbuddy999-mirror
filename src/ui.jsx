import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, X, ArrowUpRight, Eye, EyeOff, SearchX, Rabbit } from 'lucide-react';
import { SITE } from './data.mjs';

export function Brand({ compact = false }) {
  return <a href="/console" className={'brand ' + (compact ? 'compact' : '')} aria-label={SITE.name}>
    <img src={SITE.logo} alt="WorkBuddy 官方 Logo" width="162" height="56" />
    {!compact && <span>积分兑换与模型配置服务</span>}
  </a>;
}
export function Badge({ children, neutral = false }) { return <span className={'badge ' + (neutral ? 'neutral' : '')}>{children}</span>; }
export function SectionHead({ title, text, action, eyebrow }) { return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{text && <p>{text}</p>}</div>{action}</div>; }
export function PageHeading({ title, text, action, eyebrow }) { return <div className="page-heading"><div><span className="eyebrow">{eyebrow || 'WORKBUDDY · WORKSPACE'}</span><h1>{title}</h1>{text && <p>{text}</p>}</div>{action}</div>; }
export function External({ href, children, className = 'button secondary' }) { return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={16}/></a>; }
export function CopyButton({ value, label = '复制', onToast, className = '', disabled = false, preserveWhitespace = false }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    // API keys and redemption codes are often rendered with visual spacing;
    // always copy the canonical token without whitespace or line breaks.
    const normalized = preserveWhitespace ? String(value ?? '') : String(value ?? '').replace(/[\u00a0\s]+/g, '').trim();
    try { await navigator.clipboard.writeText(normalized); setCopied(true); clearTimeout(timer.current); timer.current=setTimeout(()=>setCopied(false),1800); }
    catch { onToast?.('复制失败，请选中文字手动复制。', 'error'); }
  };
  return <button type="button" className={'copy-button ' + className} onClick={copy} disabled={disabled || !value} aria-label={copied?'已复制':label} title={label}>{copied?<Check size={15}/>:<Copy size={15}/>}<span>{copied?'已复制':label}</span></button>;
}
export function CodeBlock({ value, label, onToast }) { return <div className="code-block"><div className="code-toolbar"><span>{label || '配置内容'}</span><CopyButton value={value} preserveWhitespace onToast={onToast}/></div><pre><code>{value}</code></pre></div>; }
export function CopyField({ label, value, secret = false, onToast }) {
  const [show, setShow] = useState(false);
  return <div className="copy-field"><span>{label}</span><div><code>{secret&&!show?'••••••••••••••••':value}</code>{secret&&<button className="icon-button" onClick={()=>setShow(!show)} aria-label={show?'隐藏密钥':'显示密钥'}>{show?<EyeOff size={16}/>:<Eye size={16}/>}</button>}<CopyButton value={value} onToast={onToast}/></div></div>;
}
export function EmptyState({ title='暂无记录', text='试试其他筛选条件', action }) { return <div className="empty-state"><span><SearchX size={27}/></span><h3>{title}</h3><p>{text}</p>{action}</div>; }
const providerLogo = { zhipu:'/brand/clients/zcode.png', deepseek:'/brand/providers/deepseek.svg', minimax:'/brand/providers/minimax.svg', kimi:'/brand/providers/kimi.ico', tencent:'/brand/providers/hunyuan.png', step:'/brand/providers/stepfun.svg', qwen:'/brand/providers/qwen.svg', mimo:'/brand/providers/xiaomi.svg' };
export function ProviderMark({ provider }) { const src=providerLogo[provider?.id]; return <span className={'provider-mark provider-'+provider?.id+(src?' has-logo':'')} aria-label={provider?.name||'模型厂商'}>{src?<img src={src} alt="" loading="lazy"/>:<span className="provider-mark-fallback">{provider?.id==='space'?<Rabbit size={22} aria-hidden="true"/>:provider?.mark}</span>}</span>; }

// Native dialog owns focus trapping, Escape and inert background.
// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog
export function Modal({ title, children, close, wide = false, variant = '' }) {
  const dialog = useRef(null);
  useEffect(()=>{const el=dialog.current; el.showModal(); return ()=>el.close();},[]);
  return <dialog ref={dialog} className={'modal '+(wide?'wide ':'')+(variant?'modal-'+variant:'')} aria-labelledby="modal-title" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
    <div className="modal-shell"><div className="modal-head"><h2 id="modal-title">{title}</h2><button autoFocus className="icon-button" onClick={close} aria-label="关闭弹窗"><X size={21}/></button></div><div className="modal-content">{children}</div></div>
  </dialog>;
}
