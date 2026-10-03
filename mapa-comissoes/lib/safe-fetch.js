const dns=require("node:dns").promises;
const net=require("node:net");
const http=require("node:http");
const https=require("node:https");

function publicIp(ip){
  if(net.isIPv4(ip)){
    const [a,b,c]=ip.split(".").map(Number);
    if(a===0||a===10||a===127||a>=224)return false;
    if(a===100&&b>=64&&b<=127)return false;
    if(a===169&&b===254)return false;
    if(a===172&&b>=16&&b<=31)return false;
    if(a===192&&(b===168||(b===0&&c<=2)||(b===88&&c===99)))return false;
    if(a===198&&(b===18||b===19||(b===51&&c===100)))return false;
    if(a===203&&b===0&&c===113)return false;
    return true;
  }
  if(net.isIPv6(ip)){
    const x=ip.toLowerCase();
    if(x.startsWith("::ffff:"))return publicIp(x.slice(7));
    if(!/^[23][0-9a-f]{0,3}:/.test(x))return false;
    if(/^2001:(?:0{0,4}:|db8:|10:|20:)/.test(x))return false;
    if(/^2002:/.test(x))return false;
    return true;
  }
  return false;
}

async function resolvePublic(host,deadline){
  const remaining=Math.max(1,deadline-Date.now());
  const addresses=await Promise.race([
    dns.lookup(host,{all:true,verbatim:true}),
    new Promise((_,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Tempo de DNS excedido.")),remaining);
      timer.unref?.();
    })
  ]);
  if(!addresses?.length||addresses.some(item=>!publicIp(item.address)))throw new Error("Endereço privado ou reservado não permitido.");
  return addresses[0];
}

async function oneRequest(url,pinned,{deadline,maxBytes}){
  return new Promise((resolve,reject)=>{
    const client=url.protocol==="https:"?https:http;
    const request=client.request(url,{
      method:"GET",
      agent:false,
      lookup:(_host,options,callback)=>{
        if(typeof options==="function"){callback=options;options={};}
        if(options?.all)return callback(null,[pinned]);
        callback(null,pinned.address,pinned.family);
      },
      headers:{
        "user-agent":"Mozilla/5.0 ComparadorAutoPro/2026",
        accept:"text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.7",
        "accept-language":"pt-PT,pt;q=0.9",
        "accept-encoding":"identity"
      }
    },response=>{
      const chunks=[];
      let size=0;
      response.on("data",chunk=>{
        size+=chunk.length;
        if(size>maxBytes){
          request.destroy(new Error("Página demasiado grande para leitura direta."));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("error",reject);
      response.on("end",()=>resolve({
        status:response.statusCode||0,
        headers:response.headers,
        body:Buffer.concat(chunks)
      }));
    });
    const timer=setTimeout(()=>request.destroy(new Error("Tempo de leitura excedido.")),Math.max(1,deadline-Date.now()));
    request.on("close",()=>clearTimeout(timer));
    request.on("error",reject);
    request.end();
  });
}

async function safeFetch(raw,{timeout=12000,maxBytes=1500000,maxRedirects=3}={}){
  const deadline=Date.now()+timeout;
  let current=String(raw||"");

  for(let hop=0;hop<=maxRedirects;hop++){
    const url=new URL(current);
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error("Endereço não permitido.");
    if(url.port&&!["80","443"].includes(url.port))throw new Error("Porta não permitida.");
    const host=url.hostname.replace(/^\[|\]$/g,"").toLowerCase();
    if(!host||host==="localhost"||host.endsWith(".local"))throw new Error("Endereço não permitido.");

    const pinned=await resolvePublic(host,deadline);
    const response=await oneRequest(url,pinned,{deadline,maxBytes});
    const location=response.headers.location;

    if(response.status>=300&&response.status<400&&location){
      if(hop===maxRedirects)throw new Error("Demasiados redirecionamentos.");
      const next=new URL(location,url);
      if(url.protocol==="https:"&&next.protocol!=="https:")throw new Error("Redirecionamento inseguro.");
      current=next.toString();
      continue;
    }

    return {
      ok:response.status>=200&&response.status<300,
      status:response.status,
      url:url.toString(),
      headers:{get:key=>String(response.headers[String(key).toLowerCase()]||"")},
      text:async()=>response.body.toString("utf8")
    };
  }
  throw new Error("Não foi possível obter a página.");
}

module.exports={safeFetch,publicIp};
