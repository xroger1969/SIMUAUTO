const test=require("node:test");
const assert=require("node:assert/strict");
const {boundedAdvisoryMemories,relevantAdvisoryMemories}=require("../lib/teaching");
const {boundedContext,startResponse}=require("../api/comparador-market")._test;

const subject={make:"Volvo",model:"V90",fuel:"diesel",trim:"D4",year:2019,mileage_km:148000};
const now=Date.parse("2026-10-23T12:00:00Z");
const rule=(statement,scope={make:"Volvo",model:"V90",fuel:"diesel",trim:"D4",year_min:2019,year_max:2019})=>
  ({rule_type:"liquidity",statement,scope,effect:{mode:"advisory"},confidence:.6});

test("a relevant older observation survives 199 newer unrelated memories",()=>{
  const rows=Array.from({length:199},(_,i)=>rule("Tesla observation "+i,{make:"Tesla",model:"Model Y",fuel:"electric"}));
  rows.push(rule("Volvo sells slowly in my experience"));
  const context=boundedContext({dealer_memories:rows},null);
  assert.equal(context.memory_candidates.length,200);
  assert.deepEqual(context.dealer_memories,[]);
  const selected=relevantAdvisoryMemories(context.memory_candidates,subject,now);
  assert.deepEqual(selected.map(item=>item.statement),["Volvo sells slowly in my experience"]);
});

test("selection excludes another fuel, version, year, expired rules and numeric calibration records",()=>{
  const matching=rule("matching");
  const rows=[matching,
    rule("petrol",{...matching.scope,fuel:"petrol"}),
    rule("D5",{...matching.scope,trim:"D5"}),
    rule("2021",{...matching.scope,year_min:2021,year_max:2021}),
    rule("high mileage",{...matching.scope,mileage_min:180000}),
    {...rule("expired"),valid_until:"2026-10-22T00:00:00Z"},
    {...rule("disabled"),active:false},
    {...rule("supervised"),effect:{mode:"supervised",kind:"retail_estimate",value:19000}}
  ];
  assert.deepEqual(relevantAdvisoryMemories(rows,subject,now).map(item=>item.statement),["matching"]);
  assert.deepEqual(relevantAdvisoryMemories(rows,{},now),[]);
  assert.deepEqual(relevantAdvisoryMemories(rows,{...subject,fuel:null},now),[]);
  assert.deepEqual(relevantAdvisoryMemories(rows,{...subject,year:null},now),[]);
});

test("matching normalizes commercial identity without widening the model or version",()=>{
  const rows=[rule("Tesla long range",{make:"Tesla",model:"MODEL Y LONG RANGE AWD",fuel:"elétrico",year_min:2021,year_max:2021})];
  assert.equal(relevantAdvisoryMemories(rows,{make:"Tesla",model:"Model Y",trim:"Long Range AWD",fuel:"electric",year:2021},now).length,1);
  assert.equal(relevantAdvisoryMemories(rows,{make:"Tesla",model:"Model Y",trim:"Performance AWD",fuel:"electric",year:2021},now).length,0);
  const vw=[rule("Golf",{make:"VW",model:"Golf",fuel:"gasóleo"})];
  assert.equal(relevantAdvisoryMemories(vw,{make:"Volkswagen",model:"Golf",fuel:"diesel"},now).length,1);
});

test("candidate inputs are bounded and only 12 matching observations are exposed",()=>{
  const rows=Array.from({length:250},()=>rule("x".repeat(1000)));
  rows[0].scope.unrelated_payload="y".repeat(10000);
  rows[0].effect.note="z".repeat(1000);
  const bounded=boundedAdvisoryMemories(rows);
  assert.equal(bounded.length,200);
  assert.equal(bounded[0].statement.length,420);
  assert.equal(bounded[0].effect.note.length,420);
  assert.equal(Object.hasOwn(bounded[0].scope,"unrelated_payload"),false);
  assert.equal(relevantAdvisoryMemories(bounded,subject,now).length,12);
  assert.deepEqual(boundedAdvisoryMemories([rule("bad year",{year_min:0}),rule("bad range",{year_min:2022,year_max:2020})]),[]);
});

async function providerContext(context,identify,images=[]){
  const previousFetch=global.fetch;
  let request;
  global.fetch=async(url,options)=>{
    assert.equal(url,"https://api.openai.com/v1/responses");
    request=JSON.parse(options.body);
    return {ok:true,json:async()=>({id:"test-response",status:"queued"})};
  };
  try{
    await startResponse(context,images,{},identify);
    const text=Array.isArray(request.input)?request.input[0].content[0].text:request.input;
    return {request,context:JSON.parse(text.split("ANÚNCIO A ANALISAR:\n")[1].split("\n\n")[0])};
  }finally{global.fetch=previousFetch;}
}

test("identification receives no learning and the pool stays available for the later market stage",async()=>{
  const context={...boundedContext({dealer_memories:[rule("private pool marker")],previous_subject:subject},null),initial_started_at:new Date(now).toISOString()};
  const first=await providerContext(context,true,["data:image/jpeg;base64,YWJj"]);
  assert.deepEqual(first.context.dealer_memories,[]);
  assert.equal(Object.hasOwn(first.context,"memory_candidates"),false);
  assert.doesNotMatch(JSON.stringify(first.request),/private pool marker/);
  assert.equal(context.memory_candidates.length,1,"Provider filtering must not mutate the job context");
  const next=await providerContext({...context,stage:"market",previous_subject:subject},false);
  assert.deepEqual(next.context.dealer_memories.map(item=>item.statement),["private pool marker"]);
  assert.equal(Object.hasOwn(next.context,"memory_candidates"),false);
});

test("every market start filters legacy and recovered contexts before serializing to OpenAI",async()=>{
  const rows=[rule("Volvo relevant"),rule("unrelated Tesla marker",{make:"Tesla",model:"Model Y",fuel:"electric"})];
  for(const pool of [{dealer_memories:rows},{memory_candidates:rows,dealer_memories:[]}]){
    const context={...pool,previous_subject:subject,initial_started_at:new Date(now).toISOString(),transition_id:"stable-id",pending_started_at:"first",transition_retries:0};
    const first=await providerContext(context,false);
    const retried=await providerContext({...context,pending_started_at:"later",transition_retries:1},false);
    assert.deepEqual(first.context.dealer_memories.map(item=>item.statement),["Volvo relevant"]);
    assert.doesNotMatch(JSON.stringify(first.request),/unrelated Tesla marker|memory_candidates/);
    assert.deepEqual(first.request,retried.request,"Retry selection must preserve the provider's idempotent payload");
  }
});
