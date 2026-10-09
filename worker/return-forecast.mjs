// Bounded forward return estimates. Pure validation, blending and error scoring.
const returnPolicy='net-return-v1';
const returnRoles=['ATLAS','ORION','TITAN','NOVA'];
const returnFinite=value=>typeof value==='number'&&Number.isFinite(value);
const returnBounded=(value,min,max)=>returnFinite(value)&&value>=min&&value<=max;

export function validateReturnForecast(agent,primarySymbol){
 if(!agent||!['bullish','bearish','neutral','abstain'].includes(agent.stance))return{valid:false,reason:'invalid_stance',expected_return_pct:null,downside_return_pct:null};
 if(agent.stance==='abstain')return{valid:true,reason:'abstained',expected_return_pct:null,downside_return_pct:null};
 const expected=agent.expected_return_pct??null,downside=agent.downside_return_pct??null;
 const hasForecast=agent.probability_up!=null||expected!==null||downside!==null;
 if(hasForecast&&(typeof primarySymbol!=='string'||agent.forecast_symbol!==primarySymbol))return{valid:false,reason:'symbol_mismatch',expected_return_pct:null,downside_return_pct:null};
 if(expected!==null&&!returnBounded(expected,-25,25))return{valid:false,reason:'invalid_expected_return',expected_return_pct:null,downside_return_pct:null};
 if(downside!==null&&!returnBounded(downside,-25,0))return{valid:false,reason:'invalid_downside_return',expected_return_pct:null,downside_return_pct:null};
 return{valid:true,reason:expected===null&&downside===null?'missing':'bounded',expected_return_pct:expected,downside_return_pct:downside};
}

export function blendReturnForecasts(agents,snapshot){
 const weights=snapshot?.weights;
 if(snapshot?.policy_version!=='agent-skill-v2'||snapshot?.prompt_version!=='research-context-v2'||
  typeof snapshot?.model!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(snapshot.model)||
  !weights||returnRoles.some(name=>!returnBounded(weights[name],Number.MIN_VALUE,.4))||
  Math.abs(returnRoles.reduce((sum,name)=>sum+weights[name],0)-1)>1e-10)
  return{policy_version:returnPolicy,expected_return_pct:null,downside_return_pct:null,weights:{},contributors:[],reason:'invalid_forecast_snapshot'};
 const rows=[],seen=new Set(),primary=snapshot?.primary_symbol;
 for(const agent of Array.isArray(agents)?agents:[]){
  if(!returnRoles.includes(agent?.name)||seen.has(agent.name))continue;
  seen.add(agent.name);
  const checked=validateReturnForecast(agent,primary),weight=snapshot?.weights?.[agent.name];
  if(!checked.valid||agent.stance==='abstain'||!returnFinite(weight)||weight<=0||weight>1)continue;
  // Expected return and downside use the same contributors; incomplete pairs cannot imply a safe edge.
  if(checked.expected_return_pct===null||checked.downside_return_pct===null)continue;
  rows.push({name:agent.name,expected_return_pct:checked.expected_return_pct,downside_return_pct:checked.downside_return_pct,weight});
 }
 const total=rows.reduce((sum,row)=>sum+row.weight,0),contributors=rows.map(row=>({...row,weight:row.weight/total}));
 return{policy_version:returnPolicy,expected_return_pct:total?contributors.reduce((sum,row)=>sum+row.expected_return_pct*row.weight,0):null,downside_return_pct:total?contributors.reduce((sum,row)=>sum+row.downside_return_pct*row.weight,0):null,weights:Object.fromEntries(contributors.map(row=>[row.name,row.weight])),contributors};
}

export function scoreReturnForecast(expectedPct,observedPct){
 if(!returnBounded(expectedPct,-25,25)||!returnFinite(observedPct))return null;
 const error_pct=expectedPct-observedPct;
 if(!returnFinite(error_pct)||!returnFinite(error_pct**2))return null;
 return{error_pct,absolute_error_pct:Math.abs(error_pct),squared_error_pct2:error_pct**2};
}
