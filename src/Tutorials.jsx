import React, { useEffect, useState } from 'react';
import { Monitor, Apple, AppWindow, Settings2, Bot, ArrowRight, Download, Play, Expand, Check, BookOpen, KeyRound, ExternalLink } from 'lucide-react';
import { SITE, products, tutorials, setupModels, providers, modelConfig, aiPrompt } from './data.mjs';
import { CodeBlock, CopyField, CopyButton, Badge, PageHeading, ProviderMark, SectionHead, External } from './ui.jsx';
import { portalRequest, downloadFile } from './portal.mjs';
import { setupLauncher } from './setup-launcher.mjs';

const modes={windows:{title:'Windows 一键配置',icon:AppWindow},macos:{title:'macOS 一键配置',icon:Apple},manual:{title:'手动配置',icon:Settings2},ai:{title:'AI 代配置',icon:Bot}};
// Official assets are served locally; provenance is in docs/reference/client-logos.md.
const officialClientLogos={workbuddy:'/brand/clients/workbuddy.svg',codebuddy:'/brand/clients/codebuddy.svg',traework:'/brand/clients/trae-work.png',zcode:'/brand/clients/zcode.png',coze:'/brand/clients/coze.png'};
export const ProductIcon=({id,size=22})=> <img className={'product-brand product-brand-'+id} src={officialClientLogos[id]} width={size} height={size} alt="" aria-hidden="true"/>;

export function ProductLinks({go}) { return <div className="product-grid">{products.map(p=><button key={p.id} className={'product-card product-'+p.id} onClick={()=>go(p.id)}><span className="product-icon"><ProductIcon id={p.id} size={28}/></span><div><strong>{p.name}</strong><span>{p.tagline}</span></div><ArrowRight size={17}/></button>)}</div>; }

