const SUPABASE_URL = "https://ciyycnjxteqpphgbkneg.supabase.co";
const SUPABASE_KEY = "sb_publishable_NLLNaEvhKHfoJNenqpObdA_sNA8UTNa";

function bearer(req){
  const h=String(req.headers.authorization||"");
  return h.startsWith("Bearer ")?h.slice(7).trim():"";
}
async function validUser(token){
  const response=await fetch(SUPABASE_URL+"/auth/v1/user",{
    signal:AbortSignal.timeout(10000),
    headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+token}
  });
  if(!response.ok)return false;
  const membership=await fetch(SUPABASE_URL+"/rest/v1/rpc/get_current_member",{
    method:"POST",
    signal:AbortSignal.timeout(10000),
    headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+token,"content-type":"application/json","content-profile":"mapa_comercial"},
    body:"{}"
  });
  if(!membership.ok)return false;
  const member=await membership.json();
  return member?.active===true&&member?.role==="admin";
}
function extensionFor(mime){
  if(/mp4|m4a/i.test(mime))return "m4a";
  if(/wav/i.test(mime))return "wav";
  if(/ogg/i.test(mime))return "ogg";
  if(/mpeg|mp3/i.test(mime))return "mp3";
  return "webm";
}

module.exports=async function handler(req,res){
  res.setHeader("cache-control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:"openai_not_configured"});

  const token=bearer(req);
  if(!token||!(await validUser(token)))return res.status(401).json({error:"invalid_auth"});

  try{
    const dataUrl=String(req.body?.audio_data_url||"");
    const match=dataUrl.match(/^data:(audio\/(?:webm|mp4|mpeg|wav|x-m4a|m4a|ogg));base64,([A-Za-z0-9+/=]+)$/i);
    if(!match)return res.status(400).json({error:"invalid_audio",message:"Formato de áudio não suportado."});

    const mime=match[1].toLowerCase();
    const bytes=Buffer.from(match[2],"base64");
    if(!bytes.length||bytes.length>8*1024*1024)return res.status(413).json({error:"audio_too_large",message:"A gravação é demasiado longa."});

    const form=new FormData();
    form.append("model","gpt-transcribe");
    form.append("file",new Blob([bytes],{type:mime}),"voz."+extensionFor(mime));
    form.append("response_format","json");
    form.append("prompt","Ditado curto em português de Portugal sobre uma viatura, matrícula, marca, modelo, ano, quilómetros, versão ou preço.");
    form.append("languages[]","pt");

    const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{
      method:"POST",
      signal:AbortSignal.timeout(40000),
      headers:{authorization:"Bearer "+process.env.OPENAI_API_KEY},
      body:form
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return res.status(502).json({error:"transcription_failed",message:data?.error?.message||"Não consegui transcrever a gravação."});

    const text=String(data.text||"").trim();
    if(!text)return res.status(502).json({error:"empty_transcription",message:"Não consegui perceber a gravação."});
    return res.status(200).json({ok:true,text});
  }catch(error){
    return res.status(500).json({error:"server_error",message:String(error?.message||error)});
  }
};
