(() => {
 const money=v=>v===null||v===undefined?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(v);
 const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
 let latest=null;
 async function action(path,body){
  const status=document.querySelector('#sim-action-status');status.textContent='Running isolated simulation task…';
  try{const result=await window.withAgentActivity(['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA'],async()=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(v.error||'Simulation request failed');return v});status.textContent=path.endsWith('/test')?'Synthetic functional checks '+result.status.toUpperCase()+'. This is not a profitability test.':'Simulation '+body.action+' saved.';window.dispatchEvent(new Event('desk-refresh'));}
  catch(error){status.textContent=error.message;}
 }
 window.addEventListener('desk-data',event=>{
  const sim=event.detail.simulation;if(!sim)return;latest=sim;
  let panel=document.querySelector('#simulation-panel');
  if(!panel){panel=el('section','','panel simulation-panel');panel.id='simulation-panel';
   const header=el('div','','panel-head');header.append(el('h2','AUTONOMOUS SIX-AGENT SIMULATION'));panel.append(header,el('p','Isolated virtual accounts · no broker connection · forward market observations','market-note'));
   const controls=el('div','','sim-controls');for(const [label,path,body]of [['START SIMULATION','/api/simulation/control',{action:'start'}],['PAUSE ENTRIES','/api/simulation/control',{action:'pause'}],['TEST SIX AGENTS','/api/simulation/test',{}]]){const b=el('button',label);b.onclick=()=>action(path,body);controls.append(b)}const link=el('a','EXPORT EVIDENCE');link.href='/api/export';link.download='dots-paper-ledger.json';controls.append(link);panel.append(controls);
   const status=el('p','','market-note');status.id='sim-action-status';status.setAttribute('role','status');panel.append(status,el('div','','sim-comparison'),el('div','','sim-checks'),el('div','','sim-fills'),el('p','','sim-note market-note'));
   (document.querySelector('#learning-lab')||document.querySelector('.markets-panel')).after(panel);
  }
  panel.querySelector('.panel-head h2').textContent='AUTONOMOUS SIMULATION · '+sim.status.replaceAll('_',' ').toUpperCase();
  const comparison=panel.querySelector('.sim-comparison');comparison.replaceChildren();
  for(const [label,account]of [['ADAPTIVE AGENTS',sim.adaptive],['FIXED MOMENTUM BASELINE',sim.baseline]]){const card=el('article','','sim-account');card.append(el('h3',label));if(!account){card.append(el('p','Waiting for the first simulation cycle.'));comparison.append(card);continue;}for(const [name,value]of [['Equity',money(account.equity)],['P&L after modeled costs',money(account.pnl)],['Closed trades',String(account.closed_trades)],['Win rate',account.win_rate===null?'—':account.win_rate.toFixed(1)+'%'],['Modeled fees',money(account.fees)],['Maximum drawdown',account.max_drawdown_pct.toFixed(2)+'%'],['Open positions',String(account.positions.length)]]){const row=el('div','','sim-metric');row.append(el('span',name),el('b',value));card.append(row)}if(account.halted)card.append(el('p','RISK HALT: '+account.halt_reason));comparison.append(card);}
  const checks=panel.querySelector('.sim-checks');checks.replaceChildren(el('h3','LAST SIX-AGENT DECISIONS'));
  for(const name of ['ATLAS','ORION','TITAN','NOVA','VEGA','LUNA']){const check=[...(sim.checks||[])].reverse().find(c=>c.agent===name);const row=el('div','','record');row.append(el('b',name+' · '+(check?(check.pass?'PASS':'WAIT / VETO'):'WAITING')),el('small',check?(check.symbol+' · '+check.reason):'Awaiting a fresh eligible stock quote.'));checks.append(row);}
  const fills=panel.querySelector('.sim-fills');fills.replaceChildren(el('h3','ADAPTIVE SIMULATED FILLS'));
  for(const fill of (sim.adaptive?.ledger||[]).slice(0,6)){const row=el('div','','record');row.append(el('b',fill.side.toUpperCase()+' · '+fill.symbol+' · '+money(fill.price)),el('small',new Date(fill.at).toLocaleString()+' · modeled fee '+money(fill.fee)+(fill.realized_pnl!==undefined?' · realized P&L '+money(fill.realized_pnl):'')+' · '+fill.rule));fills.append(row);}
  if(!sim.adaptive?.ledger.length)fills.append(el('p','No fills yet. Waiting is a valid decision when evidence or risk checks fail.'));
  let note=(sim.strategy||'Collecting source quotes')+'. Adaptive minus baseline P&L: '+money(sim.improvement)+'. '+(sim.evidence||'No performance evidence yet')+'. '+(sim.limits||'Separate virtual cash only.');
  if(sim.last_test)note+=' Synthetic functional test: '+sim.last_test.status.toUpperCase()+' · '+Object.values(sim.last_test.checks).filter(Boolean).length+'/'+Object.keys(sim.last_test.checks).length+' checks. '+sim.last_test.note;
  panel.querySelector('.sim-note').textContent=note;
 });
})();
