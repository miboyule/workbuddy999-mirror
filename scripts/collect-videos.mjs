import fs from 'node:fs/promises';
await fs.mkdir('public/videos',{recursive:true});
for (const type of ['windows','macos','manual']){const url=`https://workbuddy.miaotui.cc/videos/${type}.mp4`;const r=await fetch(url,{signal:AbortSignal.timeout(45000)});if(!r.ok){console.log(type,r.status);continue;}const b=Buffer.from(await r.arrayBuffer());await fs.writeFile(`public/videos/${type}.mp4`,b);console.log(type,b.length);}
const docs=await Promise.allSettled(['https://react.dev/reference/react/useState','https://react.dev/reference/react/useEffect','https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog'].map(async url=>({url,status:(await fetch(url)).status})));
console.log(docs);
