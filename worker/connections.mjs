import {readState,mutate} from './paper.mjs';
const connectionAAD=new TextEncoder().encode('dots-ledger-ai-connection-v1');
const connectionBase64=bytes=>btoa(String.fromCharCode(...bytes));
const connectionBytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function connectionMaster(env){
 try{const raw=connectionBytes(env.RESEARCH_ENCRYPTION_KEY||'');if(raw.length!==32)throw Error();return await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);}
 catch{throw Error('Secure API setup is not configured on the server');}
}
export function connectionSummary(state,env){
 const saved=state.ai_connection;
 return{configured:Boolean((saved?.ciphertext&&env.RESEARCH_ENCRYPTION_KEY)||env.OPENAI_API_KEY),secure_setup_ready:!!env.RESEARCH_ENCRYPTION_KEY,source:saved?.ciphertext?'setup':env.OPENAI_API_KEY?'hosting':'none',provider:'OpenAI',model:env.OPENAI_RESEARCH_MODEL||'gpt-4.1-mini',verified_at:saved?.verified_at||null,chatgpt_subscription_linkable:false};
}
export async function resolveResearchEnv(env){
 const {state}=await readState(env.DB),saved=state.ai_connection;
 if(!saved?.ciphertext)return env;
 try{const key=await connectionMaster(env);const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:connectionBytes(saved.iv),additionalData:connectionAAD},key,connectionBytes(saved.ciphertext));return{...env,OPENAI_API_KEY:new TextDecoder().decode(bytes)};}
 catch{throw Error('Saved AI connection cannot be opened; reconnect in API Setup');}
}
export async function saveResearchConnection(env,input){
 if(input.action==='disconnect'){
  await mutate(env.DB,s=>{delete s.ai_connection;if(s.research){s.research.enabled=false;s.research.connection_epoch=(s.research.connection_epoch||0)+1;}return{ok:true}});
  const {state}=await readState(env.DB);return{ok:true,...connectionSummary(state,env)};
 }
 if(input.action!=='connect')throw Error('Choose connect or disconnect');
 const value=typeof input.api_key==='string'?input.api_key.trim():'';
 if(!/^sk-[A-Za-z0-9_-]{20,500}$/.test(value))throw Error('Enter an OpenAI API key, not a ChatGPT password or session token');
 const master=await connectionMaster(env),model=env.OPENAI_RESEARCH_MODEL||'gpt-4.1-mini';
 if(!/^[a-zA-Z0-9._-]{1,80}$/.test(model))throw Error('Invalid model configuration');
 // Model access verification consumes no inference tokens; provider quota may still apply.
 let check;try{check=await fetch('https://api.openai.com/v1/models/'+encodeURIComponent(model),{headers:{Authorization:'Bearer '+value},signal:AbortSignal.timeout(12000)});}catch{throw Error('Could not reach the AI provider; nothing was saved');}
 if(!check.ok)throw Error(check.status===401?'The API key was rejected; nothing was saved':'Provider model check returned HTTP '+check.status+'; nothing was saved');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:connectionAAD},master,new TextEncoder().encode(value));
 const verified_at=Date.now();
 await mutate(env.DB,s=>{s.ai_connection={version:1,iv:connectionBase64(iv),ciphertext:connectionBase64(new Uint8Array(encrypted)),verified_at};if(s.research){s.research.enabled=false;s.research.connection_epoch=(s.research.connection_epoch||0)+1;}return{ok:true}});
 const {state}=await readState(env.DB);return{ok:true,...connectionSummary(state,env)};
}
