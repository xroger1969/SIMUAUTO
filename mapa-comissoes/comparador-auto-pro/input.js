function embeddedHttpUrl(value){
  const match=String(value||"").match(/(?:https?:\/\/|www\.)[^\s<>"']+/i);
  if(!match)return null;
  let raw=match[0].replace(/[),.;!?]+$/g,"");
  if(/^www\./i.test(raw))raw="https://"+raw;
  return raw;
}

const PORTUGUESE_PLATE=/^(?:[A-Z]{2}\d{4}|\d{4}[A-Z]{2}|\d{2}[A-Z]{2}\d{2}|[A-Z]{2}\d{2}[A-Z]{2})$/;

// Apenas matrículas portuguesas completas: nunca interpretar uma descrição livre como matrícula.
export function formatVehiclePlate(raw){
  const cleaned=String(raw||"").trim().toUpperCase().replace(/[\s.\-]/g,"");
  if(!PORTUGUESE_PLATE.test(cleaned))return null;
  return cleaned.replace(/^(.{2})(.{2})(.{2})$/,"$1-$2-$3");
}

export function parseOptionalMileage(raw){
  const value=String(raw??"").trim();
  if(!value)return null;
  const digits=value.replace(/[\s.]/g,"");
  if(!/^\d+$/.test(digits)||Number(digits)>2000000)throw new Error("Indica quilómetros válidos, por exemplo 125 000, ou deixa o campo vazio.");
  return Number(digits);
}

export function parseVehicleInput(raw){
  const value=String(raw||"").trim();
  if(value.length<3||value.length>4000)throw new Error("Cola um link ou descreve a viatura (até 4000 caracteres).");
  const displayPlate=formatVehiclePlate(value);
  if(displayPlate){
    const plate=displayPlate.replace(/-/g,"");
    return {mode:"manual",registration:displayPlate,url:null,description:displayPlate,sourceUrl:"plate:"+plate,sourceDomain:"matricula.co.pt"};
  }

  const extracted=embeddedHttpUrl(value);
  if(extracted){
    const url=new URL(extracted);
    if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("Usa um link público sem credenciais.");
    if(url.hostname==="auto1.com")url.hostname="www.auto1.com";
    return {
      mode:"url",
      url,
      description:"",
      sourceUrl:url.toString(),
      sourceDomain:url.hostname
    };
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
