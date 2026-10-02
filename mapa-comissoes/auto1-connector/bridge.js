// This bridge receives only explicit page requests. It never reads AUTO1 credentials.
const active = new Set();
window.addEventListener("message", async event => {
  if(event.source!==window || event.origin!==location.origin)return;
  const msg=event.data;
  if(!msg || msg.channel!=="CAP_AUTO1_REQUEST" || typeof msg.id!=="string" || msg.id.length>100)return;
  if(!["ping","read"].includes(msg.action) || active.size>1 || active.has(msg.id))return;
  active.add(msg.id);
  try {
    const response=await chrome.runtime.sendMessage({action:msg.action,url:msg.url});
    window.postMessage({channel:"CAP_AUTO1_RESPONSE",id:msg.id,...response},location.origin);
  }catch(error){
    window.postMessage({channel:"CAP_AUTO1_RESPONSE",id:msg.id,ok:false,message:"A extensão foi desligada. Recarrega o Comparador."},location.origin);
  }finally{active.delete(msg.id)}
});
