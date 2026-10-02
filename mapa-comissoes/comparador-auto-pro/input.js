export function parseVehicleInput(raw){
  const value=String(raw||"").trim();
  if(value.length<3||value.length>4000)throw new Error("Cola um link ou descreve a viatura (até 4000 caracteres).");
  const plate=value.toUpperCase().replace(/[\s-]/g,"");
  if(/^(?:[A-Z]{2}\d{4}|\d{4}[A-Z]{2}|\d{2}[A-Z]{2}\d{2}|[A-Z]{2}\d{2}[A-Z]{2})$/.test(plate))return {mode:"manual",registration:plate,url:null,description:value,sourceUrl:"plate:"+plate,sourceDomain:"matricula.co.pt"};
  const isLink=/^(?:https?:\/\/|www\.)/i.test(value);
  if(isLink){
    const url=new URL(/^www\./i.test(value)?"https://"+value:value);
    if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("Usa um link público sem credenciais.");
    if(url.hostname==="auto1.com")url.hostname="www.auto1.com";
    return {mode:"url",url,description:"",sourceUrl:url.toString(),sourceDomain:url.hostname};
  }
  if(/^[a-z][a-z0-9+.-]*:/i.test(value))throw new Error("Esse tipo de link não é suportado.");
  return {mode:"manual",url:null,description:value,sourceUrl:"manual:"+value,sourceDomain:"manual"};
}
export function manualMissing(subject){
  const missing=[];
  if(!subject?.year)missing.push("ano");
  if(subject?.mileage_km==null)missing.push("quilómetros");
  if(!subject?.trim)missing.push("versão exata");
  return missing;
}
