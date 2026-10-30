import fs from 'node:fs/promises';
import path from 'node:path';
const dir='docs/reference';
const docs=await Promise.all((await fs.readdir(dir)).filter(n=>n.endsWith('.json')).map(async n=>JSON.parse(await fs.readFile(path.join(dir,n),'utf8'))));
const assets=new Map();
for(const d of docs){for(const img of d.images||[]) if(img.url.startsWith('https://workbuddy.miaotui.cc/setup/')) assets.set(img.url,'public/tutorials/'+img.url.split('/').pop());}
assets.set('https://assets.workbuddy.cn/web/workbuddy/a5b2fb510f0e7b156f19d072fae0cd12ae1f2f19/assets/workbuddy-logo-WhgOvEF7.png','public/brand/workbuddy.png');
const results=await Promise.allSettled([...assets].map(async ([url,file])=>{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`${r.status} ${url}`);const data=Buffer.from(await r.arrayBuffer());await fs.writeFile(file,data);return {url,file,bytes:data.length};}));
await fs.writeFile('docs/reference/assets-manifest.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>r.status==='fulfilled'?r.value:{error:String(r.reason)}),null,2));
