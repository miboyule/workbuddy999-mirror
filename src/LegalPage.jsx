import React from 'react';
import { ChevronLeft, ArrowRight } from 'lucide-react';
import { Brand } from './ui.jsx';
import legal from './legal.json';

function LegalText({ text }) {
  return text.split(/(\*\*[^*]+\*\*|https:\/\/[^\s。，；）]+)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('https://')) return <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>;
    return part;
  });
}

export function LegalPage({ type, go, authed }) {
  const title = type === 'terms' ? '用户协议' : '隐私政策';
  const sections = legal[type];
  return <main className="legal-page">
    <div className="legal-topline">
      <button className="text-link" onClick={() => go('overview')}><ChevronLeft size={16}/>{authed ? '返回工作台' : '返回登录'}</button>
      <Brand compact/>
    </div>
    <article className="panel legal-document" aria-labelledby="legal-title">
      <span className="eyebrow">{legal.meta.siteName}</span>
      <h1 id="legal-title">{title}</h1>
      <p className="legal-meta">发布日期：{legal.meta.publishedAt}<span>生效日期：{legal.meta.effectiveAt}</span><span>版本：{legal.meta.version}</span></p>
      <nav className="legal-toc" aria-label={title + '目录'}>
        <strong>内容目录</strong>
        <div>{sections.map((section, i) => section.tag === 'H2' && <a key={i} href={'#' + type + '-section-' + i}>{section.text}</a>)}</div>
      </nav>
      {sections.map((section, i) => {
        if (section.tag === 'H2' || section.tag === 'H3') {
          const Heading = section.tag.toLowerCase();
          return <Heading key={i} id={type + '-section-' + i}>{section.text}</Heading>;
        }
        if (section.tag === 'UL' || section.tag === 'OL') {
          const List = section.tag.toLowerCase();
          return <List key={i}>{section.items.map((item, j) => <li key={j}><LegalText text={item}/></li>)}</List>;
        }
        return <p key={i}><LegalText text={section.text}/></p>;
      })}
      <footer className="legal-related"><span>{legal.meta.contact}</span><button className="text-link" onClick={() => go(type === 'terms' ? 'privacy' : 'terms')}>查看{type === 'terms' ? '隐私政策' : '用户协议'}<ArrowRight size={15}/></button></footer>
    </article>
  </main>;
}
