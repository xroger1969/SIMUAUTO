// Model output is a proposal. Only the application can confirm a successful save.
const clip=(value,max)=>String(value??"").trim().slice(0,max);
const norm=value=>clip(value,3000).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ");
const RULE_TYPES=new Set(["liquidity","technical_risk","commercial_preference","margin_cost"]);
const {normalizeVehicleIdentity}=require("../comparador-auto-pro/commercial-identity");

function emptyMemory(){
  return {rule_type:"none",statement:"",confidence:0,
    scope:{make:null,model:null,fuel:null,trim:null,year_min:null,year_max:null,mileage_min:null,mileage_max:null},
    effect:{mode:"advisory",liquidity_bias:0,risk_reserve_eur:0,margin_delta_eur:0,note:""},source_quote:""};
}

function quotedSource(value,message){
  const quote=clip(value,1200);
  return quote.length>=3&&String(message).includes(quote)?quote:null;
}

const NUMBER_WORDS={zero:0,um:1,uma:1,dois:2,duas:2,tres:3,quatro:4,cinco:5,seis:6,sete:7,oito:8,nove:9,
  dez:10,onze:11,doze:12,treze:13,catorze:14,quatorze:14,quinze:15,dezasseis:16,dezesseis:16,
  dezassete:17,dezessete:17,dezoito:18,dezanove:19,dezenove:19,vinte:20,trinta:30,quarenta:40,
  cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90,cem:100,cento:100,duzentos:200,
  trezentos:300,quatrocentos:400,quinhentos:500,seiscentos:600,setecentos:700,oitocentos:800,novecentos:900};

function numericToken(token){
  if(Object.hasOwn(NUMBER_WORDS,token))return NUMBER_WORDS[token];
  if(!/^\d+(?:[.,]\d+)*$/.test(token))return null;
  const normalized=token.includes(",")?token.replace(/\./g,"").replace(",",".")
    :/^\d{1,3}(?:\.\d{3})+$/.test(token)?token.replace(/\./g,""):token;
  const value=Number(normalized);
  return Number.isFinite(value)?value:null;
}

// Numbers are validated against the user's actual turn, including spoken PT amounts.
function amountsInQuote(quote){
  const input=norm(quote).replace(/(\d)[\s\u00a0](?=\d{3}(?:\D|$))/g,"$1");
  const tokens=input.match(/\d+(?:[.,]\d+)*|[a-z]+|%/g)||[];
  const amounts=[];
  let total=0,current=0,seen=false;
  const flush=following=>{
    if(seen&&!/^(?:km|quilometros|quilometro|dias|dia|meses|mes|anos|ano|kwh|cv|%)$/.test(following||""))amounts.push(total+current);
    total=0;current=0;seen=false;
  };
  for(const token of tokens){
    const value=numericToken(token);
    if(value!==null){current+=value;seen=true;continue;}
    if((token==="mil"||token==="k")&&seen){total+=current*1000;current=0;continue;}
    if((token==="milhao"||token==="milhoes")&&seen){total=(total+current)*1000000;current=0;continue;}
    if(token==="e"&&seen)continue;
    flush(token);
  }
  flush();
  return amounts;
}

function validateFeedback(proposal,message){
  if(!proposal||!["retail_estimate","margin"].includes(proposal.kind))return null;
  const quote=quotedSource(proposal.source_quote,message),value=Number(proposal.value);
  if(!quote||!Number.isFinite(value)||value<=0||value>10000000||(proposal.kind==="margin"&&value>100000))return null;
  if(!amountsInQuote(quote).some(amount=>Math.abs(amount-value)<.005))return null;
  return {kind:proposal.kind,value,source_quote:quote};
}

function compatibleProposedTrim(proposed,current){
  if(!proposed||!current)return true;
  const tokens=norm(proposed).match(/[a-z0-9]+/g)||[];
  const knownTokens=new Set(norm(current).match(/[a-z0-9]+/g)||[]);
  // A shortened version label may omit details, but cannot introduce another variant.
  return tokens.length>0&&tokens.every(token=>knownTokens.has(token));
}

