import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateReturnForecast,blendReturnForecasts,scoreReturnForecast} from '../worker/return-forecast.mjs';

const snapshot={model:'test-model',policy_version:'agent-skill-v2',prompt_version:'research-context-v2',primary_symbol:'TEST',weights:{ATLAS:.4,ORION:.3,TITAN:.2,NOVA:.1}};
const agent=(name='ATLAS',extra={})=>({name,stance:'bullish',forecast_symbol:'TEST',expected_return_pct:1,downside_return_pct:-2,...extra});

test('return estimates accept only bounded numeric values and a matching explicit symbol',()=>{
 assert.deepEqual(validateReturnForecast(agent(), 'TEST'),{valid:true,reason:'bounded',expected_return_pct:1,downside_return_pct:-2});
 for(const expected_return_pct of [NaN,Infinity,-25.0001,25.0001,'1'])assert.equal(validateReturnForecast(agent('ATLAS',{expected_return_pct}),'TEST').valid,false);
 for(const downside_return_pct of [NaN,Infinity,-25.0001,.0001,'-1'])assert.equal(validateReturnForecast(agent('ATLAS',{downside_return_pct}),'TEST').valid,false);
 for(const x of [-25,0,25])assert.equal(validateReturnForecast(agent('ATLAS',{expected_return_pct:x,downside_return_pct:0}),'TEST').valid,true);
 assert.equal(validateReturnForecast(agent('ATLAS',{forecast_symbol:'OTHER'}),'TEST').valid,false);
 assert.equal(validateReturnForecast(agent('ATLAS',{stance:'invented'}),'TEST').valid,false);
 const missing=validateReturnForecast(agent('ATLAS',{expected_return_pct:null,downside_return_pct:undefined}),'TEST');
 assert.equal(missing.valid,true);assert.equal(missing.reason,'missing');assert.equal(missing.expected_return_pct,null);
 const abstained=validateReturnForecast(agent('ATLAS',{stance:'abstain',expected_return_pct:100}),'TEST');
 assert.equal(abstained.reason,'abstained');assert.equal(abstained.expected_return_pct,null);
});
test('blending freezes supplied first-four weights and excludes abstentions, malformed, partial and wrong-symbol forecasts',()=>{
 const agents=[agent('ATLAS',{expected_return_pct:2,downside_return_pct:-1}),agent('ORION',{expected_return_pct:-1,downside_return_pct:-3}),agent('TITAN',{stance:'abstain'}),agent('NOVA',{forecast_symbol:'OTHER'}),agent('LUNA',{expected_return_pct:25})];
 const original=structuredClone(agents),frozen=structuredClone(snapshot),blend=blendReturnForecasts(agents,snapshot);
 assert.deepEqual(blend.weights,{ATLAS:.4/.7,ORION:.3/.7});
 assert.ok(Math.abs(blend.expected_return_pct-(2*.4-1*.3)/.7)<1e-12);
 assert.ok(Math.abs(blend.downside_return_pct-(-1*.4-3*.3)/.7)<1e-12);
 assert.equal(blend.policy_version,'net-return-v1');assert.deepEqual(agents,original);assert.deepEqual(snapshot,frozen);
 assert.equal(blendReturnForecasts([agent('ATLAS',{downside_return_pct:null})],snapshot).expected_return_pct,null);
 assert.equal(blendReturnForecasts([agent('ATLAS',{expected_return_pct:26})],snapshot).expected_return_pct,null);
 assert.equal(blendReturnForecasts([agent()],{...snapshot,weights:{ATLAS:Infinity}}).expected_return_pct,null);
 assert.equal(blendReturnForecasts([agent()],{...snapshot,weights:{ATLAS:.9,ORION:.05,TITAN:.04,NOVA:.01}}).expected_return_pct,null);
 assert.equal(blendReturnForecasts([agent()],{...snapshot,weights:{ATLAS:.25,ORION:.25,TITAN:.25,NOVA:.3}}).expected_return_pct,null);
 assert.equal(blendReturnForecasts([agent()],{...snapshot,policy_version:'agent-skill-v1'}).expected_return_pct,null);
 assert.equal(blendReturnForecasts([agent()],{...snapshot,primary_symbol:null}).expected_return_pct,null);
 const duplicate=blendReturnForecasts([agent('ATLAS',{expected_return_pct:1}),agent('ATLAS',{expected_return_pct:25})],snapshot);assert.equal(duplicate.expected_return_pct,1);
});
test('mid-return scoring preserves signed percentage-point error, including unchanged outcomes, without interpreting error as profit',()=>{
 assert.deepEqual(scoreReturnForecast(1,.5),{error_pct:.5,absolute_error_pct:.5,squared_error_pct2:.25});
 assert.deepEqual(scoreReturnForecast(-1,1),{error_pct:-2,absolute_error_pct:2,squared_error_pct2:4});
 assert.deepEqual(scoreReturnForecast(.25,0),{error_pct:.25,absolute_error_pct:.25,squared_error_pct2:.0625});
 assert.equal(scoreReturnForecast(null,.1),null);assert.equal(scoreReturnForecast(26,.1),null);assert.equal(scoreReturnForecast(1,Infinity),null);
 assert.equal(scoreReturnForecast(25,40).absolute_error_pct,15);
});
test('pure return helpers make no provider requests and mutate no input or broker state',t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('unexpected provider request');});
 const input=[agent()],before=structuredClone(input);validateReturnForecast(input[0],'TEST');blendReturnForecasts(input,snapshot);scoreReturnForecast(1,0);assert.deepEqual(input,before);
});
