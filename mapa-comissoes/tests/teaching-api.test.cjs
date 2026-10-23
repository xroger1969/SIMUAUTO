const test=require("node:test");
const assert=require("node:assert/strict");
const {amountsInQuote,validateFeedback,sanitizeTeachingResult}=require("../lib/teaching");
const ai=require("../api/comparador-ai");
const transcribe=require("../api/comparador-transcribe");

const vehicle={make:"Volvo",model:"V90",trim:"D4",fuel:"diesel",year:2019,mileage_km:148000};
const message="Este modelo vende-se muito mal e está sobrevalorizado.";
const proposal=(extra={})=>({reply:"Entendo a tua experiência. Qual o preço de revenda realista?",action:"conversation",
  should_save_memory:true,memory_rule:{rule_type:"liquidity",statement:"Todos os Volvo têm uma desvalorização de 20%.",
    confidence:1,source_quote:message,scope:{},effect:{mode:"advisory",liquidity_bias:-2,risk_reserve_eur:5000,margin_delta_eur:3000}},
  feedback_proposal:null,...extra});

test("a sales difficulty observation stays scoped and cannot invent a monetary adjustment",()=>{
  const result=sanitizeTeachingResult(proposal(),{vehicle},message);
  assert.equal(result.should_save_memory,true);
  assert.equal(result.action,"conversation");
  assert.equal(result.memory_rule.statement,"Observação do comerciante: "+message);
  assert.deepEqual(result.memory_rule.scope,{make:"Volvo",model:"V90",fuel:"diesel",trim:"D4",year_min:2019,year_max:2019,mileage_min:null,mileage_max:null});
  assert.equal(result.memory_rule.confidence,.7);
  assert.equal(result.memory_rule.effect.risk_reserve_eur,0);
  assert.equal(result.memory_rule.effect.margin_delta_eur,0);
  assert.equal(result.memory_rule.effect.liquidity_bias,0);
  assert.equal(result.memory_rule.effect.source,"user_observation");
  assert.equal(result.feedback_proposal,null);
});

test("an observation about another car, without identity, or invented by the model is not saved",()=>{
  const other=proposal();other.memory_rule.scope={make:"Toyota",model:"Corolla"};
  assert.equal(sanitizeTeachingResult(other,{vehicle},message).should_save_memory,false);
  assert.equal(sanitizeTeachingResult(proposal(),{vehicle:{}},message).should_save_memory,false);
  const invented=proposal();invented.memory_rule.source_quote="Demora 120 dias a vender.";
  assert.equal(sanitizeTeachingResult(invented,{vehicle},message).should_save_memory,false);
  const acknowledgement=proposal();acknowledgement.memory_rule.source_quote="Sim";
  assert.equal(sanitizeTeachingResult(acknowledgement,{vehicle},"Sim").should_save_memory,false);
});

test("equivalent commercial identity shapes do not discard the user's teaching",()=>{
  const result=proposal();result.memory_rule.scope={make:"Tesla",model:"Model Y",trim:"Long Range AWD",fuel:"electric"};
  const saved=sanitizeTeachingResult(result,{vehicle:{make:"Tesla",model:"MODEL Y LONG RANGE AWD",fuel:"elétrico",year:2021}},message);
  assert.equal(saved.should_save_memory,true);
  assert.equal(saved.memory_rule.scope.model,"Model Y");
  assert.equal(saved.memory_rule.scope.trim,"long range awd");
});

test("a shortened compatible trim is accepted while the full confirmed trim remains stored",()=>{
  const car={make:"Tesla",model:"Model Y",trim:"Long Range AWD",fuel:"electric",year:2021};
  for(const trim of ["Long Range","Long Range AWD"]){
    const result=proposal();result.memory_rule.scope={make:"Tesla",model:"Model Y",trim,fuel:"elétrico"};
    const saved=sanitizeTeachingResult(result,{vehicle:car},message);
    assert.equal(saved.should_save_memory,true,trim);
    assert.equal(saved.memory_rule.scope.trim,"long range awd");
    assert.equal(saved.memory_rule.scope.fuel,"electric");
  }
  for(const scope of [
    {trim:"Long Range RWD"},{trim:"RWD"},{trim:"Performance"},{trim:"Performance AWD"},
    {trim:"Long Range",fuel:"petrol"},{trim:"Long Range RWD",drivetrain:"AWD"}
  ]){
    const result=proposal();result.memory_rule.scope={make:"Tesla",model:"Model Y",fuel:"electric",...scope};
    assert.equal(sanitizeTeachingResult(result,{vehicle:car},message).should_save_memory,false,JSON.stringify(scope));
  }
});

test("trim matching uses whole tokens and preserves fuel aliases",()=>{
  const correct=proposal();correct.memory_rule.scope={make:"Volvo",model:"V90",trim:"D4",fuel:"gasóleo"};
  assert.equal(sanitizeTeachingResult(correct,{vehicle},message).should_save_memory,true);
  for(const trim of ["D5","D","4"]){
    const wrong=proposal();wrong.memory_rule.scope={make:"Volvo",model:"V90",trim,fuel:"diesel"};
    assert.equal(sanitizeTeachingResult(wrong,{vehicle},message).should_save_memory,false,trim);
  }
});

