const {authenticate,takeQuota,endpoint,appError}=require("../lib/access");

function extensionFor(mime){
  if(/mp4|m4a/i.test(mime))return "m4a";
  if(/wav/i.test(mime))return "wav";
  if(/ogg/i.test(mime))return "ogg";
  if(/mpeg|mp3/i.test(mime))return "mp3";
  return "webm";
}
function parseAudioDataUrl(value){
  const dataUrl=String(value||"");
  const comma=dataUrl.indexOf(",");
  if(comma<0)return null;
  const header=dataUrl.slice(0,comma);
  const payload=dataUrl.slice(comma+1);
  const match=header.match(/^data:(audio\/(?:webm|mp4|mpeg|wav|x-m4a|m4a|ogg))((?:;[A-Za-z0-9._+-]+=[A-Za-z0-9._+-]+)*)?;base64$/i);
  if(!match||!/^[A-Za-z0-9+/=]+$/.test(payload))return null;
  return {mime:match[1].toLowerCase(),payload};
}

module.exports=endpoint(async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  if(!process.env.OPENAI_API_KEY)throw appError("OpenAI não configurada.",503,"openai_not_configured");
  const {token}=await authenticate(req);
  await takeQuota(token,"voice");

  const parsed=parseAudioDataUrl(req.body?.audio_data_url);
  if(!parsed)return res.status(400).json({error:"invalid_audio",message:"Formato de áudio não suportado."});
  const bytes=Buffer.from(parsed.payload,"base64");
  if(!bytes.length||bytes.length>8*1024*1024)return res.status(413).json({error:"audio_too_large",message:"A gravação é demasiado longa."});

  const form=new FormData();
  form.append("model","gpt-transcribe");
  form.append("file",new Blob([bytes],{type:parsed.mime}),"voz."+extensionFor(parsed.mime));
  form.append("response_format","json");
  form.append("prompt","Ditado curto em português de Portugal sobre uma viatura, matrícula, marca, modelo, ano, quilómetros, versão ou preço.");
  form.append("languages[]","pt");

  const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{
    method:"POST",signal:AbortSignal.timeout(40000),
    headers:{authorization:"Bearer "+process.env.OPENAI_API_KEY},body:form
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw appError(data?.error?.message||"Não consegui transcrever a gravação.",502,"transcription_failed");
  const text=String(data.text||"").trim();
  if(!text)throw appError("Não consegui perceber a gravação.",502,"empty_transcription");
  return res.status(200).json({ok:true,text});
});
