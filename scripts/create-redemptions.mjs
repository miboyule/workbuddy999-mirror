import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { db, migrate } from '../server/db.mjs';
import { quotaForPoints, creditPlans as plans } from '../shared/billing.mjs';
await migrate();
const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(872001)');
  for(const plan of plans){
    const present=Number((await client.query('SELECT count(*) FROM portal_redemption_meta WHERE prefix=$1',[plan.prefix])).rows[0].count);
    const missing=Math.max(0,plan.count-present);
    const label=plan.points<10000?plan.points+'积分':plan.points/10000+'万积分';
    for(let offset=0;offset<missing;offset+=500){
      const count=Math.min(500,missing-offset);
      const codes=Array.from({length:count},()=>plan.prefix+'-'+randomBytes(8).toString('hex'));
      await client.query(`INSERT INTO redemptions(user_id,key,status,name,quota,created_time,redeemed_time,used_user_id,expired_time) SELECT 1,code,1,$2,$3,extract(epoch from now())::bigint,0,0,0 FROM unnest($1::text[]) AS code`,[codes,label+'·激活后一个月',quotaForPoints(plan.points)]);
      await client.query(`INSERT INTO portal_redemption_meta(code,prefix,points,label,validity,activated_at,expires_at,created_at,amount_cny) SELECT code,$2,$3,$4,'激活后一个月',0,0,extract(epoch from now())::bigint,$5 FROM unnest($1::text[]) AS code`,[codes,plan.prefix,plan.points,label,plan.amountCny]);
    }
    console.log(`${plan.prefix}: existing=${present} added=${missing} target=${plan.count}`);
  }
  await client.query('COMMIT');
  const rows=(await client.query(`SELECT trim(m.code) AS code,m.prefix,m.points,m.amount_cny,m.label,m.validity,m.activated_at,m.expires_at,r.status FROM portal_redemption_meta m JOIN redemptions r ON r.key=m.code ORDER BY m.prefix,m.code`)).rows;
  await mkdir(new URL('../data/exports/',import.meta.url),{recursive:true});
  const csv=['code,prefix,points,amount_cny,label,validity,status,activated_at,expires_at',...rows.map(x=>[x.code,x.prefix,x.points,x.amount_cny,x.label,x.validity,Number(x.status)===1?'未使用':'已使用',x.activated_at,x.expires_at].join(','))].join('\r\n');
  await writeFile(new URL('../data/redemptions.csv',import.meta.url),'\ufeff'+csv+'\n');
  await writeFile(new URL('../data/redemption-index.json',import.meta.url),JSON.stringify(Object.fromEntries(rows.map(x=>[x.code,{code:x.code,prefix:x.prefix,points:Number(x.points),amountCny:Number(x.amount_cny),label:x.label,validity:x.validity,activatedAt:Number(x.activated_at),expiresAt:Number(x.expires_at)}]))));
  for(const plan of plans){const available=rows.filter(x=>x.prefix===plan.prefix&&Number(x.status)===1);await writeFile(new URL(`../data/exports/${plan.prefix}-未使用.txt`,import.meta.url),available.map(x=>x.code).join('\r\n')+'\r\n');}
  await writeFile(new URL('../data/exports/批次清单.json',import.meta.url),JSON.stringify({updatedAt:new Date().toISOString(),total:rows.length,plans:plans.map(p=>({...p,unused:rows.filter(x=>x.prefix===p.prefix&&Number(x.status)===1).length}))},null,2));
  console.log(JSON.stringify({total:rows.length,unused:rows.filter(x=>Number(x.status)===1).length,export:'data/exports'},null,2));
} catch(error){await client.query('ROLLBACK');throw error;} finally {client.release();await db.end();}
