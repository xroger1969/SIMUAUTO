const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('./db-runtime/node_modules/jsdom');

const base=path.join(__dirname,'../comparador-auto-pro');
const app=fs.readFileSync(path.join(base,'app-v2.js'),'utf8');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const car={make:'Dacia',model:'Spring',trim:'Essential',year:2023,fuel:'electric',power_cv:45,battery_kwh:null};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function harness(){
  const dom=new JSDOM(html,{url:'https://example.test/comparador-auto-pro/',runScripts:'outside-only'});
  const w=dom.window,q=id=>w.document.getElementById(id);
  w.eval(fs.readFileSync(path.join(base,'commercial-identity.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(base,'electric-range.js'),'utf8'));
  const result={subject:{...car},market:{saleLikely:12200,marketValue:12500},purchase:{effectiveCeiling:8947},comparables:[{price:12500}]};
  const requests=[],saves=[];
  Object.assign(w,{
    q,session:{user:{id:'owner-one'},access_token:'session'},currentAnalysisId:'analysis-one',currentVehicle:result.subject,
    currentResult:result,currentHistoryRevision:null,currentMarketData:{market:{job_id:'job-one',subject:{...car}},reader:{},entry:{},marketPayload:{}},
    activeOperation:null,operationSequence:1,electricSpecsRequest:null,electricSpecsStatus:'',electricSpecsAttempts:new Set(),historyControlStates:[],
    setOperationBusy(){},setAnalysisButtonState(){},
    fetchJson:async(url,options,timeout)=>{const pending=deferred();requests.push({url,options,timeout,pending});return pending.promise;},
    persistCompletedAnalysis:async(analysisId,value,market,reader,entry,payload,kind)=>{saves.push({analysisId,kind,result:JSON.parse(JSON.stringify(value)),market:JSON.parse(JSON.stringify(market))});return true;}
  });
  w.eval(app.slice(app.indexOf('function renderElectricRange('),app.indexOf('const VALUATION_REQUIRED_FIELDS=')));
  w.eval(app.slice(app.indexOf('function finishOperation('),app.indexOf('function mergeDeal(')));
  const specs=(overrides={})=>({research_version:1,identity:w.ElectricRange.rangeIdentity(car),checked_at:new Date().toISOString(),status:'partial',
    battery:{capacity_kwh:26.8,basis:'usable',source_url:'https://dacia.test/2023/specification',source_title:'Dacia 2023',evidence:'Capacidade utilizável: 26,8 kWh.'},
    wltp:null,real_range:null,clarification:null,...overrides});
  const respond=(index,value=specs(),ok=true)=>requests[index].pending.resolve({response:{ok,status:ok?200:503},data:ok?{ok:true,ev_specs:value}:{ok:false}});
  return {w,q,result,requests,saves,specs,respond,close:()=>dom.window.close()};
}

test('a sourced battery is visible without WLTP and every technical field has its own safe source',()=>{
  const h=harness();try{
    h.w.renderElectricRange({...car,ev_specs:h.specs()});
    assert.match(h.q('electricBatteryValue').textContent,/26,8 kWh úteis/);
    assert.equal(h.q('electricRangeValue').textContent,'Por confirmar');
    assert.equal(h.q('electricBatterySource').hidden,false);
    assert.equal(h.q('electricRangeSource').hidden,true);
    const complete=h.specs({status:'confirmed',wltp:{combined_km:230,source_url:'https://dacia.test/2023/wltp',source_title:'Homologação',evidence:'WLTP combinado: 230 km.'},
      real_range:{min_km:135,max_km:190,conditions:'Uso misto, frio a clima ameno',source_url:'https://testing.test/spring-45',source_title:'Ensaio',evidence:'135 km a 190 km.'}});
    h.w.renderElectricRange({...car,ev_specs:complete});
    assert.equal(h.q('electricRangeValue').textContent,'230 km');
    assert.equal(h.q('electricRangeSource').href,'https://dacia.test/2023/wltp');
    assert.equal(h.q('electricBatterySource').href,'https://dacia.test/2023/specification');
    assert.equal(h.q('electricRealRangeSource').href,'https://testing.test/spring-45');
    assert.match(h.q('electricRealRangeValue').textContent,/135–190 km/);
    h.w.renderElectricRange({...car,year:2024,ev_specs:complete});
    for(const id of ['electricRangeSource','electricBatterySource','electricRealRangeSource']){
      assert.equal(h.q(id).hidden,true);assert.equal(h.q(id).hasAttribute('href'),false);
    }
  }finally{h.close();}
});

test('finishing an assessment starts one optional lookup and saves only technical enrichment, preserving prices',async()=>{
  const h=harness();try{
    const money=JSON.stringify({market:h.result.market,purchase:h.result.purchase,comparables:h.result.comparables});
    const op={isAssessment:true,resultReady:true};h.w.activeOperation=op;
    h.w.finishOperation(op);
    assert.equal(h.w.activeOperation,null,'The valuation controls are released before technical research');
    assert.equal(h.requests.length,1);assert.equal(h.requests[0].timeout,115000);
    assert.equal(h.q('electricSpecsResearchBtn').disabled,true);
    assert.equal(h.q('electricSpecsStatus').textContent,'A pesquisar dados técnicos…');
    const body=JSON.parse(h.requests[0].options.body);
    assert.equal(body.job_id,'job-one');assert.equal(body.vehicle.year,2023);assert.equal(body.vehicle.registration,undefined);
    const pending=h.w.electricSpecsRequest;
    await h.w.researchElectricSpecs();assert.equal(h.requests.length,1,'Concurrent renders do not duplicate the call');
    h.respond(0);
    for(let i=0;i<20&&h.w.electricSpecsRequest===pending;i++)await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(h.saves.length,1);assert.equal(h.saves[0].kind,'electric_specs');
    assert.equal(h.saves[0].result.subject.ev_specs.battery.capacity_kwh,26.8);
    assert.equal(h.saves[0].market.subject.ev_specs.battery.capacity_kwh,26.8);
    assert.equal(JSON.stringify({market:h.result.market,purchase:h.result.purchase,comparables:h.result.comparables}),money);
    assert.equal(h.w.currentResult,h.result);
    await h.w.researchElectricSpecs();assert.equal(h.requests.length,1,'The same analysis is not researched again automatically');
    assert.equal(h.q('electricSpecsResearchBtn').disabled,false);
  }finally{h.close();}
});

test('a technical service failure keeps the valuation available and explicit retry bypasses the local attempt guard',async()=>{
  const h=harness();try{
    const initial=JSON.stringify(h.result);
    const first=h.w.researchElectricSpecs();h.respond(0,null,false);await first;
    assert.equal(JSON.stringify(h.result),initial);assert.equal(h.saves.length,0);
    assert.match(h.q('electricSpecsStatus').textContent,/tentar novamente/);
    const retry=h.w.researchElectricSpecs({force:true});
    assert.equal(h.requests.length,2);assert.equal(JSON.parse(h.requests[1].options.body).force,true);
    h.respond(1);await retry;assert.equal(h.saves.length,1);
  }finally{h.close();}
});

test('a response arriving after another vehicle or result is selected cannot overwrite either analysis',async()=>{
  for(const change of ['analysis','result','identity','operation','owner','history']){
    const h=harness();try{
      const pending=h.w.researchElectricSpecs();
      if(change==='analysis')h.w.currentAnalysisId='analysis-two';
      if(change==='result')h.w.currentResult={...h.result};
      if(change==='identity')h.w.currentVehicle={...car,year:2024};
      if(change==='operation')h.w.operationSequence++;
      if(change==='owner')h.w.session={user:{id:'owner-two'}};
      if(change==='history')h.w.currentHistoryRevision={id:'saved-one'};
      h.respond(0);await pending;
      assert.equal(h.saves.length,0,change);assert.equal(h.result.subject.ev_specs,undefined,change);
    }finally{h.close();}
  }
});

test('cancelling technical research aborts its request and a late network response is ignored',async()=>{
  const h=harness();try{
    const pending=h.w.researchElectricSpecs();
    const signal=h.requests[0].options.signal;
    h.w.cancelElectricSpecsResearch();
    assert.equal(signal.aborted,true);assert.equal(h.w.electricSpecsRequest,null);
    h.respond(0);await pending;
    assert.equal(h.saves.length,0);assert.equal(h.result.subject.ev_specs,undefined);
  }finally{h.close();}
});

test('historical revisions and incomplete identifications never launch or save technical research',async()=>{
  const h=harness();try{
    h.w.currentHistoryRevision={id:'historical-revision'};
    const op={kind:'history',isAssessment:false,resultReady:true};h.w.activeOperation=op;h.w.finishOperation(op);
    await h.w.researchElectricSpecs({force:true});
    assert.equal(h.requests.length,0);assert.equal(h.saves.length,0);assert.equal(h.q('electricSpecsResearchBtn').hidden,true);
    h.w.currentHistoryRevision=null;h.w.currentResult=null;
    await h.w.researchElectricSpecs({force:true});assert.equal(h.requests.length,0);
    h.w.currentResult=h.result;h.w.currentMarketData.market.valuation_blocked=true;
    await h.w.researchElectricSpecs({force:true});assert.equal(h.requests.length,0);
  }finally{h.close();}
});

test('a mismatched or malformed technical response cannot enter the current result or history',async()=>{
  const h=harness();try{
    const pending=h.w.researchElectricSpecs();h.respond(0,h.specs({identity:h.w.ElectricRange.rangeIdentity({...car,year:2025})}));await pending;
    assert.equal(h.result.subject.ev_specs,undefined);assert.equal(h.saves.length,0);
    assert.match(h.q('electricSpecsStatus').textContent,/tentar novamente/);
  }finally{h.close();}
});
