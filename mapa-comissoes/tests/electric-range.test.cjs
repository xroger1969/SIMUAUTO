const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {normalizeRange,confirmedRange}=require("../comparador-auto-pro/electric-range.js");
const {finalizeMarketResponse,reuseMarketCache}=require("../api/comparador-market.js")._test;
const base=path.join(__dirname,"../comparador-auto-pro");
const sourceUrl="https://news.mgmotor.eu/press/mg-zs-ev-the-first-truly-affordable-electric-b-segment-suv/";
const vehicle={make:"MG",model:"ZS",trim:"Luxury",generation:null,year:2020,fuel:"electric",battery_kwh:44.5,power_cv:143,drivetrain:null,mileage_km:91706};
function candidate(){
  return {combined_km:263,cycle:"WLTP_COMBINED",version_match:"exact",vehicle:{...vehicle},
    source_url:sourceUrl,source_title:"MG ZS EV technical specifications",source_type:"manufacturer",
    source_variant:"Luxury · 44,5 kWh · 105 kW",evidence:"44.5 kWh battery; action radius WLTP: 263 km."};
}
const sources=[{url:sourceUrl,title:"MG ZS EV"}];
const confirmed=()=>normalizeRange(candidate(),vehicle,sources,"2026-10-24T14:00:00.000Z");

test("a sourced MG 105 kW reference records 263 km WLTP separately from an advertised range",()=>{
  const result=confirmed();
  assert.equal(result.combined_km,263);
  assert.equal(result.reference_battery_kwh,44.5);
  assert.equal(result.source_url_verified,true);
  assert.equal(confirmedRange({...vehicle,range_km:335,ev_range:result}).combined_km,263);
});
test("unknown battery can be resolved by the documented year, exact trim and power",()=>{
  const subject={...vehicle,battery_kwh:null};
  const result=normalizeRange(candidate(),subject,sources);
  assert.equal(result.combined_km,263);
  assert.equal(result.reference_battery_kwh,44.5);
  assert.equal(subject.battery_kwh,null,"Research does not silently overwrite the input identity");
});
test("model name alone, ambiguous versions and incompatible versions remain unconfirmed",()=>{
  for(const change of [{year:2023},{battery_kwh:72.6},{power_cv:177},{trim:"Long Range"},{fuel:"petrol"},{fuel:"phev"},{trim:null,battery_kwh:null,power_cv:null}]){
    assert.equal(normalizeRange(candidate(),{...vehicle,...change},sources),null,JSON.stringify(change));
  }
  assert.equal(normalizeRange({...candidate(),version_match:"ambiguous"},vehicle,sources),null);
});
test("urban WLTP, NEDC, EPA and unsourced values cannot become combined WLTP",()=>{
  for(const cycle of ["WLTP_CITY","NEDC","EPA","unknown"]){
    assert.equal(normalizeRange({...candidate(),cycle},vehicle,sources),null);
  }
  assert.equal(normalizeRange(candidate(),vehicle,[]),null);
  assert.equal(normalizeRange({...candidate(),source_type:"other"},vehicle,sources),null);
  assert.equal(normalizeRange({...candidate(),evidence:"Range not documented"},vehicle,sources),null);
  assert.equal(normalizeRange({...candidate(),combined_km:null},vehicle,sources),null);
});
test("unsafe source URLs are rejected even if listed as a consulted source",()=>{
  for(const source_url of ["javascript:alert(1)","data:text/html,test","https://name:password@example.com/spec"]){
    assert.equal(normalizeRange({...candidate(),source_url},vehicle,[{url:source_url}]),null);
  }
});
test("a confirmed range cannot survive changes to the vehicle configuration",()=>{
  const range=confirmed();
  for(const change of [{year:2021},{battery_kwh:50.3},{trim:"Comfort"},{model:"MG4"},{fuel:"diesel"}]){
    assert.equal(confirmedRange({...vehicle,...change,ev_range:range}),null);
  }
  assert.equal(confirmedRange({...vehicle,mileage_km:100000,ev_range:range}).combined_km,263);
});
test("the final server identity receives only fresh range research with consulted sources",async()=>{
  const data={id:"response-range",output_text:JSON.stringify({subject:{...vehicle,ev_range:{combined_km:999}},comparables:[],risk_flags:[],ev_range:candidate()}),
    output:[{type:"web_search_call",action:{sources}}]};
  const result=await finalizeMarketResponse(data);
  assert.equal(result.subject.ev_range.combined_km,263);
  assert.equal(result.ev_range,undefined);
  const noSource=await finalizeMarketResponse({...data,output:[]});
  assert.equal(noSource.subject.ev_range,null);
  const noResearch=await finalizeMarketResponse({...data,output_text:JSON.stringify({subject:{...vehicle,ev_range:confirmed()},comparables:[],risk_flags:[]})});
  assert.equal(noResearch.subject.ev_range,null,"A client-supplied verified flag is not proof");
});
test("market cache uses the stored source and rejects an incompatible inherited range",()=>{
  const stored={id:"cached",updated_at:new Date().toISOString(),result:{subject:{...vehicle,ev_range:confirmed()},comparables:[],risk_flags:[]}};
  const untrusted={...vehicle,ev_range:{...confirmed(),combined_km:999}};
  const reused=reuseMarketCache(stored,untrusted,null,"same-key");
  assert.equal(reused.subject.ev_range.combined_km,263);
  const changed=reuseMarketCache(stored,{...vehicle,battery_kwh:72.6},null,"different-key");
  assert.equal(changed.subject.ev_range,null);
});
test("the visible range panel clears stale values and links when changing vehicles",()=>{
  const {JSDOM}=require("./db-runtime/node_modules/jsdom");
  const html=fs.readFileSync(path.join(base,"index.html"),"utf8");
  const app=fs.readFileSync(path.join(base,"app-v2.js"),"utf8");
  const dom=new JSDOM(html,{url:"https://example.test/",runScripts:"outside-only"});
  try{
    const w=dom.window,q=id=>w.document.getElementById(id);
    w.eval(fs.readFileSync(path.join(base,"commercial-identity.js"),"utf8"));
    w.eval(fs.readFileSync(path.join(base,"electric-range.js"),"utf8"));
    w.q=q;
    w.eval(app.slice(app.indexOf("function renderElectricRange("),app.indexOf("const VALUATION_REQUIRED_FIELDS=")));
    w.renderElectricRange({...vehicle,ev_range:confirmed()});
    assert.equal(q("electricRangeValue").textContent,"263 km");
    assert.equal(q("electricRangePanel").classList.contains("hidden"),false);
    assert.equal(q("electricRangeSource").hidden,false);
    assert.equal(q("electricRangeSource").href,sourceUrl.slice(0,-1));
    w.renderElectricRange({...vehicle,range_km:335});
    assert.equal(q("electricRangeValue").textContent,"Por confirmar");
    assert.equal(q("electricRangeSource").hidden,true);
    assert.equal(q("electricRangeSource").hasAttribute("href"),false);
    w.renderElectricRange({...vehicle,fuel:"diesel"});
    assert.equal(q("electricRangePanel").classList.contains("hidden"),true);
    assert.ok(html.indexOf('id="electricRangePanel"')<html.indexOf('id="vehicleReadout"'));
    assert.ok(html.indexOf('src="./electric-range.js?')<html.indexOf('type="module" src="./app-v2.js?'));
  }finally{dom.window.close();}
});
