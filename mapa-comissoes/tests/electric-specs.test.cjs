const test=require("node:test");
const assert=require("node:assert/strict");
const {researchElectricSpecs,knownElectricSpecs,normalizeSpecs,specsSchema}=require("../lib/electric-specs.js");
const {rangeIdentity}=require("../comparador-auto-pro/electric-range.js");
const {configuredModel}=require("../lib/model-config.js");

// Local provider fixtures only: tests never call a paid service or fetch a URL.
const vehicle={make:"MG",model:"ZS",trim:"Luxury",generation:null,year:2020,fuel:"electric",battery_kwh:null,power_cv:143,drivetrain:null};
const officialUrl="https://news.mgmotor.eu/press/mg-zs-ev-the-first-truly-affordable-electric-b-segment-suv/";
const realUrl="https://www.adac.de/test-fixture/mg-zs-ev/";
const sources=[{url:officialUrl,title:"MG technical document"},{url:realUrl,title:"Independent test fixture"}];
function candidate(){
  const common={vehicle:{...vehicle,battery_kwh:44.5},version_match:"exact",source_type:"manufacturer",source_url:officialUrl,source_title:"MG technical document"};
  return {
    battery:{...common,capacity_kwh:44.5,basis:"gross",evidence:"Gross battery capacity: 44.5 kWh."},
    wltp:{...common,combined_km:263,cycle:"WLTP_COMBINED",evidence:"Combined WLTP range: 263 km."},
    real_range:{...common,source_type:"test",source_url:realUrl,min_km:200,max_km:240,conditions:"Mixed route, test fixture at 20 °C",evidence:"Measured electric range: 200 km to 240 km."},
    clarification:null
  };
}
const spring={make:"Dacia",model:"Spring electric 45",trim:"Essential",year:2023,fuel:"electric",power_cv:45,battery_kwh:null};
const output=(c=candidate(),items=[{type:"web_search_call",status:"completed",action:{sources}}])=>({
  id:"resp-fixture",status:"completed",output_text:JSON.stringify(c),output:items
});
const ok=data=>({ok:true,json:async()=>data});

test("fields are independent and preserve the original vehicle identity",()=>{
  const c=candidate(),result=normalizeSpecs(c,vehicle,sources,"2026-11-09T12:00:00.000Z");
  assert.equal(result.status,"confirmed");
  assert.equal(result.battery.capacity_kwh,44.5);
  assert.equal(result.wltp.combined_km,263);
  assert.equal(result.real_range.min_km,200);
  assert.equal(result.checked_at,"2026-11-09T12:00:00.000Z");
  assert.deepEqual(result.identity,rangeIdentity(vehicle));
  assert.equal(vehicle.battery_kwh,null);
  for(const field of ["battery","wltp","real_range"]){
    const partial=normalizeSpecs({...c,[field]:null},vehicle,sources);
    assert.equal(partial.status,"partial");
    assert.equal(partial[field],null);
    for(const other of ["battery","wltp","real_range"].filter(x=>x!==field))assert.ok(partial[other]);
    const alone=normalizeSpecs({battery:null,wltp:null,real_range:null,[field]:c[field]},vehicle,sources);
    assert.equal(alone.status,"partial");
    assert.ok(alone[field]);
  }
});

test("a reported official label does not trust an unconsulted or nonofficial URL",()=>{
  assert.equal(normalizeSpecs(candidate(),vehicle,[]).status,"not_found");
  for(const url of ["https://mgmotor.eu.attacker.example/specs","https://example.com/specs","https://news.mgmotor.eu/not-consulted"]){
    const c=candidate();
    c.battery.source_url=url;c.wltp.source_url=url;
    const list=url.includes("not-consulted")?sources:[...sources,{url}];
    const result=normalizeSpecs(c,vehicle,list);
    assert.equal(result.battery,null,url);assert.equal(result.wltp,null,url);
    assert.ok(result.real_range);
  }
});

