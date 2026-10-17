const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {conditionSchema,normalizeConditionReport,mergeConditionReports}=require('../lib/condition-report');
const {reuseMarketCache}=require('../api/comparador-market')._test;
const source=fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/valuation.js'),'utf8');
const engine=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const emptyCost=()=>({parts_min_eur:null,parts_max_eur:null,labour_min_eur:null,labour_max_eur:null,price_basis:'unknown',source_url:null,source_title:null,fitment_note:''});
const finding=(component='left_front_door',extra={})=>({component,label:component,category:'paint',action:'paint',status:'confirmed',quantity:1,evidence:'Riscos fundos documentados neste painel',source_image:1,safety_critical:false,cost:emptyCost(),...extra});
const report=(findings,extra={})=>({assessed:true,summary:'Relatório da viatura analisada',findings,...extra});
const car={make:'Smart',model:'fortwo',trim:'electric drive 60 kW',fuel:'electric',year:2017,mileage_km:45424,transmission:'automatic',origin:'imported',price:7800};
const comparable=(n)=>({...car,url:'https://stand'+n+'.example/car/'+n,seller_type:'professional',seller_name:'Stand '+n,country:'PT',availability:'available',price_basis:'gross',price:11000+n*100,
  evidence:{verified:true,source_url_verified:true,observed_at:new Date().toISOString()}});
const input=(extra={})=>({subject:car,comparables:[comparable(1),comparable(2),comparable(3)],source_context:{is_auction:true,vehicle_location:'PT',origin_country:'DE'},current_purchase_price:7800,costs:{reconditioning:450},...extra});
const webCost=(extra={})=>({...emptyCost(),parts_min_eur:100,parts_max_eur:120,labour_min_eur:50,labour_max_eur:60,price_basis:'net',source_url:'https://oficina.example/tabela',source_title:'Tabela de preços oficina',source_verified:true,fitment_note:'Referência para a versão indicada; sujeita a inspeção',...extra});

