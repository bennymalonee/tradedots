(() => {
 let latest=null;
 const n=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e;};
 function ensure(){
  let dialog=document.querySelector('#api-setup');if(dialog)return dialog;
  dialog=document.createElement('dialog');dialog.id='api-setup';dialog.className='api-setup';
  const close=n('button','×','close');close.type='button';close.setAttribute('aria-label','Close API setup');close.onclick=()=>dialog.close();dialog.append(close,n('small','DOTSTRADING / PRIVATE CONNECTION'),n('h2','API setup & ChatGPT review'));
  dialog.append(n('p','Automated agent reasoning uses an OpenAI API key. Your ChatGPT subscription works in ChatGPT and does not include API usage.','connection-help'));
  const status=n('p','','api-connection-status');status.setAttribute('role','status');dialog.append(status);
  const form=document.createElement('form');form.autocomplete='off';
  const label=n('label','OpenAI API key');const key=document.createElement('input');key.type='password';key.name='api_key';key.autocomplete='off';key.spellcheck=false;key.maxLength=512;key.placeholder='sk-…';key.required=true;label.append(key);form.append(label);
  const help=n('p','Sent over HTTPS and encrypted on the server. Never returned to the browser or included in exports. Do not enter a ChatGPT password or session token.','connection-help');form.append(help);
  const save=n('button','VERIFY & SAVE API KEY');save.type='submit';form.append(save);dialog.append(form);
  form.onsubmit=async event=>{event.preventDefault();let submitted=key.value;key.value='';save.disabled=true;status.textContent='Verifying provider access and saving the encrypted key…';
   try{const response=await fetch('/api/research/connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'connect',api_key:submitted})});submitted='';const value=await response.json();if(!response.ok)throw Error(value.error||'Connection failed');status.textContent='API key verified and encrypted. Scheduled paid research remains off. Model calls also require API billing and quota.';window.dispatchEvent(new Event('desk-refresh'));}
   catch(error){status.textContent=error.message;}finally{submitted='';save.disabled=false;}
  };
  const links=n('div','','connection-links');const create=n('a','Create an OpenAI API key');create.href='https://platform.openai.com/api-keys';create.target='_blank';create.rel='noopener noreferrer';links.append(create);
  const disconnect=n('button','DISCONNECT SAVED KEY');disconnect.type='button';disconnect.onclick=async()=>{disconnect.disabled=true;try{const r=await fetch('/api/research/connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'disconnect'})});const v=await r.json();if(!r.ok)throw Error(v.error||'Disconnect failed');status.textContent=v.source==='hosting'?'Saved key removed. A separate hosting-configured key remains active. Scheduled research is off.':'Saved key removed. Scheduled AI research is off.';key.value='';window.dispatchEvent(new Event('desk-refresh'));}catch(error){status.textContent=error.message;}finally{disconnect.disabled=false;}};links.append(disconnect);dialog.append(links);
  const review=n('section','','chatgpt-manual');review.append(n('h3','Use your ChatGPT subscription for manual review'),n('p','Copy the public quote evidence and virtual simulation results, then paste them into ChatGPT. This does not connect your subscription to unattended agents.'));
  const copy=n('button','COPY RESEARCH PACKET');copy.type='button';const packet=document.createElement('textarea');packet.readOnly=true;packet.rows=8;packet.hidden=true;packet.setAttribute('aria-label','Research packet for manual ChatGPT review');
  copy.onclick=async()=>{if(!latest){status.textContent='Wait for dashboard data before copying a research packet.';return;}const s=latest.simulation;const stats=a=>a?{equity:a.equity,pnl:a.pnl,closed_trades:a.closed_trades,fees:a.fees,max_drawdown_pct:a.max_drawdown_pct}:null;
   const text=JSON.stringify({instruction:'Review this experimental trading simulation and challenge its assumptions. Identify missing evidence, costs, overfitting and whether adaptive performance improves on the baseline. Do not invent news or returns. Do not execute orders.',as_of:latest.generated_at,quotes:(latest.markets||[]).filter(q=>['stocks','crypto'].includes(q.asset_class)).slice(0,8).map(q=>({symbol:q.symbol,price:q.price,bid:q.bid,ask:q.ask,quote_at:q.quote_at||q.fetched_at,cached:!!q.cached})),learning:latest.learning?{evaluated:latest.learning.evaluated,methods:latest.learning.methods}:null,simulation:{adaptive:stats(s?.adaptive),baseline:stats(s?.baseline),improvement:s?.improvement,limits:s?.limits},research:(latest.research?.reports||[]).slice(0,2).map(r=>({mode:r.mode,status:r.status,symbol:r.symbol,agents:r.agents,outcome:r.outcome}))},null,2);
   packet.value=text;packet.hidden=false;
   try{await navigator.clipboard.writeText(text);status.textContent='Research packet copied. Open ChatGPT and paste it for manual review.';}catch{packet.focus();packet.select();status.textContent='Select and copy the research packet below, then paste it into ChatGPT.';}
  };
  const open=n('a','Open ChatGPT');open.href='https://chatgpt.com/';open.target='_blank';open.rel='noopener noreferrer';review.append(copy,document.createTextNode(' '),open,packet);dialog.append(review);
  dialog.addEventListener('close',()=>{key.value='';packet.value='';packet.hidden=true;});document.body.append(dialog);return dialog;
 }
 window.addEventListener('desk-data',event=>{latest=event.detail;const panel=document.querySelector('#research-room');if(!panel)return;
  let controls=panel.querySelector('.api-setup-access');if(!controls){controls=n('div','','api-setup-access sim-controls');const setup=n('button','API SETUP');setup.type='button';setup.onclick=()=>{const dialog=ensure(),c=latest.research?.connection;dialog.querySelector('.api-connection-status').textContent=c?.configured?'OpenAI API configured · '+c.model+(c.verified_at?' · verified '+new Date(c.verified_at).toLocaleString():''):'No OpenAI API key connected.';dialog.querySelector('input[name=api_key]').disabled=!c?.secure_setup_ready;dialog.querySelector('form button').disabled=!c?.secure_setup_ready;if(!c?.secure_setup_ready)dialog.querySelector('.api-connection-status').textContent+=' Secure server setup is not available yet.';dialog.showModal();};controls.append(setup);panel.querySelector('.research-connection').after(controls);}
 });
 if(window.dotsDeskData)window.dispatchEvent(new CustomEvent('desk-data',{detail:window.dotsDeskData}));
})();