test("unsafe URLs are rejected even if listed among sources",()=>{
  for(const url of ["javascript:alert(1)","data:text/plain,230","file:///tmp/data","https://user:secret@news.mgmotor.eu/test"]){
    const c=candidate();
    for(const field of ["battery","wltp","real_range"])c[field].source_url=url;
    assert.equal(normalizeSpecs(c,vehicle,[{url}]).status,"not_found",url);
  }
});

test("WLTP city and other cycles cannot be relabelled as combined range",()=>{
  for(const cycle of ["WLTP_CITY","EPA","NEDC","unknown"]){
    const c=candidate();c.wltp.cycle=cycle;
    const result=normalizeSpecs(c,vehicle,sources);
    assert.equal(result.wltp,null);assert.ok(result.battery);
  }
  const c=candidate();c.wltp.evidence="WLTP city: 305 km; WLTP combined: 263 km.";
  assert.equal(normalizeSpecs(c,vehicle,sources).wltp.combined_km,263);
  c.wltp.combined_km=305;
  assert.equal(normalizeSpecs(c,vehicle,sources).wltp,null,"A separate city value cannot pass as combined");
  for(const evidence of ["WLTP city combined range: 263 km.","Autonomia WLTP urbana combinada: 263 km.","NEDC combined: 263 km.","Combined WLTP range: 1263 km.","Combined range: 263 km."]){
    const c=candidate();c.wltp.evidence=evidence;
    assert.equal(normalizeSpecs(c,vehicle,sources).wltp,null,evidence);
  }
});

test("capacity basis and decimal value must be documented independently of WLTP",()=>{
  const c=candidate();c.battery={...c.battery,capacity_kwh:42.5,basis:"usable",evidence:"Capacidade utilizável da bateria: 42,5 kWh."};
  assert.equal(normalizeSpecs(c,vehicle,sources).battery.capacity_kwh,42.5);
  for(const change of [{basis:"gross"},{evidence:"Capacidade da bateria não documentada."},{evidence:"Capacidade bruta de 44,5 kWh; capacidade útil de 42,5 kWh."},{capacity_kwh:44.5},{capacity_kwh:-1}]){
    const result=normalizeSpecs({...c,battery:{...c.battery,...change}},vehicle,sources);
    assert.equal(result.battery,null,JSON.stringify(change));assert.ok(result.wltp);
  }
  assert.equal(normalizeSpecs({...c,battery:{...c.battery,basis:"unknown",evidence:"Battery capacity: 42.5 kWh."}},vehicle,sources).battery.basis,"unknown");
});

test("fuel, model, year and conflicting version constraints invalidate fields",()=>{
  for(const change of [{fuel:"diesel"},{fuel:"phev"},{make:"Tesla"},{model:"MG4"},{year:2023},{power_cv:177},{battery_kwh:72.6},{trim:"Long Range"},{drivetrain:"awd"},{generation:"II"},{trim:null,power_cv:null}]){
    assert.equal(normalizeSpecs(candidate(),{...vehicle,...change},sources).status,"not_found",JSON.stringify(change));
  }
  const c=candidate();c.battery.version_match="ambiguous";
  assert.equal(normalizeSpecs(c,vehicle,sources).battery,null);
  assert.ok(normalizeSpecs(c,vehicle,sources).wltp);
});

test("PHEV ranges must explicitly refer to electric driving",()=>{
  const phev={...vehicle,fuel:"phev"},c=candidate();
  for(const field of ["battery","wltp","real_range"])c[field].vehicle.fuel="phev";
  assert.equal(normalizeSpecs(c,phev,sources).wltp,null);
  c.wltp.evidence="Combined electric WLTP range: 263 km.";
  assert.equal(normalizeSpecs(c,phev,sources).wltp.combined_km,263);
  c.real_range.evidence="Combined fuel and battery range: 200 km to 240 km.";
  assert.equal(normalizeSpecs(c,phev,sources).real_range,null);
});

