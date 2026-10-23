const {authenticate,takeQuota,endpoint,appError}=require("../lib/access");
// Base64 adds about one third: keep the complete JSON request below the host's limit.
const MAX_AUDIO_BYTES=Math.floor(2.8*1024*1024);

function extensionFor(mime){
  if(/mp4|m4a/i.test(mime))return "m4a";
  if(/wav/i.test(mime))return "wav";
  if(/ogg/i.test(mime))return "ogg";
  if(/mpeg|mp3/i.test(mime))return "mp3";
  return "webm";
}
function parseAudioDataUrl(value){
  const dataUrl=String(value||"");
  if(dataUrl.length>Math.ceil(MAX_AUDIO_BYTES/3)*4+200)return null;
  const comma=dataUrl.indexOf(",");
  if(comma<0)return null;
  const header=dataUrl.slice(0,comma);
  const payload=dataUrl.slice(comma+1);
  const match=header.match(/^data:(audio\/(?:webm|mp4|mpeg|wav|x-m4a|m4a|ogg))((?:;[A-Za-z0-9._+-]+=[A-Za-z0-9._+-]+)*)?;base64$/i);
  if(!match||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)||!payload)return null;
  return {mime:match[1].toLowerCase(),payload};
}

const handler=endpoint(async function handler(req,res){
  if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
  if(!process.env.OPENAI_API_KEY)throw appError("OpenAI não configurada.",503,"openai_not_configured");
  const {token}=await authenticate(req);
  await takeQuota(token,"voice");

  if(String(req.body?.audio_data_url||"").length>Math.ceil(MAX_AUDIO_BYTES/3)*4+200){
    return res.status(413).json({error:"audio_too_large",message:"A gravação é demasiado longa. Divide-a em mensagens mais curtas."});
  }
  const parsed=parseAudioDataUrl(req.body?.audio_data_url);
  if(!parsed)return res.status(400).json({error:"invalid_audio",message:"Formato de áudio não suportado."});
  const bytes=Buffer.from(parsed.payload,"base64");
  if(!bytes.length||bytes.length>MAX_AUDIO_BYTES)return res.status(413).json({error:"audio_too_large",message:"A gravação é demasiado longa. Divide-a em mensagens mais curtas."});

  const form=new FormData();
  form.append("model","gpt-transcribe");
  form.append("file",new Blob([bytes],{type:parsed.mime}),"voz."+extensionFor(parsed.mime));
  form.append("response_format","json");
  form.append("prompt","Conversa em português de Portugal sobre automóveis usados: matrícula, marca, modelo, versão, preço de compra, preço de revenda, margem, procura e dificuldade de venda. Transcreve apenas as palavras ouvidas e conserva exatamente os valores ditos; não completes informação em falta.");
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
module.exports=handler;
module.exports._test={parseAudioDataUrl,extensionFor,MAX_AUDIO_BYTES};
