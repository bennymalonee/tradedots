(() => {
  const labels={momentum:'Momentum',mean_reversion:'Mean reversion',neutral:'Neutral baseline'};
  const percent=v=>(v*100).toFixed(1)+'%';
  function node(tag,text,className){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}
  window.addEventListener('desk-data',event=>{
    const lab=event.detail.learning;if(!lab)return;
    let panel=document.querySelector('#learning-lab');
    if(!panel){
      panel=document.createElement('section');panel.id='learning-lab';panel.className='panel learning-lab';
      const header=node('div','','panel-head');header.append(node('h2','ADAPTIVE RESEARCH LAB'));
      const run=node('button','RUN RESEARCH CYCLE');run.onclick=()=>window.dispatchEvent(new Event('desk-refresh'));header.append(run);
      panel.append(header,node('p','Research runs with each monitoring cycle. Methods learn from future observed quotes; broker orders remain manual.','market-note'),node('div','','learning-metrics'),node('div','','learning-methods'),node('div','','learning-results'),node('p','','learning-note market-note'));
      document.querySelector('.markets-panel').after(panel);
    }
    const metrics=panel.querySelector('.learning-metrics');metrics.replaceChildren();
    for(const [title,value] of [['STATE',lab.status.replaceAll('_',' ').toUpperCase()],['EVALUATED OUTCOMES',String(lab.evaluated)],['WAITING FOR OUTCOMES',String(lab.pending.length)],['NEXT EVALUATION',lab.pending.length?new Date(Math.min(...lab.pending.map(p=>p.due_at))).toLocaleTimeString():'Collecting fresh samples']]){
      const box=node('div','','metric');box.append(node('small',title),node('strong',value));metrics.append(box);
    }
    const methods=panel.querySelector('.learning-methods');methods.replaceChildren();
    for(const method of lab.methods){const card=node('div','','learning-method');card.append(node('b',labels[method.name]),node('strong',percent(method.weight)+' weight'));const bar=document.createElement('progress');bar.max=1;bar.value=method.weight;bar.setAttribute('aria-label',labels[method.name]+' research weight');card.append(bar,node('small',method.evaluated+' evaluations · Brier score '+(method.brier===null?'awaiting outcomes':method.brier.toFixed(4))+' · lower is better'));methods.append(card);}
    const results=panel.querySelector('.learning-results');results.replaceChildren(node('h3','RECENT FORECAST FEEDBACK'));
    if(!lab.outcomes.length)results.append(node('p','No outcome has been evaluated yet. Six distinct fresh quotes spanning at least four minutes are needed to issue a forecast; its outcome is checked about one hour later.'));
    for(const o of lab.outcomes.slice(0,6)){const row=node('div','','record');row.append(node('b',o.symbol+' · observed '+o.actual.toUpperCase()+' · '+o.return_pct.toFixed(3)+'%'),node('small','Forecast UP '+percent(o.forecast_up)+' · scored '+new Date(o.scored_at).toLocaleString()+' · Brier '+o.brier.toFixed(4)));results.append(row);}
    const last=lab.last_run?new Date(lab.last_run).toLocaleString():'No cycle yet';
    panel.querySelector('.learning-note').textContent='Last research cycle: '+last+'. '+Math.min(lab.evaluated,lab.min_outcomes)+'/'+lab.min_outcomes+' outcomes before weights adapt. '+lab.expired+' expired forecasts excluded; '+lab.unchanged+' unchanged prices excluded. '+lab.limitations+' This is adaptive programmed research, not a self-training ChatGPT model. Closed-tab monitoring uses the existing hourly schedule.';
  });
})();