function sanitizeTeachingResult(parsed,context,message){
  const source=parsed&&typeof parsed==="object"?parsed:{};
  const vehicle=normalizeVehicleIdentity(context?.vehicle||{}),proposed=source.memory_rule||{};
  const proposedScope=normalizeVehicleIdentity(proposed.scope||{});
  let reply=clip(source.reply,2000)||"Podes explicar melhor o que queres corrigir nesta viatura?";
  let memory=emptyMemory(),shouldSave=false;
  const action=source.action==="refine"?"refine":"conversation";
  const quote=quotedSource(proposed.source_quote,message);
  const scopedToAnotherCar=["make","model","fuel","drivetrain"].some(key=>
    proposedScope[key]&&vehicle[key]&&norm(proposedScope[key])!==norm(vehicle[key]))||
    !compatibleProposedTrim(proposedScope.trim,vehicle.trim)||proposedScope.commercial_identity?.drivetrain_conflict===true;
  if(source.should_save_memory===true&&RULE_TYPES.has(proposed.rule_type)&&quote&&quote.length>=8&&
      clip(vehicle.make,80)&&clip(vehicle.model,120)&&!scopedToAnotherCar){
    const year=Number(vehicle.year),knownYear=Number.isInteger(year)&&year>=1950&&year<=2100;
    memory={rule_type:proposed.rule_type,statement:"Observação do comerciante: "+quote,
      confidence:Math.max(0,Math.min(.7,Number(proposed.confidence)||.5)),
      // Narrow observations to the current identity. The model cannot create global rules.
      scope:{make:clip(vehicle.make,80),model:clip(vehicle.model,120),fuel:clip(vehicle.fuel,60)||null,
        trim:clip(vehicle.trim,120)||null,year_min:knownYear?year:null,year_max:knownYear?year:null,
        mileage_min:null,mileage_max:null},
      effect:{mode:"advisory",liquidity_bias:0,risk_reserve_eur:0,margin_delta_eur:0,
        note:"Experiência comunicada pelo comerciante; validar em viaturas semelhantes.",source:"user_observation"},
      source_quote:quote};
    shouldSave=true;
  }
  const feedback=validateFeedback(source.feedback_proposal,message);
  // Never let a generated acknowledgement impersonate the database result.
  if(/\b(?:guardei|aprendi|memorizei|registei|guardad[ao]s?|memorizad[ao]s?)\b/iu.test(reply)){
    reply=feedback?"Entendi o valor que indicaste. Confirma-o para o usar como aprendizagem."
      :shouldSave?"Entendi a tua observação sobre esta viatura. Que preço de revenda consideras realista?"
        :"Entendi. Podemos continuar a analisar esta viatura.";
  }
  return {reply,action,should_save_memory:shouldSave,memory_rule:memory,feedback_proposal:feedback};
}

function boundedAdvisoryMemories(rules){
  if(!Array.isArray(rules))return [];
  return rules.slice(0,200).flatMap(rule=>{
    if(!rule||rule.active===false||typeof rule.statement!=="string"||!rule.statement.trim()||
        (rule.effect?.mode&&rule.effect.mode!=="advisory"))return [];
    const scope={};
    for(const key of ["make","model","fuel","trim"]){
      if(rule.scope?.[key]!=null){
        if(typeof rule.scope[key]!=="string")return [];
        scope[key]=clip(rule.scope[key],120)||null;
      }
    }
    for(const key of ["year_min","year_max","mileage_min","mileage_max"]){
      const value=rule.scope?.[key];
      if(value==null)continue;
      if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>2000000)return [];
      if(key.startsWith("year_")&&(!Number.isInteger(value)||value<1950||value>2100))return [];
      scope[key]=value;
    }
    if((scope.year_min!=null&&scope.year_max!=null&&scope.year_min>scope.year_max)||
        (scope.mileage_min!=null&&scope.mileage_max!=null&&scope.mileage_min>scope.mileage_max))return [];
    const expires=rule.valid_until==null?null:clip(rule.valid_until,40);
    if(expires!==null&&!Number.isFinite(Date.parse(expires)))return [];
    return [{rule_type:clip(rule.rule_type,60),statement:clip(rule.statement,420),scope,
      effect:{mode:"advisory",note:clip(rule.effect?.note,420)},
      confidence:Math.max(0,Math.min(1,Number(rule.confidence)||0)),valid_until:expires}];
  });
}

function relevantAdvisoryMemories(rules,vehicle,now=Date.now()){
  const subject=normalizeVehicleIdentity(vehicle||{});
  if(!norm(subject.make)||!norm(subject.model))return [];
  return boundedAdvisoryMemories(rules).filter(rule=>{
    if(rule.valid_until&&Date.parse(rule.valid_until)<=now)return false;
    const scope=normalizeVehicleIdentity(rule.scope);
    for(const key of ["make","model","trim","fuel"]){
      if(scope[key]&&norm(scope[key])!==norm(subject[key]))return false;
    }
    for(const [field,min,max] of [["year","year_min","year_max"],["mileage_km","mileage_min","mileage_max"]]){
      if(scope[min]!=null||scope[max]!=null){
        const value=subject[field];
        if(value==null||value===""||!Number.isFinite(Number(value)))return false;
        if(scope[min]!=null&&Number(value)<scope[min])return false;
        if(scope[max]!=null&&Number(value)>scope[max])return false;
      }
    }
    return true;
  }).slice(0,12);
}

module.exports={emptyMemory,amountsInQuote,validateFeedback,sanitizeTeachingResult,boundedAdvisoryMemories,relevantAdvisoryMemories};