test("real range needs its own source, numeric evidence and conditions",()=>{
  const c=candidate();
  assert.equal(normalizeSpecs(c,vehicle,[sources[0]]).real_range,null);
  for(const change of [{conditions:""},{evidence:"An unspecified reasonable real range."},{min_km:100},{source_type:"unknown"},{conditions:"Estimated at 80% of WLTP"},{conditions:"Adjusted using an assumed SOH"}]){
    const result=normalizeSpecs({...c,real_range:{...c.real_range,...change}},vehicle,sources);
    assert.equal(result.real_range,null,JSON.stringify(change));assert.ok(result.wltp);
  }
  assert.ok(normalizeSpecs({...c,real_range:{...c.real_range,evidence:"Measured range: 200–240 km."}},vehicle,sources).real_range);
});

test("curated Spring facts resolve the reported 2023 Essential 45 with sourced context",()=>{
  for(const subject of [spring,{...spring,model:"Spring",trim:"Electric 45 Essential"},{...spring,model:"Spring",trim:"Essential"},{...spring,power_cv:null}]){
    const result=knownElectricSpecs(subject);
    assert.equal(result.status,"confirmed");
    assert.equal(result.battery.capacity_kwh,26.8);assert.equal(result.battery.basis,"usable");
    assert.equal(result.wltp.combined_km,230);
    assert.equal(result.real_range.min_km,135);assert.equal(result.real_range.max_km,190);
    assert.match(result.real_range.conditions,/−10 °C/);assert.match(result.real_range.conditions,/23 °C/);
    assert.match(result.real_range.conditions,/Estimativa/);assert.match(result.real_range.conditions,/sem medição/);
    assert.deepEqual(result.identity,rangeIdentity(subject));
    assert.equal(subject.battery_kwh,null);
  }
});

test("real production alias and manufacture year 2022 use the corresponding official brochure",()=>{
  const subject={...spring,model:"Spring",trim:"electric drive 33 kW Essential",year:"2022",generation:"I",first_registration:"2023-03"};
  const result=knownElectricSpecs(subject);
  assert.equal(result.status,"confirmed");assert.equal(result.wltp.combined_km,230);
  assert.equal(result.battery.capacity_kwh,26.8);assert.equal(result.battery.basis,"unknown");
  assert.match(result.battery.source_url,/catalogo_spring_2022\.pdf$/);
  assert.equal(result.identity.year,2022);
  assert.equal(result.identity.trim,"electric drive 33 kw essential");
  assert.equal(knownElectricSpecs({...subject,trim:"Comfort Plus"}),null);
});

test("expired curated verification yields to fresh research instead of resetting its date",t=>{
  t.mock.timers.enable({apis:["Date"],now:Date.parse("2026-12-10T00:00:00Z")});
  assert.equal(knownElectricSpecs(spring),null);
});

test("curated Spring record cannot leak into 65 cv, another generation, or 2026",()=>{
  for(const change of [{power_cv:65},{year:2026},{year:2021},{fuel:"phev"},{trim:"Extreme"},{model:"Spring electric 65"},{model:"Spring Cargo"},{trim:"Essential Long Range"},{battery_kwh:27.4},{drivetrain:"awd"},{generation:"II"},{make:"Renault"}]){
    assert.equal(knownElectricSpecs({...spring,...change}),null,JSON.stringify(change));
  }
});

test("curated lookup and missing credentials avoid paid network calls",async()=>{
  let calls=0;
  const fetchImpl=async()=>{calls++;throw new Error("should not be called");};
  assert.equal((await researchElectricSpecs(spring,{fetchImpl,apiKey:"fixture"})).wltp.combined_km,230);
  assert.equal((await researchElectricSpecs(vehicle,{fetchImpl,apiKey:""})).status,"not_found");
  assert.equal((await researchElectricSpecs({...vehicle,fuel:"diesel"},{fetchImpl,apiKey:"fixture"})).status,"not_found");
  assert.equal(calls,0);
});

