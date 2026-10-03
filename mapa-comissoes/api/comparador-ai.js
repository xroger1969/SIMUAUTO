const {structuredResult}=require("../lib/structured-result");
const {authenticate,takeQuota,endpoint,appError}=require("../lib/access");

const clip=(v,n)=>String(v??"").slice(0,n);
const pickVehicle=v=>{
  const out={};
  for(const key of ["make","model","generation","trim","fuel","battery_kwh","power_cv","drivetrain","transmission","year","first_registration","mileage_km","vat_deductible","price","origin"]){
    if(v?.[key]!==undefined)out[key]=v[key];
  }
  return out;
};
function boundedContext(input){
  const memories=Array.isArray(input?.dealer_memories)?input.dealer_memories:[];
  const conversation=Array.isArray(input?.conversation)?input.conversation:[];
  const valuation=input?.valuation||{};
  return {
    vehicle:pickVehicle(input?.vehicle||{}),
    valuation:{
      market:valuation.market?{
        marketValue:valuation.market.marketValue,
        saleLikely:valuation.market.saleLikely,
        saleFast:valuation.market.saleFast,
        confidencePct:valuation.market.confidencePct,
        comparablesUsed:valuation.market.comparablesUsed,
        verifiedProfessionals:valuation.market.verifiedProfessionals,
        marketBasis:valuation.market.marketBasis
      }:null,
      purchase:valuation.purchase?{
        currentPrice:valuation.purchase.currentPrice,
        maxPurchase:valuation.purchase.maxPurchase,
        absoluteMax:valuation.purchase.absoluteMax,
        expectedMargin:valuation.purchase.expectedMargin,
        marginAtCeiling:valuation.purchase.marginAtCeiling,
        decision:valuation.purchase.decision,
        eligible:valuation.purchase.eligible
      }:null,
      tax:valuation.tax||null,
      warnings:(Array.isArray(valuation.warnings)?valuation.warnings:[]).slice(0,12).map(x=>clip(x,300))
    },
    dealer_memories:memories.slice(0,12).map(rule=>({
      rule_type:clip(rule?.rule_type,60),
      statement:clip(rule?.statement,420),
      scope:rule?.scope||{},
      effect:rule?.effect||{},
      confidence:Number(rule?.confidence)||0
    })),
    conversation:conversation.slice(-8).map(item=>({role:item?.role==="user"?"user":"assistant",content:clip(item?.content,900)}))
  };
}

module.exports=endpoint(async function handler(req,res){
  if(req.method==="GET"){
    return res.status(200).json({ok:true,configured:Boolean(process.env.OPENAI_API_KEY),model:process.env.OPENAI_MODEL||"gpt-6-sol",api:"responses"});
  }
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  if(!process.env.OPENAI_API_KEY)throw appError("OpenAI não configurada.",503,"openai_not_configured");

  const {token}=await authenticate(req);
  await takeQuota(token,"chat");

  const message=String(req.body?.message||"").trim();
  if(!message)return res.status(400).json({error:"empty_message"});
  if(message.length>3000)return res.status(400).json({error:"message_too_long",message:"Mensagem demasiado longa."});
  const context=boundedContext(req.body?.context||{});

  const schema={
    type:"object",additionalProperties:false,required:["reply","should_save_memory","memory_rule"],
    properties:{
      reply:{type:"string"},
      should_save_memory:{type:"boolean"},
      memory_rule:{
        type:"object",additionalProperties:false,required:["rule_type","statement","confidence","scope","effect"],
        properties:{
          rule_type:{type:"string",enum:["liquidity","technical_risk","commercial_preference","margin_cost","none"]},
          statement:{type:"string"},confidence:{type:"number",minimum:0,maximum:1},
          scope:{type:"object",additionalProperties:false,required:["make","model","trim","year_min","year_max","mileage_min","mileage_max"],properties:{
            make:{type:["string","null"]},model:{type:["string","null"]},trim:{type:["string","null"]},
            year_min:{type:["integer","null"]},year_max:{type:["integer","null"]},mileage_min:{type:["integer","null"]},mileage_max:{type:["integer","null"]}
          }},
          effect:{type:"object",additionalProperties:false,required:["mode","liquidity_bias","risk_reserve_eur","margin_delta_eur","note"],properties:{
            mode:{type:"string",enum:["advisory"]},liquidity_bias:{type:"integer",minimum:-2,maximum:2},
            risk_reserve_eur:{type:"number",minimum:0,maximum:10000},margin_delta_eur:{type:"number",minimum:-10000,maximum:10000},note:{type:"string"}
          }}
        }
      }
    }
  };

  const instructions=[
    "És o Comprador IA do Comparador Auto Pro para comerciantes profissionais de automóveis usados em Portugal.",
    "Responde em português de Portugal, curto, objetivo e comercial.",
    "Não concordes automaticamente e nunca inventes preços, procura, avarias, equipamento ou comparáveis.",
    "Distingue factos observados, hipóteses do comerciante e inferências.",
    "Uma observação guardada é uma hipótese reutilizável: nunca altera cegamente o preço. Deve ser testada em pesquisas futuras.",
    "Se a análise não estiver elegível para teto de compra, diz claramente o que falta confirmar.",
    "Se for apenas uma pergunta sobre a compra atual, não cries memória.",
    "Nunca afirmes que uma regra foi guardada; a aplicação confirma isso apenas após escrita bem-sucedida."
  ].join("\n");

  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",signal:AbortSignal.timeout(45000),
    headers:{"content-type":"application/json",authorization:"Bearer "+process.env.OPENAI_API_KEY},
    body:JSON.stringify({
      model:process.env.OPENAI_MODEL||"gpt-6-sol",store:false,instructions,
      input:"CONTEXTO:\n"+JSON.stringify(context)+"\n\nMENSAGEM DO COMERCIANTE:\n"+message,
      text:{format:{type:"json_schema",name:"comparador_auto_pro_reply",strict:true,schema},verbosity:"low"},
      max_output_tokens:3000
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw appError(data?.error?.message||"Falha ao contactar a OpenAI.",502,"openai_error");
  const parsed=structuredResult(data);
  if(!parsed.should_save_memory){
    parsed.memory_rule={
      rule_type:"none",statement:"",confidence:0,
      scope:{make:null,model:null,trim:null,year_min:null,year_max:null,mileage_min:null,mileage_max:null},
      effect:{mode:"advisory",liquidity_bias:0,risk_reserve_eur:0,margin_delta_eur:0,note:""}
    };
  }
  return res.status(200).json({ok:true,model:data.model||process.env.OPENAI_MODEL||"gpt-6-sol",usage:data.usage||null,...parsed});
});
