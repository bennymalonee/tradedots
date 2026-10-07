import http from 'node:http';
import worker from '../dist/server/index.js';
import {openDatabase} from './database.mjs';
import {validHash} from './auth.mjs';
import {createHandler} from './http.mjs';
import {refreshMonitoring} from '../worker/api.mjs';
const development = process.env.NODE_ENV==='development';
if (!validHash(process.env.OWNER_PASSWORD_HASH)) throw Error('Set OWNER_PASSWORD_HASH using the password-hash script');
const originURL = new URL(process.env.APP_ORIGIN || '');
if ((!development && originURL.protocol!=='https:') || originURL.pathname!=='/' || originURL.search || originURL.hash || originURL.username || originURL.password) throw Error('APP_ORIGIN must be the HTTPS origin assigned by Coolify');
const origin = originURL.origin;
const {pool,DB} = await openDatabase(process.env.DATABASE_URL);
const env = {...process.env,DB};
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
// A persistent PostgreSQL advisory lock allows only one scheduler across replicas.
const scheduler = await pool.connect();
const {rows:[lock]} = await scheduler.query('SELECT pg_try_advisory_lock(734021) AS acquired');
let timer;
const ownsScheduler = lock.acquired && process.env.MONITOR_ENABLED==='true';
if (ownsScheduler) {
  const interval = Math.max(60,Number(process.env.MONITOR_INTERVAL_SECONDS)||60)*1000;
  const cycle = async () => {
    try {
      await scheduler.query('SELECT 1');
      const result = await refreshMonitoring(env);
      if (Number(result.orders_submitted||0)!==0) throw Error('Unexpected broker execution');
    } catch {console.error('Monitoring cycle failed; will retry next interval');}
    if (!shuttingDown) timer=setTimeout(cycle,interval);
  };
  timer=setTimeout(cycle,5000);
} else {if(lock.acquired)await scheduler.query('SELECT pg_advisory_unlock(734021)');scheduler.release();console.log('Scheduler inactive (disabled or another instance owns it)');}
async function shutdown() {
  shuttingDown=true;clearTimeout(timer);
  server.close();
  if (ownsScheduler) {await scheduler.query('SELECT pg_advisory_unlock(734021)').catch(()=>{});scheduler.release();}
  await pool.end();process.exit(0);
}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