test('six documented panels reduce the buying limit by only the excess over the preparation floor',async()=>{
  const {evaluatePurchase}=await engine;
  const before=evaluatePurchase(input());
  const after=evaluatePurchase(input({condition_report:report(['front_bumper','rear_bumper','bonnet','left_door','right_door','boot'].map(x=>finding(x)))}));
  assert.equal(after.reconditioning.estimatedMin,480);
  assert.equal(after.reconditioning.estimatedMax,600);
  assert.equal(after.reconditioning.appliedGross,600);
  assert.equal(before.purchase.effectiveCeiling-after.purchase.effectiveCeiling,150);
  assert.equal(before.purchase.expectedMargin-after.purchase.expectedMargin,150);
  assert.equal(after.purchase.importCost,0); // Current PT branch wins over historical DE origin.
});
test('scratches repeated in three photos on one panel are charged once',async()=>{
  const {estimateReconditioning}=await engine;
  const r=estimateReconditioning(report([finding(),finding('left_front_door',{source_image:2}),finding('left_front_door',{source_image:3})]));
  assert.equal(r.items.length,1);assert.equal(r.estimatedMin,80);assert.equal(r.estimatedMax,100);
});
test('body map warning areas cannot become four painted panels',async()=>{
  const {estimateReconditioning}=await engine;
  const r=estimateReconditioning(report(['front','rear','left','right'].map(x=>finding(x,{evidence:'Triângulo de aviso no mapa; N/A um',status:'confirmed'}))),{},car,450);
  assert.equal(r.estimatedMax,0);assert.equal(r.unpriced,4);assert.equal(r.appliedGross,450);
  assert.ok(r.items.every(x=>x.status==='unassessed'));
});
test('polishing and replacing are never assigned the flat paint rate',async()=>{
  const {estimateReconditioning}=await engine;
  for(const action of ['polish','replace','repair_and_paint']){
    const r=estimateReconditioning(report([finding('front_bumper',{action})]));
    assert.equal(r.estimatedMax,0);assert.equal(r.unpriced,1);
  }
});
test('a replacement subsumes painting the same component and remains incomplete without labour',async()=>{
  const {estimateReconditioning}=await engine;
  const r=estimateReconditioning(report([finding(),finding('left_front_door',{action:'replace',cost:webCost({labour_min_eur:null,labour_max_eur:null})})]));
  assert.equal(r.items.length,1);assert.equal(r.items[0].action,'replace');
  assert.equal(r.estimatedMax,147.6);assert.equal(r.items[0].partial,true);assert.equal(r.hasUnpriced,true);
});
test('web parts and labour are added per unit with explicit VAT conversion',async()=>{
  const {estimateReconditioning}=await engine;
  const r=estimateReconditioning(report([finding('front_tyres',{category:'tyres',action:'replace',quantity:2,cost:webCost()})]));
  assert.equal(r.estimatedMin,369);assert.equal(r.estimatedMax,442.8);assert.equal(r.hasUnpriced,false);
});
test('an invented URL or unknown VAT cannot turn into a quoted repair cost',async()=>{
  const {estimateReconditioning}=await engine;
  for(const cost of [webCost({source_verified:false}),webCost({price_basis:'unknown'})]){
    const r=estimateReconditioning(report([finding('mirror',{action:'replace',cost})]));
    assert.equal(r.estimatedMax,0);assert.equal(r.unpriced,1);
  }
});
test('manual total replaces the complete item including quantity, and allows explicit zero',async()=>{
  const {estimateReconditioning}=await engine;
  for(const value of [0,250]){
    const r=estimateReconditioning(report([finding('front_tyres',{category:'tyres',action:'replace',quantity:2,cost:webCost()})]),{overrides:{front_tyres:value}});
    assert.equal(r.appliedGross,value);assert.equal(r.items[0].basis,'manual');
  }
});
test('unknown zones and suspected faults cannot be certified by entering a repair price',async()=>{
  const {estimateReconditioning}=await engine;
  const r=estimateReconditioning(report([finding('motor',{status:'suspected',action:'replace'})]),{overrides:{motor:1000}});
  assert.equal(r.estimatedMax,0);assert.equal(r.unpriced,1);
});
test('net accounting converts a 123 EUR gross repair into 100 EUR economic cost exactly once',async()=>{
  const {evaluatePurchase}=await engine;
  const base=evaluatePurchase(input({tax:{mode:'deductible',vat_rate:.23},costs:{reconditioning:0}}));
  const r=evaluatePurchase(input({tax:{mode:'deductible',vat_rate:.23},costs:{reconditioning:0},condition_report:report([finding()]),reconditioning_settings:{overrides:{left_front_door:123}}}));
  assert.equal(r.reconditioning.appliedEconomic,100);
  assert.equal(base.purchase.effectiveCeiling-r.purchase.effectiveCeiling,123);
});
test('a concrete priced component is not charged again as a risk reserve',async()=>{
  const {evaluatePurchase}=await engine;
  const base=evaluatePurchase(input({condition_report:report([finding()])}));
  const r=evaluatePurchase(input({condition_report:report([finding()]),risk_flags:[{related_component:'left_front_door',reserve_eur:500}]}));
  assert.equal(r.purchase.fixedCosts,base.purchase.fixedCosts);assert.equal(r.purchase.riskReserve,base.purchase.riskReserve);
});
test('unpriced concrete faults keep an otherwise good market estimate provisional',async()=>{
  const {evaluatePurchase}=await engine;
  const before=evaluatePurchase(input());
  const r=evaluatePurchase(input({condition_report:report([finding('brakes',{category:'mechanical',action:'diagnose',status:'suspected',safety_critical:true})])}));
  assert.equal(before.purchase.eligible,true);assert.equal(r.purchase.eligible,false);
  assert.equal(r.purchase.provisionalEligible,true);assert.equal(r.reconditioning.hasCriticalUnpriced,true);
  assert.ok(r.warnings.some(x=>x.includes('diagnóstico antes da compra')));
});
test('electric vehicle excludes engine oil and timing belt maintenance',async()=>{
  const {estimateReconditioning}=await engine;
  const r=estimateReconditioning(report(['engine_oil','oil_filter','timing_belt'].map(x=>finding(x,{category:'maintenance',action:'service',cost:webCost()}))),{},car);
  assert.equal(r.items.length,0);assert.equal(r.estimatedMax,0);assert.ok(r.notes.length);
});
test('web painting is selected explicitly and a single source is not treated as a national average',async()=>{
  const {estimateReconditioning}=await engine;
  const item=finding('front_bumper',{cost:webCost({parts_min_eur:0,parts_max_eur:0,labour_min_eur:150,labour_max_eur:150})});
  const trade=estimateReconditioning(report([item]),{},car);
  const web=estimateReconditioning(report([item]),{paint_mode:'web'},car);
  assert.equal(trade.estimatedMax,100);assert.equal(web.estimatedMax,184.5);assert.equal(web.items[0].source,item.cost.source_url);
});
test('normalization verifies the price URL against actual web tool sources',()=>{
  const raw=report([finding('mirror',{cost:webCost()})]);
  assert.equal(normalizeConditionReport(raw,[]).findings[0].cost.source_verified,false);
  assert.equal(normalizeConditionReport(raw,[{url:'https://oficina.example/tabela'}]).findings[0].cost.source_verified,true);
  assert.equal(normalizeConditionReport(report([finding('mirror',{cost:webCost({source_url:'javascript:alert(1)'})})])).findings[0].cost.source_url,null);
});
test('cost research enriches observed damage without inventing extra defects or SOH',()=>{
  const observed=report([finding()],{battery_soh_pct:null,inspection:{last_date:'2026-01-19',mileage_km:38039,due_date:'2026-11-09'}});
  const researched=report([finding('left_front_door',{status:'ok',cost:webCost()}),finding('battery',{category:'electrical',action:'replace'})],{battery_soh_pct:99});
  const r=mergeConditionReports(observed,researched);
  assert.equal(r.findings.length,1);assert.equal(r.findings[0].status,'confirmed');
  assert.equal(r.findings[0].cost.source_url,'https://oficina.example/tabela');assert.equal(r.battery_soh_pct,null);
  assert.equal(r.inspection.mileage_km,38039);
});
test('cached market comparables never transfer another input condition or location',()=>{
  const cached={id:'old-job',result:{subject:car,comparables:[comparable(1)],condition_report:report([finding()]),risk_flags:[{reserve_eur:900}],auction_context:{vehicle_location:'foreign'}}};
  const r=reuseMarketCache(cached,car,null,'key');
  assert.equal(r.comparables.length,1);assert.equal(r.condition_report.findings.length,0);
  assert.equal(r.risk_flags.length,0);assert.equal(r.auction_context,null);
});
test('the extraction schema records inspection history and test limitations separately from costs',()=>{
  const p=conditionSchema.properties;
  assert.ok(p.inspection.properties.mileage_km);assert.ok(p.battery_soh_pct);
  assert.ok(p.checks.items.properties.result.enum.includes('no_findings_reported'));
});
