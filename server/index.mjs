import http from 'node:http';
import worker from '../dist/server/index.js';
import {openDatabase} from './database.mjs';
import {validHash} from './auth.mjs';
import {createHandler} from './http.mjs';
import {refreshMonitoring} from '../worker/api.mjs';
import {createMonitoringScheduler} from './scheduler.mjs';
const development = process.env.NODE_ENV==='development';
if (!validHash(process.env.OWNER_PASSWORD_HASH)) throw Error('Set OWNER_PASSWORD_HASH using the password-hash script');
const originURL = new URL(process.env.APP_ORIGIN || '');
if ((!development && originURL.protocol!=='https:') || originURL.pathname!=='/' || originURL.search || originURL.hash || originURL.username || originURL.password) throw Error('APP_ORIGIN must be the HTTPS origin assigned by Coolify');
const origin = originURL.origin;
const {pool,DB,MEMORY} = await openDatabase(process.env.DATABASE_URL);
pool.on('error',()=>console.error('Database idle connection failed; details withheld to protect credentials'));
const env = {...process.env,MONITOR_RUNTIME:'vps',DB,MEMORY};
const handler = createHandler({pool,env,worker,origin,development});
const server = http.createServer(async (req,res) => {
  try {
    if (req.url==='/healthz') { /* Health probes need no proxy Host configuration. */ }
    else if (req.headers.host!==originURL.host) {res.writeHead(421);res.end('Unexpected host');return;}
    const chunks=[];let size=0;
    for await (const chunk of req) {size+=chunk.length;if(size>1024*1024){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
    const requestURL = new URL(req.url,origin);
    if (requestURL.origin!==origin) {res.writeHead(400);res.end('Invalid request URL');return;}
    const request = new Request(requestURL,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const response = await handler(request);
    const headers = Object.fromEntries(response.headers);
    Object.assign(headers,{'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Cache-Control':'no-store'});
    res.writeHead(response.status,headers);
    res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500,{'Content-Type':'text/plain'});res.end('Request failed');console.error('Request failed; details withheld to protect credentials');}
});
server.requestTimeout=30000;server.headersTimeout=15000;
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Dots VPS server ready'));
let shuttingDown=false;
const scheduler=await createMonitoringScheduler({pool,env,refresh:refreshMonitoring,log:message=>console.error(message)});
async function shutdown() {
  if(shuttingDown)return;shuttingDown=true;
  server.close();
  await scheduler.stop();
  await pool.end();process.exit(0);
}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
