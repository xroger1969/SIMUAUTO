const allowedHosts=new Set([
  "mapa-comercial-git-feature-comparad-a70ff4-xroger1969s-projects.vercel.app",
  "mapa-comercial-sand.vercel.app"
]);
function allowedSender(sender){
  try {const u=new URL(sender.url);return u.protocol==="https:"&&allowedHosts.has(u.hostname)&&u.pathname.startsWith("/comparador-auto-pro/")&&sender.frameId===0;}catch{return false}
}
function vehicleUrl(raw){
  const u=new URL(raw);
  if(u.protocol!=="https:" || u.hostname!=="www.auto1.com" || u.username || u.password || u.port)throw new Error("Usa um link de viatura em www.auto1.com.");
  const m=u.pathname.match(/^\/([a-z]{2})\/app\/merchant\/car\/([A-Z0-9]{5,12})\/?$/i);
  if(!m)throw new Error("O link não corresponde a uma ficha de viatura AUTO1.");
  return {url:`https://www.auto1.com/${m[1]}/app/merchant/car/${m[2]}`,code:m[2]};
}
// Executed in the isolated extension world. Capture rendered listing content, never form values,
// cookies, storage, tokens, or hidden application state.
function captureListing(expectedCode){
  if(location.hostname!=="www.auto1.com" || !location.pathname.endsWith("/car/"+expectedCode))return {ready:false};
  const visiblePassword=[...document.querySelectorAll('input[type="password"]')].some(el=>el.getClientRects().length>0);
  if(visiblePassword)return {ready:false,login:true};
  const root=document.querySelector("main,[role=main]")||document.body;
  if(!root)return {ready:false};
  const clone=root.cloneNode(true);
  clone.querySelectorAll("script,style,nav,header,footer,input,textarea,select,[hidden],[aria-hidden=true]").forEach(el=>el.remove());
  const text=(clone.innerText||clone.textContent||"").replace(/\s+/g," ").trim().slice(0,14000);
  const heading=document.querySelector("h1")?.innerText||document.title;
  if(text.length<250 || !/\bkm\b|quil[oó]metros|mileage|kilometer/i.test(text) || !/€|EUR|preço|price|preco/i.test(text))return {ready:false};
  const json=[];
  for(const script of document.querySelectorAll('script[type="application/ld+json"]')){
    if(script.textContent.length>12000)continue;
    try{const v=JSON.parse(script.textContent);json.push(v)}catch{}
    if(json.length>=4)break;
  }
  return {ready:true,page:{title:heading.slice(0,300),description:"Anúncio privado AUTO1 lido na sessão do comerciante.",text_sample:text,json_ld:json},final_url:location.href};
}
let busy=false;
async function readListing(raw,sender){
  if(busy)throw new Error("Já existe uma leitura AUTO1 em curso. Aguarda a conclusão.");
  const target=vehicleUrl(raw);busy=true;
  try{
    const tabs=await chrome.tabs.query({url:"https://www.auto1.com/*"});
    const existing=tabs.find(t=>{try{return new URL(t.url).pathname===new URL(target.url).pathname}catch{return false}});
    const tab=existing?await chrome.tabs.update(existing.id,{active:true}):await chrome.tabs.create({url:target.url,active:true});
    const end=Date.now()+70000;let previous="";
    while(Date.now()<end){
      try{
        const [capture]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:captureListing,args:[target.code]});
        const result=capture?.result;
        if(result?.ready){
          // A stable second sample prevents capturing the partially rendered shell.
          if(previous===result.page.text_sample){
            if(sender.tab?.id)await chrome.tabs.update(sender.tab.id,{active:true}).catch(()=>{});
            return {ok:true,reader:{ok:true,status:"ok",source_kind:"authenticated_browser",source_domain:"www.auto1.com",vehicle_code:target.code,captured_at:new Date().toISOString(),page:result.page,final_url:result.final_url}};
          }
          previous=result.page.text_sample;
        }
      }catch{/* tab still loading, or user navigating to sign in */}
      await new Promise(resolve=>setTimeout(resolve,1200));
    }
    throw new Error("A AUTO1 não mostrou a ficha completa. Inicia sessão na aba AUTO1, abre a viatura e volta a carregar em Analisar compra.");
  }finally{busy=false}
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(!allowedSender(sender))return false;
  if(msg.action==="ping"){reply({ok:true,version:"1.0.0"});return false}
  if(msg.action!=="read")return false;
  readListing(msg.url,sender).then(reply).catch(error=>reply({ok:false,message:error.message}));
  return true;
});