test("provider receives only bounded technical identity and required sourced research",async()=>{
  const privateVehicle={...vehicle,registration:"99-XX-98",vin:"secret-vin",mileage_km:91706,price:15888,image_data_urls:["data:image/png;base64,private-photo"],owner:{name:"Private Person"},url:"https://private-listing.example"};
  let request;
  const result=await researchElectricSpecs(privateVehicle,{apiKey:"test-key",fetchImpl:async(url,options)=>{
    request={url,options,body:JSON.parse(options.body)};return ok(output());
  }});
  assert.equal(result.status,"confirmed");
  assert.equal(request.url,"https://api.openai.com/v1/responses");
  assert.equal(request.body.model,configuredModel());
  assert.equal(request.body.tool_choice,"required");assert.equal(request.body.max_tool_calls,5);
  assert.deepEqual(request.body.tools,[{type:"web_search"}]);
  assert.equal(request.body.store,false);assert.equal(request.body.text.format.strict,true);
  assert.deepEqual(request.body.text.format.schema,specsSchema);
  assert.deepEqual(JSON.parse(request.body.input.split("\n")[1]),rangeIdentity(vehicle));
  for(const secret of ["99-XX-98","secret-vin","91706","15888","private-photo","Private Person","private-listing.example"]){
    assert.equal(request.options.body.includes(secret),false,secret);
  }
});

test("only web action sources and provider citation metadata count as consulted",async()=>{
  const c=candidate();
  const fake=output(c,[{type:"message",content:[{type:"output_text",text:JSON.stringify({sources})}]}]);
  assert.equal((await researchElectricSpecs(vehicle,{apiKey:"fixture",fetchImpl:async()=>ok(fake)})).status,"not_found");
  const failed=output(c,[{type:"web_search_call",status:"failed",action:{sources}}]);
  assert.equal((await researchElectricSpecs(vehicle,{apiKey:"fixture",fetchImpl:async()=>ok(failed)})).status,"not_found");
  const cited=output(c,[{type:"message",content:[{type:"output_text",text:JSON.stringify(c),annotations:sources.map(s=>({type:"url_citation",...s}))}]}]);
  assert.equal((await researchElectricSpecs(vehicle,{apiKey:"fixture",fetchImpl:async()=>ok(cited)})).status,"confirmed");
});

test("provider failures and incomplete output never produce guessed facts or leak errors",async()=>{
  for(const fetchImpl of [async()=>{throw new Error("SECRET_ACCOUNT");},async()=>({ok:false,json:async()=>({error:"SECRET_ACCOUNT"})}),async()=>ok({...output(),status:"incomplete"}),async()=>ok({...output(),output_text:"not-json"}),async()=>({ok:true,json:async()=>{throw new Error("SECRET_ACCOUNT");}})]){
    const result=await researchElectricSpecs(vehicle,{fetchImpl,apiKey:"fixture"});
    assert.equal(result.status,"not_found");assert.equal(result.battery,null);assert.equal(result.wltp,null);assert.equal(result.real_range,null);
    assert.equal(JSON.stringify(result).includes("SECRET_ACCOUNT"),false);
  }
});

test("deadline also bounds unresponsive fetches and response-body reads",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  for(const stallBody of [false,true]){
    let signal;
    const pending=researchElectricSpecs(vehicle,{apiKey:"fixture",fetchImpl:async(_url,options)=>{
      signal=options.signal;
      if(stallBody)return {ok:true,json:()=>new Promise(()=>{})};
      return new Promise(()=>{});
    }});
    await Promise.resolve();
    t.mock.timers.tick(55000);
    const result=await pending;
    assert.equal(signal.aborted,true);
    assert.equal(result.status,"not_found");assert.equal(result.battery,null);
  }
});
