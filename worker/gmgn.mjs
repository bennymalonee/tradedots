import {readState,mutate} from './paper.mjs';

// Only public wallet research routes are permitted. This adapter has no signing key,
// broker connection, account endpoint, order endpoint, or execution capability.
const gmgnHOST='https://openapi.gmgn.ai';
const gmgnROUTES=new Set(['/v1/user/smartmoney','/v1/user/wallet_profits','/v1/user/wallet_activity']);
const gmgnAAD=new TextEncoder().encode('dots-ledger-gmgn-connection-v1');
const gmgnMAX_BODY=1024*1024,gmgnINTERVAL=10000,gmgnDAILY_CAP=100,gmgnCACHE=300000;
const gmgnB58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const gmgnB64=gmgnBytes=>btoa(String.fromCharCode(...gmgnBytes));
const gmgnBytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const gmgnDay=now=>new Date(now).toISOString().slice(0,10);
const gmgnText=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,60):'';
const gmgnErrors={rate_limited:'GMGN is rate limited; wait for the displayed retry time.',rejected:'GMGN rejected the API key or endpoint access.',unavailable:'GMGN could not be reached; retry later.',invalid_response:'GMGN returned an unsupported response; no report was saved.',connection_changed:'GMGN connection changed; the old response was discarded.'};