export function TutorialPage({id,ledger,routeMode,onToast,onImage,go}) {
  const p=products.find(p=>p.id===id);const [mode,setMode]=useState(p.modes.includes(routeMode)?routeMode:p.modes[0]);
  const [region,setRegion]=useState('cn');const [revealedKey,setRevealedKey]=useState(null);const [keyError,setKeyError]=useState(null);const [videoOpen,setVideoOpen]=useState(true);const [expanded,setExpanded]=useState(true);
  const [baseUrl,setBaseUrl]=useState(SITE.baseUrl);
  const activeKeyId=ledger?.keys?.find(item=>item.status==='已启用')?.id;
  useEffect(()=>{
    let live=true;
    if(SITE.preview||!activeKeyId)return undefined;
    portalRequest('/keys/'+activeKeyId+'/reveal',{}).then(data=>{if(live&&data.key){setRevealedKey({id:activeKeyId,value:data.key});setKeyError(null);}}).catch(error=>{if(live)setKeyError({id:activeKeyId,message:error.message});});
    return()=>{live=false;};
  },[activeKeyId]);
  const apiKey=activeKeyId&&revealedKey?.id===activeKeyId?revealedKey.value:'';
  const keyReady=Boolean(apiKey);
  const keyStatus=activeKeyId?(keyError?.id===activeKeyId?keyError.message:'正在读取当前会员密钥…'):'当前账户暂无有效套餐密钥，请先激活套餐';
  const config=keyReady?JSON.stringify(modelConfig(apiKey,baseUrl),null,2):'';
  const directory=id==='codebuddy'?(region==='cn'?'.codebuddycn':'.codebuddy'):'.workbuddy';
  const installStem=id==='codebuddy'?'codebuddy':'workbuddy';
  const makeStep=(n,title,children)=><article className="tutorial-step" id={'step-'+n} key={n}><span className="step-number">{String(n).padStart(2,'0')}</span><div className="step-content"><h3>{title}</h3>{children}</div></article>;
  const image=(file,title)=><button className="tutorial-image" onClick={()=>onImage({url:'/tutorials/'+file,title})} aria-label={'放大图片：'+title}><img loading="lazy" src={'/tutorials/'+file} alt={title}/><span><Expand size={15}/>点击放大</span></button>;
  const fields=<div className="config-fields">{id==='traework'&&<CopyField label="API 格式" value="OpenAI Chat Completions" onToast={onToast}/>}<CopyField label={id==='coze'?'API URL':'接口地址'} value={baseUrl} onToast={onToast}/>{keyReady?<CopyField label="当前套餐 API Key" value={apiKey} onToast={onToast}/>:<div className="info-callout"><KeyRound size={17}/><span>{keyStatus}</span></div>}<CopyField label="模型 ID" value="auto" onToast={onToast}/>{id==='coze'&&<><CopyField label="模型协议" value="Chat API" onToast={onToast}/><CopyField label="输入 / 回复长度" value="262144 / 131072" onToast={onToast}/></>}</div>;
  const doDownload=(type)=>{if(type==='json'){if(!keyReady){onToast(keyStatus,'error');return;}downloadFile('models.json',config,'application/json');onToast('配置文件已下载，已自动写入当前套餐密钥。');}};
  const downloadWindows=async()=>{
    const key=ledger?.keys?.find(item=>item.status==='已启用');
    if(!key){onToast('请先激活有效套餐','error');return;}
    try{
      const response=await fetch(`/api/portal/setup/windows/${key.id}`,{credentials:'same-origin'});
      if(!response.ok){const error=await response.json();throw new Error(error.message||'下载失败');}
      downloadFile('workbuddy-setup.cmd',await response.text(),'application/octet-stream');
      onToast('配置文件已下载。');
    }catch(error){onToast(error.message,'error');}
  };
  const downloadSetup=()=>{
    if(!keyReady){onToast(keyStatus,'error');return;}
    if(id==='workbuddy'&&mode==='windows'){downloadWindows();return;}
    try{downloadFile(`${installStem}-setup.${mode==='windows'?'cmd':'command'}`,setupLauncher(installStem,mode,region,apiKey),'application/octet-stream');onToast('已下载当前会员专属配置文件，请勿转发。');}
    catch(error){onToast(error.message,'error');}
  };
  return <><PageHeading title={p.name+' 配置'} text={p.subtitle} eyebrow="CONNECT YOUR WORKSPACE" action={p.download&&<External href={p.download}>{id==='coze'?'打开扣子':'下载 '+p.name}</External>}/>
    <div className="tutorial-layout"><div className="tutorial-main"><div className="panel setup-panel">
      {id==='codebuddy'&&<><div className="segmented version-tabs" aria-label="CodeBuddy 版本"><button className={region==='cn'?'selected':''} onClick={()=>setRegion('cn')}>国内版 · 腾讯云</button><button className={region==='global'?'selected':''} onClick={()=>setRegion('global')}>国际版 CodeBuddy</button></div><p className="help-text">配置目录：<code>~/{directory}/models.json</code>。请选择本地安装的版本，选错目录模型不会出现。</p></>}
      {id==='traework'&&<div className="info-callout"><Monitor size={19}/><span>自定义模型仅支持 <b>TraeWork 桌面版</b>。网页版和手机版无法配置。</span></div>}
      {id==='coze'&&<div className="info-callout"><KeyRound size={19}/><span>添加自定义模型需要 <b>扣子付费版</b>。网页版与桌面端的操作一致。</span></div>}
      {id==='zcode'&&<p className="fine-print">依据 ZCode 官方「连接模型」教程整理 · 2026-10-26 核对</p>}{id==='zcode'&&<div className="info-callout"><Bot size={19}/><span>ZCode 使用 OpenAI 兼容协议。优先选择 <b>OpenAI Compatible / Chat Completions</b>，Base URL 填写本站接口地址。</span></div>}
      {p.modes.length>1&&<div className="config-tabs" role="tablist" aria-label="配置方式">{p.modes.map(m=>{const Icon=modes[m].icon;return <button key={m} role="tab" aria-selected={mode===m} className={mode===m?'selected':''} onClick={()=>{setMode(m);setVideoOpen(true);}}><Icon size={17}/>{modes[m].title}</button>;})}</div>}
      <button className="button secondary" onClick={async()=>{const key=ledger?.keys?.find(k=>k.status==='已启用');if(!key){onToast('请先激活有效套餐','error');return;}try{const d=await portalRequest('/keys/'+key.id+'/reveal',{});setRevealedKey({id:key.id,value:d.key});setKeyError(null);onToast('已填入当前套餐密钥');}catch(e){onToast(e.message,'error');}}}>重新读取当前套餐密钥</button><details className="key-entry"><summary><KeyRound size={16}/>接口信息（已自动填入）<span>用于生成配置</span></summary><div className="key-entry-fields"><label>接口地址<input value={baseUrl} onChange={e=>setBaseUrl(e.target.value)} placeholder="https://www.workbuddy999.top/v1" spellCheck="false"/></label><div>{keyReady?<CopyField label="当前套餐 API Key" value={apiKey} onToast={onToast}/>:<p>{keyStatus}</p>}</div><p>页面会自动使用当前账户已启用套餐密钥，不需要另外查找或复制。</p></div></details>
      {id==='workbuddy'&&mode!=='ai'&&<div className="video-block"><button className="video-preview" onClick={()=>setVideoOpen(!videoOpen)} aria-expanded={videoOpen}><span className="video-play"><Play size={19}/></span><div><b>{modes[mode].title} · 操作视频</b><span>视频已整合到本站，可直接播放或下载留存</span></div><span className="video-pill">{videoOpen?'收起':'播放教程'}</span></button>{videoOpen&&<><video controls playsInline preload="metadata" src={'/videos/'+mode+'.mp4'} onError={()=>onToast('视频暂时无法播放，请查看下方图文教程。','error')}/><div className="button-group video-actions"><a className="button secondary" href={'/videos/'+mode+'.mp4'} download><Download size={15}/>下载本地视频</a><p className="fine-print">参考操作视频，接口地址与 API Key 请使用本页配置。</p></div></>}</div>}
      {mode==='ai'?<div className="ai-setup"><span className="ai-symbol"><Bot size={30}/></span><h2>让 AI 帮你完成配置</h2><p>把这段提示词交给 Claude Code、CodeBuddy 或 Cursor，自动识别系统、备份配置并合并模型。</p>{keyReady?<CodeBlock value={aiPrompt(id,region,apiKey,baseUrl)} label="AI 配置提示词" onToast={onToast}/>:<div className="info-callout"><KeyRound size={18}/><span>{keyStatus}，读取完成后会自动生成包含当前会员密钥的配置提示词。</span></div>}</div>:
      <><button className="steps-toggle" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}><BookOpen size={16}/>{expanded?'收起图文步骤':'展开图文步骤'}</button>{expanded&&<div className="tutorial-steps">
        {mode==='manual'&&id!=='codebuddy'&&tutorials[id].map(([title,text,file,extra],i)=>makeStep(i+1,title,<><p>{text}</p>{extra==='config'&&fields}{file&&image(file,title)}</>))}
        {mode==='manual'&&id==='codebuddy'&&<>{makeStep(1,'创建或打开配置文件',<><p>用文本编辑器打开下面的配置文件。路径不存在时新建；已有配置请先备份。</p><CopyField label="macOS / Linux" value={`~/${directory}/models.json`} onToast={onToast}/><CopyField label="Windows" value={`%USERPROFILE%\\${directory}\\models.json`} onToast={onToast}/></>)}{makeStep(2,'粘贴配置并保存',<><p>包含参考站公开的 {setupModels.length} 个常用模型，配置内容已自动写入当前套餐密钥。</p>{keyReady?<CodeBlock value={config} label="models.json" onToast={onToast}/>:<div className="info-callout"><KeyRound size={17}/><span>{keyStatus}，配置文件将在读取完成后显示。</span></div>}<button className="button secondary" onClick={()=>doDownload('json')}><Download size={16}/>下载 models.json</button></>)}{makeStep(3,'选择自定义模型',<p>保存后约 1 秒热重载。打开 CodeBuddy，在模型下拉框选择自定义模型；未显示时重启 CodeBuddy 面板。</p>)}</>}
        {['windows','macos'].includes(mode)&&<>
          {makeStep(1,'下载配置工具',<><p>下载当前会员专属配置文件，已包含接口地址和套餐密钥。</p><div className="button-group"><button className="button primary" disabled={!keyReady} onClick={downloadSetup}><Download size={16}/>下载我的一键配置文件</button></div><p className="help-text">此文件包含您的套餐密钥，请勿转发。</p></>)}
          {makeStep(2,mode==='windows'?'双击运行':'运行配置文件',<><p>{mode==='windows'?`双击下载的 ${installStem}-setup.cmd`:`在终端运行 bash ~/Downloads/${installStem}-setup.command`}，完成后重启 {p.name}，无需另找密钥。</p><p>现有配置会先备份；未核实的模型能力沿用客户端默认值。</p></>)}
          {makeStep(3,'选择模型，开始使用',<><p>在模型菜单中选择自定义模型。积分余额和消费记录可在本站会员中心查看。</p>{id==='workbuddy'&&image('workbuddy-select-model.png','在对话框右下角选择自定义模型')}</>)}
        </>}
      </div>}</>}
    </div><section className="panel"><SectionHead title="可用模型与高级配置" text="复制模型 ID；设置输入 / 输出长度和图片输入能力。" action={<button className="text-link" onClick={()=>go('models')}>完整列表<ArrowRight size={15}/></button>}/><div className="table-scroll"><table className="data-table setup-model-table"><thead><tr><th>模型 ID</th><th>输入 / 输出</th><th>图片输入</th><th></th></tr></thead><tbody>{setupModels.map(m=>{const provider=providers.find(p=>p.id===m.provider)||providers.find(p=>p.id==='space');return <tr key={m.id}><td><span className="tutorial-model-cell"><ProviderMark provider={provider}/><code>{m.id}</code></span></td><td className="mono token-cell">{m.input.toLocaleString()}<small>{m.output.toLocaleString()}</small></td><td>{m.vision?<span className="capability"><Check size={14}/>支持</span>:<span className="muted">不支持</span>}</td><td><CopyButton value={m.id} label="复制 ID" onToast={onToast}/></td></tr>;})}</tbody></table></div></section></div>
    <aside className="tutorial-aside"><div className="panel"><span className="eyebrow">QUICK CHECK</span><h3>开始前，检查这三项</h3><ul className="check-list"><li><Check size={17}/>已安装对应的客户端</li><li><Check size={17}/>本页已自动读取当前套餐密钥</li><li><Check size={17}/>账户有可用积分</li></ul><div className="aside-divider"/><h4>配置遇到问题？</h4><p>错误码、模型选择和配置不生效，常见问题里都有排查说明。</p><button className="button secondary full" onClick={()=>go('faq')}>查看常见问题<ArrowRight size={15}/></button></div><div className="tip-card"><span>一个关键细节</span><h3>Auto ≠ auto</h3><p>大写 Auto 是客户端内置模型，选择小写 auto 才会使用你添加的自定义接口。</p></div></aside></div>
  </>;
}
