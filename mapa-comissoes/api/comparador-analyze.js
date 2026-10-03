const {safeFetch}=require("../lib/safe-fetch");
const {authenticate,takeQuota,endpoint}=require("../lib/access");

function stripBlock(html,tag){
  return html.replace(new RegExp("<"+tag+"\\b[^>]*>[\\s\\S]*?<\\/"+tag+">","gi")," ");
}
function cleanText(html){
  let out=String(html||"");
  for(const tag of ["script","style","svg"])out=stripBlock(out,tag);
  return out.replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g," ").trim();
}
function escapeRegex(value){return String(value).replace(/[.*+?^$()|[\]{}\\]/g,"\\$&")}
function meta(html,name,attr="name"){
  const safe=escapeRegex(name),q="[\\\"']";
  const a=new RegExp("<meta[^>]*"+attr+"="+q+safe+q+"[^>]*content="+q+"([^\\\"']*)"+q+"[^>]*>","i");
  const b=new RegExp("<meta[^>]*content="+q+"([^\\\"']*)"+q+"[^>]*"+attr+"="+q+safe+q+"[^>]*>","i");
  return (html.match(a)||html.match(b)||[])[1]||"";
}
function getTitle(html){return ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"").replace(/\s+/g," ").trim()}
function jsonLd(html){
  const out=[],re=/<script[^>]+type=[\"']application\/ld\+json[\"'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while((match=re.exec(html))&&out.length<8){
    try{
      const value=JSON.parse(match[1].trim());
      if(Array.isArray(value))out.push(...value.slice(0,4));else out.push(value);
    }catch{}
  }
  return out.slice(0,8);
}
function looksLikeLogin(url,html,status){
  if([401,403].includes(status))return true;
  const u=String(url||"").toLowerCase();
  if(u.includes("/login")||u.includes("/signin"))return true;
  const text=cleanText(html.slice(0,180000)).toLowerCase();
  return /iniciar sessão|iniciar sessao|sign in|log in|login required|sessão necessária|sessao necessaria/.test(text)
    && /password|palavra-passe|email/.test(text);
}

module.exports=endpoint(async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  const {token}=await authenticate(req);
  await takeQuota(token,"reader");

  const raw=String(req.body?.url||"").trim();
  let target;
  try{target=new URL(raw)}catch{return res.status(400).json({error:"invalid_url",message:"Link inválido."})}
  if(!["http:","https:"].includes(target.protocol)||target.username||target.password)return res.status(400).json({error:"invalid_url",message:"Usa um link HTTP(S) sem credenciais."});

  const host=target.hostname.toLowerCase();
  if((host==="auto1.com"||host.endsWith(".auto1.com"))&&target.pathname.includes("/app/merchant/")){
    return res.status(200).json({ok:true,status:"needs_auth",source_domain:host,message:"Este anúncio AUTO1 exige uma sessão autenticada ou uma fotografia da ficha."});
  }

  let response;
  try{response=await safeFetch(target.toString(),{timeout:12000,maxBytes:1500000,maxRedirects:3})}
  catch(error){
    return res.status(200).json({ok:false,status:"failed",error:"reader_error",message:String(error?.message||error)});
  }

  const type=response.headers.get("content-type")||"";
  const html=await response.text();
  const finalUrl=response.url||target.toString();

  if(looksLikeLogin(finalUrl,html,response.status)){
    return res.status(200).json({ok:true,status:"needs_auth",source_domain:new URL(finalUrl).hostname,http_status:response.status,final_url:finalUrl,message:"A página exige uma sessão autenticada."});
  }
  if(!response.ok){
    return res.status(200).json({ok:false,status:"failed",source_domain:new URL(finalUrl).hostname,http_status:response.status,final_url:finalUrl,message:"A origem respondeu com HTTP "+response.status+"."});
  }
  if(!type.includes("html")&&!type.includes("json")){
    return res.status(200).json({ok:false,status:"failed",source_domain:new URL(finalUrl).hostname,http_status:response.status,final_url:finalUrl,message:"Conteúdo não suportado."});
  }

  const og={
    title:meta(html,"og:title","property"),
    description:meta(html,"og:description","property"),
    image:meta(html,"og:image","property"),
    type:meta(html,"og:type","property")
  };
  const fullText=cleanText(html);
  const textSampleLimit=30000;
  const originMatch=fullText.match(/\bOrigem\s*[:—-]?\s*(Importado|Nacional)\b/i);
  const originEvidence=originMatch?{
    value:/importado/i.test(originMatch[1])?"imported":"national",
    label:originMatch[0],
    section:"Estado e histórico",
    url:finalUrl
  }:null;

  return res.status(200).json({
    ok:true,status:"ok",source_domain:new URL(finalUrl).hostname,http_status:response.status,final_url:finalUrl,
    page:{
      title:getTitle(html)||og.title,
      description:meta(html,"description")||og.description,
      og,
      json_ld:jsonLd(html),
      text_sample:fullText.slice(0,textSampleLimit),
      text_length:fullText.length,
      text_truncated:fullText.length>textSampleLimit,
      origin_evidence:originEvidence
    }
  });
});