test("explicit numeric feedback supports PT-PT dictation but not model-invented amounts",()=>{
  for(const [quote,value] of [["A revenda realista é 19.000 €.",19000],["Para mim vale 19 500 euros.",19500],
    ["Dezanove mil euros.",19000],["Dezoito mil e quinhentos.",18500],["Uma margem de 4 mil e 500 euros.",4500],
    ["A margem é 3.500,50 €.",3500.5]]){
    assert.deepEqual(validateFeedback({kind:"retail_estimate",value,source_quote:quote},quote),{kind:"retail_estimate",value,source_quote:quote},quote);
  }
  assert.equal(validateFeedback({kind:"retail_estimate",value:19000,source_quote:message},message),null);
  assert.equal(validateFeedback({kind:"retail_estimate",value:19000,source_quote:"19 mil"},"Sim"),null);
  assert.equal(validateFeedback({kind:"purchase",value:19000,source_quote:"19 mil"},"19 mil"),null);
  assert.equal(validateFeedback({kind:"margin",value:190000,source_quote:"190 mil"},"190 mil"),null);
  assert.deepEqual(amountsInQuote("19000 km e 30 dias"),[]);
});

test("questions and factual corrections do not fabricate a memory and saved claims are removed",()=>{
  const correction=proposal({action:"refine",should_save_memory:false,reply:"Vou usar a versão que indicaste."});
  const result=sanitizeTeachingResult(correction,{vehicle},"É a versão Long Range.");
  assert.equal(result.action,"refine");
  assert.equal(result.should_save_memory,false);
  assert.equal(result.memory_rule.rule_type,"none");
  for(const reply of ["Guardei a tua observação.","Aprendi, obrigado!","Orientação guardada para o futuro."]){
    assert.doesNotMatch(sanitizeTeachingResult(proposal({reply}),{vehicle},message).reply,/guardei|aprendi|guardad/i);
  }
});

async function invoke(handler,body,{authorization="Bearer test-session",memberRole="admin",allowed=true,modelOutput=proposal(),providerText="Este Volvo vende-se mal."}={}){
  const oldFetch=global.fetch,oldKey=process.env.OPENAI_API_KEY,calls=[];
  let status=200,payload;
  process.env.OPENAI_API_KEY="unit-test-placeholder";
  global.fetch=async(url,options={})=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith("/auth/v1/user"))return {ok:true,json:async()=>({id:"test-owner"})};
    if(String(url).endsWith("/rpc/get_current_member"))return {ok:true,json:async()=>({active:true,role:memberRole})};
    if(String(url).endsWith("/rpc/cap_take_quota"))return {ok:true,json:async()=>allowed};
    if(String(url).endsWith("/responses"))return {ok:true,json:async()=>({status:"completed",model:"test-model",output_text:JSON.stringify(modelOutput)})};
    if(String(url).endsWith("/audio/transcriptions"))return {ok:true,json:async()=>({text:providerText})};
    throw new Error("Unexpected outbound request: "+url);
  };
  const res={setHeader(){},status(value){status=value;return this;},json(value){payload=value;return this;}};
  try{await handler({method:"POST",headers:{authorization},body},res);return {status,payload,calls};}
  finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
}

test("conversation endpoint preserves authentication/quota and validates the provider's output",async()=>{
  const result=await invoke(ai,{message,context:{vehicle,conversation:[{role:"assistant",content:"Como é a procura?"}]}});
  assert.equal(result.status,200);
  assert.equal(result.payload.memory_rule.effect.margin_delta_eur,0);
  const call=result.calls.find(item=>item.url.endsWith("/responses"));
  const request=JSON.parse(call.options.body);
  assert.equal(request.store,false);
  assert.match(request.input,/Como é a procura/);
  assert.ok(request.text.format.schema.required.includes("feedback_proposal"));
  assert.equal(result.calls.some(item=>/cap_memory_rules/.test(item.url)),false,"Only the application saves a confirmed learning result");
  for(const options of [{authorization:""},{memberRole:"seller"},{allowed:false}]){
    const refused=await invoke(ai,{message,context:{vehicle}},options);
    assert.ok([401,403,429].includes(refused.status));
    assert.equal(refused.calls.some(item=>item.url.startsWith("https://api.openai.com")),false);
  }
});

test("voice request uses actual format metadata and the current transcription language parameter",async()=>{
  const result=await invoke(transcribe,{audio_data_url:"data:audio/mp4;codecs=mp4a.40.2;base64,YWJj"});
  assert.equal(result.status,200);
  assert.equal(result.payload.text,"Este Volvo vende-se mal.");
  const form=result.calls.find(item=>item.url.endsWith("/audio/transcriptions")).options.body;
  assert.equal(form.get("model"),"gpt-transcribe");
  assert.equal(form.get("languages[]"),"pt");
  assert.equal(form.has("language"),false);
  assert.equal(form.get("file").name,"voz.m4a");
  assert.equal(form.get("file").type,"audio/mp4");
});

test("invalid/oversized recordings never reach the transcription provider",async()=>{
  const {parseAudioDataUrl,MAX_AUDIO_BYTES}=transcribe._test;
  for(const value of ["data:audio/webm;base64,====","data:audio/webm;base64,YW=J","data:text/plain;base64,YWJj","data:audio/webm;base64,"]){
    assert.equal(parseAudioDataUrl(value),null);
    const result=await invoke(transcribe,{audio_data_url:value});
    assert.equal(result.status,400);
    assert.equal(result.calls.some(item=>item.url.startsWith("https://api.openai.com")),false);
  }
  const result=await invoke(transcribe,{audio_data_url:"data:audio/webm;base64,"+"A".repeat(Math.ceil(MAX_AUDIO_BYTES/3)*4+201)});
  assert.equal(result.status,413);
  assert.equal(result.calls.some(item=>item.url.startsWith("https://api.openai.com")),false);
});
