const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'../comparador-auto-pro');
const app=fs.readFileSync(base+'/app-v2.js','utf8');
const valuation=fs.readFileSync(base+'/valuation.js','utf8');

test('correcting one repair changes the ceiling and saves the full per-vehicle history snapshot',async()=>{
  const {evaluatePurchase}=await import('data:text/javascript;base64,'+Buffer.from(valuation).toString('base64'));
  const elements=new Map(),listeners={};
  const inputs=[{value:'250',dataset:{conditionKey:'front_bumper'}}];
  const q=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',classList:{toggle(){}},addEventListener:(name,fn)=>{listeners[id+':'+name]=fn},querySelectorAll:()=>inputs});
    return elements.get(id);
  };
  const car={make:'Smart',model:'fortwo',trim:'electric drive',fuel:'electric',year:2017,mileage_km:45424,price:7800};
  const findings=['front_bumper','rear_bumper','bonnet','left_door','right_door','boot'].map(component=>({component,label:component,category:'paint',action:'paint',status:'confirmed',quantity:1,evidence:'Riscos no painel',cost:{}}));
  const market={subject:car,condition_report:{assessed:true,findings,checks:[],inspection:{last_date:'2026-01-19',mileage_km:38039},battery_soh_pct:null},comparables:[1,2,3].map(n=>({...car,url:'https://stand'+n+'.example/'+n,price:11000+n*100,seller_type:'professional',country:'PT',availability:'available',price_basis:'gross'})),auction_context:{is_auction:true,vehicle_location:'PT'}};
  const DEAL={costs:{reconditioning:450},reconditioning:{paint_mode:'trade',paint_min_eur:80,paint_max_eur:100},target_margin:3500,minimum_margin:1200};
  const result=evaluatePurchase({subject:car,comparables:market.comparables,condition_report:market.condition_report,costs:DEAL.costs,source_context:market.auction_context});
  let saved=null;
  const ctx={q,Number,Date,JSON,Math,Object,String,Intl,evaluatePurchase,DEAL,
    currentVehicle:car,currentAnalysisId:'analysis-one',activeOperation:null,currentResult:result,
    currentMarketData:{market,sourceHost:'auto1.com',marketPayload:{url:'https://auto1.com/app/merchant/test'}},
    fmt:v=>v===null?'—':String(v)+' €',esc:v=>String(v??'').replace(/</g,'&lt;'),historyDate:new Intl.DateTimeFormat('pt-PT',{dateStyle:'short'}),
    sourceContextFor:()=>market.auction_context,toast:()=>{},beginOperation:()=>({}),finishOperation:()=>{},
    renderResult:r=>{ctx.currentResult=r;ctx.renderConditionCosts(r)},
    persistCompletedAnalysis:async(id,r,m,reader,entry,payload,kind)=>{saved=ctx.makeSnapshot(r,m,reader,entry,payload,kind)}
  };
  vm.createContext(ctx);
  vm.runInContext(app.slice(app.indexOf('function conditionCostContext'),app.indexOf('function cleanValuationSummary')),ctx);
  vm.runInContext(app.slice(app.indexOf('function makeSnapshot'),app.indexOf('async function persistCompletedAnalysis')),ctx);
  ctx.renderConditionCosts(result);
  assert.match(q('conditionBudgetNote').textContent,/600/);
  assert.match(q('conditionLimitations').textContent,/SOH da bateria não documentado/);
  const before=result.purchase.effectiveCeiling;
  await listeners['conditionCostForm:submit']({preventDefault(){}});
  assert.equal(before-ctx.currentResult.purchase.effectiveCeiling,150);
  assert.equal(saved.calculation_kind,'condition_costs');
  assert.equal(saved.research.condition_overrides.front_bumper,250);
  assert.equal(saved.result.reconditioning.appliedGross,750);
  assert.equal(saved.research.condition_report.findings.length,6);
  assert.equal(saved.research.condition_report.inspection.mileage_km,38039);
  assert.equal(DEAL.costs.reconditioning,450); // Correction belongs to this vehicle only.
});