function gmgnValidAddress(value){
 if(typeof value!=='string'||value.length<32||value.length>44)return false;
 let n=0n;for(const c of value){const digit=gmgnB58.indexOf(c);if(digit<0)return false;n=n*58n+BigInt(digit);}
 let length=0;for(let q=n;q>0n;q>>=8n)length++;
 for(const c of value){if(c!=='1')break;length++;}
 return length===32;
}
function gmgnAddressInput(input){
 if(input.chain!==undefined&&input.chain!=='sol')throw Error('Wallet research supports Solana only');
 const address=typeof input.address==='string'?input.address.trim():'';
 if(!gmgnValidAddress(address))throw Error('Enter a valid 32-byte Solana wallet address');
 return address;
}
function gmgnScalar(value){
 if(typeof value==='string'&&value.length<=100&&/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))value=Number(value);
 return typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e15?value:null;
}
function gmgnCount(value){const n=gmgnScalar(value);return Number.isSafeInteger(n)&&n>=0?n:null;}
function gmgnUrl(address){return 'https://gmgn.ai/sol/address/'+address;}
function gmgnInit(state){const r=state.gmgn ||= {epoch:0,watchlist:[],reports:[],discovery:{at:null,wallets:[]},usage:{},lease:null,next_request_at:0,cooldown_until:0,error_code:null,last_checked_at:null};r.activities ||= [];return r;}
function gmgnMasterBytes(env){try{const raw=gmgnBytes(env.RESEARCH_ENCRYPTION_KEY||'');return raw.length===32?raw:null;}catch{return null;}}
async function gmgnMaster(env){const raw=gmgnMasterBytes(env);if(!raw)throw Error('Secure API setup is not configured on the server');return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);}
function gmgnApiKey(value){if(typeof value!=='string'||value.length<16||value.length>512||!/^[A-Za-z0-9._~-]+$/.test(value))throw Error('Enter a GMGN API key, not a password or browser session');return value;}
function gmgnConfigured(state,env){return !state.gmgn_connection?.disabled&&Boolean(state.gmgn_connection?.ciphertext&&gmgnMasterBytes(env)||env.GMGN_API_KEY&&!state.gmgn_connection?.ciphertext);}
async function gmgnResolveKey(state,env){
 if(!gmgnConfigured(state,env))throw Error('Connect a GMGN API key before requesting wallet research');
 const saved=state.gmgn_connection;
 if(!saved?.ciphertext)return gmgnApiKey(env.GMGN_API_KEY);
 try{const decoded=await crypto.subtle.decrypt({name:'AES-GCM',iv:gmgnBytes(saved.iv),additionalData:gmgnAAD},await gmgnMaster(env),gmgnBytes(saved.ciphertext));return gmgnApiKey(new TextDecoder().decode(decoded));}
 catch{throw Error('Saved GMGN connection cannot be opened; reconnect in API Setup');}
}
function gmgnPublicWallet(row,watch=false){
 if(!row||!gmgnValidAddress(row.address))return null;
 const result={address:row.address,chain:'sol',label:gmgnText(row.label),gmgn_url:gmgnUrl(row.address)};
 return watch?{...result,added_at:gmgnScalar(row.added_at)}:{...result,observed_at:gmgnScalar(row.observed_at),last_side:['buy','sell'].includes(row.last_side)?row.last_side:null};
}
function gmgnPublicActivity(row){
 if(!row||!gmgnValidAddress(row.address))return null;
 const rows=Array.isArray(row.activities)?row.activities:[];
 return{address:row.address,chain:'sol',observed_at:gmgnScalar(row.observed_at),history_status:'partial',history_has_more:row.history_has_more===true,activities:rows.slice(0,10).map(item=>({side:['buy','sell','transferIn','transferOut','add','remove'].includes(item.side)?item.side:null,at:gmgnScalar(item.at),token_address:gmgnValidAddress(item.token_address)?item.token_address:null,symbol:gmgnText(item.symbol),amount_usd:gmgnScalar(item.amount_usd),token_amount:gmgnScalar(item.token_amount),price_usd:gmgnScalar(item.price_usd),transaction_hash:typeof item.transaction_hash==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(item.transaction_hash)?item.transaction_hash:null})),note:'Up to 10 recent provider records. This sample is not complete trade history and cannot establish copy-trading returns.'};
}
function gmgnPublicReport(row,history=null){
 if(!row||!gmgnValidAddress(row.address)||!['7d','30d'].includes(row.period))return null;
 const realized_profit=gmgnScalar(row.realized_profit),realized_profit_cost=gmgnScalar(row.realized_profit_cost);
 const roi=realized_profit!==null&&realized_profit_cost>0?gmgnScalar(realized_profit/realized_profit_cost):null;
 return{id:typeof row.id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(row.id)?row.id:null,address:row.address,chain:'sol',period:row.period,at:gmgnScalar(row.at),gmgn_url:gmgnUrl(row.address),realized_profit,realized_profit_cost,realized_roi:roi,buy_count:gmgnCount(row.buy_count),sell_count:gmgnCount(row.sell_count),history_status:history?'partial':'not_loaded',history_has_more:history?.history_has_more??null,history_observed_at:history?.observed_at??null,activities:history?.activities||[],note:'Provider-reported period PnL; approximate USD values. Trade history, transfer accounting and copy returns have not been independently verified.'};
}
export function gmgnSummary(state,env){
 const r=state.gmgn||{},saved=state.gmgn_connection,now=Date.now(),ready=gmgnConfigured(state,env),rateLimited=Number(r.cooldown_until)>now;
 return{provider:'GMGN',configured:ready,secure_setup_ready:!!gmgnMasterBytes(env),source:ready?saved?.ciphertext?'setup':'hosting':'none',verified_at:ready?gmgnScalar(saved?.verified_at??r.verified_at):null,last_checked_at:gmgnScalar(r.last_checked_at),status:!ready?'disconnected':rateLimited?'rate_limited':r.error_code?'error':(saved?.verified_at||r.verified_at)?'connected':'configured',error:ready?gmgnErrors[r.error_code]||null:null,readonly:true};
}
function gmgnResponseShape(state,env){
 const r=state.gmgn||{},now=Date.now(),calls=gmgnCount(r.usage?.[gmgnDay(now)])||0;
 const activities=(Array.isArray(r.activities)?r.activities:[]).slice(0,20).map(gmgnPublicActivity).filter(Boolean);
 return{connection:gmgnSummary(state,env),watchlist:(Array.isArray(r.watchlist)?r.watchlist:[]).slice(0,10).map(row=>gmgnPublicWallet(row,true)).filter(Boolean),discovery:{at:gmgnScalar(r.discovery?.at),wallets:(Array.isArray(r.discovery?.wallets)?r.discovery.wallets:[]).slice(0,10).map(row=>gmgnPublicWallet(row)).filter(Boolean),note:'Recent platform-tagged activity; not a profitability ranking.'},reports:(Array.isArray(r.reports)?r.reports:[]).slice(0,20).map(row=>gmgnPublicReport(row,activities.find(h=>h.address===row.address))).filter(Boolean),activities,limits:{max_watchlist:10,max_daily_requests:gmgnDAILY_CAP,requests_today:calls,remaining_today:Math.max(0,gmgnDAILY_CAP-calls),min_request_interval_seconds:10,next_request_at:Math.max(gmgnScalar(r.next_request_at)||0,gmgnScalar(r.cooldown_until)||0),cooldown_until:gmgnScalar(r.cooldown_until)||0,busy:!!r.lease&&r.lease.until>now,provider_queries_automatic:false}};
}
export async function getWalletResearch(env){const {state}=await readState(env.DB);return gmgnResponseShape(state,env);}

