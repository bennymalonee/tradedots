import {cookieToken, tokenHash, sameOrigin, login} from './auth.mjs';
const loginPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DotsTrading · Sign in</title><style>body{background:#100e07;color:#e7d98e;font:16px system-ui;margin:0;display:grid;min-height:100vh;place-items:center}main{padding:32px;border:1px solid #786329;width:min(340px,80vw)}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:16px}button{background:#e7c763;border:0;font-weight:700}p{line-height:1.5}</style></head><body><main><h1>DotsTrading</h1><p>Private ledger desk. Sign in with your owner password.</p><form action="/login" method="post"><label>Password<input type="password" name="password" autocomplete="current-password" maxlength="512" required></label><button>Sign in</button></form></main></body></html>`;
export function createHandler({pool, env, worker, origin, development=false}) {
  const cookieName = development ? 'dots_session' : '__Host-dots_session';
  const cookie = (token, age=28800) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${development?'':'; Secure'}`;
  const reply = (text,status,headers={}) => new Response(text,{status,headers:{'Cache-Control':'no-store',...headers}});
  return async request => {
    const path = new URL(request.url).pathname;
    if (path === '/healthz' && request.method==='GET') {
      try {await pool.query('SELECT 1'); return reply('ok',200);} catch {return reply('unavailable',503);}
    }
    if (path==='/login' && request.method==='GET') return reply(loginPage,200,{'Content-Type':'text/html; charset=utf-8'});
    // Require Origin on EVERY public state-changing request, including shared tick endpoints.
    if (!['GET','HEAD'].includes(request.method) && !sameOrigin(request,origin)) return reply('Same-origin request required',403);
    if (path==='/login' && request.method==='POST') {
      const form = new URLSearchParams(await request.text());
      const result = await login(pool,form.get('password'),env.OWNER_PASSWORD_HASH);
      if (result.status!==200) return reply(result.status===429?'Too many attempts. Wait 15 minutes.':'Password was not accepted.',result.status);
      return reply('',303,{'Location':'/','Set-Cookie':cookie(result.token)});
    }
    const token = cookieToken(request.headers.get('cookie'),cookieName);
    const signedIn = token && (await pool.query('SELECT token_hash FROM owner_sessions WHERE token_hash=$1 AND expires_at>now()',[tokenHash(token)])).rowCount===1;
    if (!signedIn) return path.startsWith('/api/') ? reply('{"error":"Sign in required"}',401,{'Content-Type':'application/json'}) : reply('',303,{'Location':'/login'});
    if (path==='/logout' && request.method==='POST') {
      await pool.query('DELETE FROM owner_sessions WHERE token_hash=$1',[tokenHash(token)]);
      return reply('',303,{'Location':'/login','Set-Cookie':cookie('',0)});
    }
    const headers = new Headers(request.headers);
    // Never trust visitor-supplied ChatGPT Sites identity or service headers.
    for (const name of [...headers.keys()]) if (name.startsWith('oai-')) headers.delete(name);
    headers.set('oai-authenticated-user-id','vps-owner');
    const authenticated = new Request(request.url,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer()});
    const response = await worker.fetch(authenticated,env,{});
    if (path==='/') {
      const html = (await response.text()).replace('</body>','<form action="/logout" method="post" style="margin:16px;text-align:right"><button type="submit">Sign out</button></form></body>');
      return new Response(html,{status:response.status,headers:response.headers});
    }
    return response;
  };
}