function gmgnFail(code,retryAt=0){const error=new Error(gmgnErrors[code]||gmgnErrors.unavailable);error.gmgn_code=code;error.retry_at=retryAt;return error;}
function gmgnResetTime(value,now,relative=false){
 const n=gmgnScalar(value);if(n===null||n<=0)return 0;
 const at=relative?now+n*1000:n>1e12?n:n*1000;
 return Number.isFinite(at)&&at>now?Math.min(at,now+7*86400000):0;
}
function gmgnRetryTime(response,body,now){
 const retry=response.headers.get('retry-after'),relative=retry!==null&&/^\d+(?:\.\d+)?$/.test(retry.trim());
 const dateRetry=retry&&!relative?Date.parse(retry):0;
 const candidates=[now+60000,relative?gmgnResetTime(retry,now,true):Number.isFinite(dateRetry)?dateRetry:0,gmgnResetTime(response.headers.get('x-ratelimit-reset'),now),gmgnResetTime(response.headers.get('x-ratelimit-reset-unix'),now),gmgnResetTime(body?.reset_at,now),gmgnResetTime(body?.reset_at_unix,now),gmgnResetTime(body?.retry_after,now,true),gmgnResetTime(body?.data?.reset_at,now)];
 return Math.min(Math.max(...candidates),now+7*86400000);
}
async function gmgnBoundedJson(response){
 const size=Number(response.headers.get('content-length'));if(size>gmgnMAX_BODY){await response.body?.cancel();throw gmgnFail('invalid_response');}
 if(!response.body)throw gmgnFail('invalid_response');
 const reader=response.body.getReader(),chunks=[];let total=0;
 try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>gmgnMAX_BODY){await reader.cancel();throw gmgnFail('invalid_response');}chunks.push(part.value);}}
 finally{reader.releaseLock();}
 const buffer=new Uint8Array(total);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder().decode(buffer));}catch{throw gmgnFail('invalid_response');}
}
async function gmgnProvider(key,path,gmgnQuery={},body=null){
 if(!gmgnROUTES.has(path))throw gmgnFail('invalid_response');
 const target=new URL(gmgnHOST+path);for(const [name,value]of Object.entries(gmgnQuery))target.searchParams.set(name,String(value));
 target.searchParams.set('timestamp',String(Math.floor(Date.now()/1000)));target.searchParams.set('client_id',crypto.randomUUID());
 let reply;try{reply=await fetch(target,{method:body===null?'GET':'POST',headers:{'X-APIKEY':key,'Content-Type':'application/json','User-Agent':'dots-ledger-wallet-research/1'},body:body===null?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(12000)});}catch{throw gmgnFail('unavailable');}
 if([401,403].includes(reply.status)){try{await reply.body?.cancel();}catch{}throw gmgnFail('rejected');}
 let envelope;try{envelope=await gmgnBoundedJson(reply);}catch(error){if(reply.status===429)throw gmgnFail('rate_limited',gmgnRetryTime(reply,null,Date.now()));throw error;}
 const rateError=value=>value?.error==='RATE_LIMIT_EXCEEDED'||value?.error==='RATE_LIMIT_BANNED'||Number(value?.code)===429;
 if(reply.status===429||rateError(envelope)||rateError(envelope?.data))throw gmgnFail('rate_limited',gmgnRetryTime(reply,envelope,Date.now()));
 if(!reply.ok)throw gmgnFail([401,403].includes(reply.status)?'rejected':'unavailable');
 let value=envelope;
 for(let depth=0;depth<4;depth++){
  if(rateError(value))throw gmgnFail('rate_limited',gmgnRetryTime(reply,value,Date.now()));
  if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,'code')){
   if(value.code!==0&&value.code!=='0')throw gmgnFail('rejected');
   if(!Object.hasOwn(value,'data'))throw gmgnFail('invalid_response');value=value.data;continue;
  }
  if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&Object.hasOwn(value,'data')){value=value.data;continue;}
  break;
 }
 if(!value||typeof value!=='object')throw gmgnFail('invalid_response');return value;
}
function gmgnDiscoveryRows(value,now){
 if(!Array.isArray(value.list))throw gmgnFail('invalid_response');
 const seen=new Set(),wallets=[];
 for(const row of value.list.slice(0,100)){
  if(!row||row.chain!==undefined&&row.chain!=='sol'||!gmgnValidAddress(row.maker)||seen.has(row.maker))continue;seen.add(row.maker);
  wallets.push({address:row.maker,chain:'sol',label:gmgnText(row.maker_info?.name||row.maker_info?.twitter_username),gmgn_url:gmgnUrl(row.maker),observed_at:now,last_side:['buy','sell'].includes(row.side)?row.side:null});
  if(wallets.length===10)break;
 }
 return{at:now,wallets};
}
function gmgnProfitReport(value,address,period,now){
 if(!Array.isArray(value.list)||value.period!==undefined&&value.period!==period)throw gmgnFail('invalid_response');
 const row=value.list.find(row=>row?.wallet_address===address&&(row.chain===undefined||row.chain==='sol')&&(row.period===undefined||row.period===period));
 if(!row)throw gmgnFail('invalid_response');
 const report={id:crypto.randomUUID(),address,period,at:now,realized_profit:gmgnScalar(row.realized_profit),realized_profit_cost:gmgnScalar(row.realized_profit_cost),buy_count:gmgnCount(row.buy??row.buy_count),sell_count:gmgnCount(row.sell??row.sell_count)};
 // Never replace missing selected-period fields with cumulative total_profit.
 if(report.realized_profit===null&&report.buy_count===null&&report.sell_count===null)throw gmgnFail('invalid_response');
 return report;
}
function gmgnActivityRows(value,address,now){
 if(!Array.isArray(value.activities))throw gmgnFail('invalid_response');
 const activities=value.activities.slice(0,10).filter(row=>row&&typeof row==='object'&&[row.chain,row.token?.chain].every(chain=>chain===undefined||chain==='sol')&&[row.wallet_address,row.wallet,row.maker,row.owner].every(owner=>owner===undefined||owner===address)).map(row=>({side:['buy','sell','transferIn','transferOut','add','remove'].includes(row.event_type??row.type??row.side)?row.event_type??row.type??row.side:null,at:gmgnCount(row.timestamp)>0&&gmgnCount(row.timestamp)<=Math.floor(now/1000)+60?gmgnCount(row.timestamp)*1000:null,token_address:gmgnValidAddress(row.token?.address)?row.token.address:null,symbol:gmgnText(row.token?.symbol),amount_usd:gmgnScalar(row.cost_usd??row.amount_usd),token_amount:gmgnScalar(row.token_amount??row.amount),price_usd:gmgnScalar(row.price_usd),transaction_hash:row.tx_hash??row.transaction_hash??null}));
 return{address,observed_at:now,history_has_more:typeof value.next==='string'&&value.next.length>0,activities};
}
async function gmgnQuery(env,kind,{address=null,period=null,allowCache=true,candidateKey=null,candidateCipher=null}={}){
 const {state}=await readState(env.DB);if(!candidateCipher&&!gmgnConfigured(state,env))throw Error('Connect a GMGN API key before requesting wallet research');
 const now=Date.now(),r=state.gmgn;
 if(allowCache&&(kind==='discover'&&r?.discovery?.at>now-60000||kind==='analyze'&&r?.reports?.some(p=>p.address===address&&p.period===period&&p.at>now-gmgnCACHE)||kind==='activity'&&r?.activities?.some(p=>p.address===address&&p.observed_at>now-60000)))return{ok:true,...gmgnResponseShape(state,env)};
 const key=candidateKey||await gmgnResolveKey(state,env),epoch=state.gmgn?.epoch||0,token=crypto.randomUUID();
 const reserved=await mutate(env.DB,s=>{
  const g=gmgnInit(s),at=Date.now();if((g.epoch||0)!==epoch||!candidateCipher&&!gmgnConfigured(s,env))throw gmgnFail('connection_changed');
  if(g.lease?.until>at)throw Error('GMGN research is already running');
  if((g.cooldown_until||0)>at)throw gmgnFail('rate_limited',g.cooldown_until);
  if((g.next_request_at||0)>at)throw Error('Wait for the displayed GMGN retry time');
  const today=gmgnDay(at);if((g.usage[today]||0)>=gmgnDAILY_CAP)throw Error('Daily GMGN research request limit reached');
  for(const d of Object.keys(g.usage))if(d<gmgnDay(at-7*86400000))delete g.usage[d];
  g.usage[today]=(g.usage[today]||0)+1;g.next_request_at=at+gmgnINTERVAL;g.lease={token,epoch,until:at+30000};return{claimed:true};
 });
 if(!reserved.result.claimed)throw Error('GMGN research could not be reserved');
 try{
  const value=kind==='analyze'?await gmgnProvider(key,'/v1/user/wallet_profits',{}, {chain:'sol',period,wallet_addresses:[address]}):kind==='activity'?await gmgnProvider(key,'/v1/user/wallet_activity',{chain:'sol',wallet_address:address,limit:10}):await gmgnProvider(key,'/v1/user/smartmoney',{chain:'sol',limit:10});
  const at=Date.now(),normalized=kind==='analyze'?gmgnProfitReport(value,address,period,at):kind==='activity'?gmgnActivityRows(value,address,at):gmgnDiscoveryRows(value,at);
  const saved=await mutate(env.DB,s=>{
   const g=gmgnInit(s);if(g.lease?.token!==token||(g.epoch||0)!==epoch||!candidateCipher&&!gmgnConfigured(s,env))return{stale:true};
   if(candidateCipher){s.gmgn_connection={...candidateCipher,verified_at:at};g.epoch=(g.epoch||0)+1;}
   g.lease=null;g.error_code=null;g.last_checked_at=at;g.verified_at=at;if(s.gmgn_connection)s.gmgn_connection.verified_at=at;
   if(kind==='analyze'){g.reports=g.reports.filter(p=>!(p.address===address&&p.period===period));g.reports.unshift(normalized);g.reports=g.reports.slice(0,20);}else if(kind==='activity'){g.activities=g.activities.filter(p=>p.address!==address);g.activities.unshift(normalized);g.activities=g.activities.slice(0,20);}else g.discovery=normalized;
   return{ok:true};
  });
  if(saved.result.stale)throw gmgnFail('connection_changed');
  return{ok:true,...gmgnResponseShape(saved.state,env)};
 }catch(error){
  const code=Object.hasOwn(gmgnErrors,error.gmgn_code)?error.gmgn_code:'unavailable';
  await mutate(env.DB,s=>{const g=gmgnInit(s);if(g.lease?.token!==token||(g.epoch||0)!==epoch)return null;g.lease=null;if(!candidateCipher||!gmgnConfigured(s,env)||code==='rate_limited')g.error_code=code;g.last_checked_at=Date.now();if(code==='rate_limited')g.cooldown_until=Math.max(g.cooldown_until||0,error.retry_at||Date.now()+60000);return null;});
  if(candidateCipher&&gmgnConfigured(state,env)&&code==='rejected')throw Error('GMGN rejected the new API key; the existing connection was kept');
  throw gmgnFail(code,error.retry_at||0);
 }
}
export async function gmgnConnection(env,input={}){
 if(input.action==='disconnect'){
  const updated=await mutate(env.DB,s=>{const g=gmgnInit(s);g.epoch=(g.epoch||0)+1;g.lease=null;g.error_code=null;g.verified_at=null;s.gmgn_connection={version:1,disabled:true};return null;});
  return{ok:true,...gmgnResponseShape(updated.state,env)};
 }
 if(input.action==='test')return gmgnQuery(env,'test',{allowCache:false});
 if(input.action!=='connect')throw Error('Choose connect, test or disconnect');
 const supplied=input.api_key!==undefined&&input.api_key!=='';let saved={version:1,disabled:false,verified_at:null},key;
 if(supplied){key=gmgnApiKey(typeof input.api_key==='string'?input.api_key.trim():input.api_key);const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:gmgnAAD},await gmgnMaster(env),new TextEncoder().encode(key));saved={...saved,iv:gmgnB64(iv),ciphertext:gmgnB64(new Uint8Array(encrypted))};}
 else key=gmgnApiKey(env.GMGN_API_KEY);
 return gmgnQuery(env,'test',{allowCache:false,candidateKey:key,candidateCipher:saved});
}
export async function gmgnDiscover(env,input={}){if(input.chain!==undefined&&input.chain!=='sol')throw Error('Wallet research supports Solana only');return gmgnQuery(env,'discover');}
export async function gmgnAnalyze(env,input={}){const address=gmgnAddressInput(input),period=input.period??'7d';if(!['7d','30d'].includes(period))throw Error('Choose a 7d or 30d research period');return gmgnQuery(env,'analyze',{address,period});}
export async function gmgnActivity(env,input={}){return gmgnQuery(env,'activity',{address:gmgnAddressInput(input)});}
export async function gmgnWatch(env,input={}){
 const address=gmgnAddressInput(input);if(!['add','remove'].includes(input.action))throw Error('Choose add or remove');
 if(input.label!==undefined&&(typeof input.label!=='string'||input.label.length>60||/[\u0000-\u001f\u007f]/.test(input.label)))throw Error('Wallet labels must be at most 60 characters');
 const updated=await mutate(env.DB,s=>{const g=gmgnInit(s);if(input.action==='remove')g.watchlist=g.watchlist.filter(w=>w.address!==address);else{const existing=g.watchlist.find(w=>w.address===address);if(existing){if(input.label!==undefined)existing.label=gmgnText(input.label);}else{if(g.watchlist.length>=10)throw Error('Watch up to 10 Solana wallets');g.watchlist.push({address,chain:'sol',label:gmgnText(input.label),added_at:Date.now()});}}return null;});
 return{ok:true,...gmgnResponseShape(updated.state,env)};
}
