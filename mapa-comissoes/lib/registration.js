const PLATE=/^(?:[A-Z]{2}\d{4}|\d{4}[A-Z]{2}|\d{2}[A-Z]{2}\d{2}|[A-Z]{2}\d{2}[A-Z]{2})$/;
function failure(message,status=502){return Object.assign(new Error(message),{status});}
function field(value){const v=value&&typeof value==='object'?value.CurrentTextValue:value;return typeof v==='string'||typeof v==='number'?String(v).trim():'';}
function parseRegistration(xml){
  const match=xml.match(/<vehicleJson(?:\s[^>]*)?>([\s\S]*?)<\/vehicleJson>/i);
  if(!match)throw failure('O fornecedor não devolveu uma ficha válida para esta matrícula.');
  const raw=match[1].startsWith('<![CDATA[')?match[1].slice(9,-3):match[1].replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&amp;/g,'&');
  let data;try{data=JSON.parse(raw);}catch{throw failure('Resposta inválida do fornecedor de matrículas.');}
  const make=field(data.CarMake)||field(data.MakeDescription), model=field(data.CarModel)||field(data.ModelDescription);
  if(!make||!model)throw failure('Não foi possível identificar a viatura por esta matrícula.');
  const year=Number(field(data.RegistrationYear));
  return {make,model,trim:field(data.Version)||null,year:Number.isInteger(year)&&year>=1900&&year<=new Date().getFullYear()+1?year:null,description:field(data.Description),fuel:field(data.FuelType)||null,first_registration:field(data.RegistrationDate)||null,origin:[1,'1',true].includes(data.Imported)?'imported':[0,'0',false].includes(data.Imported)?'national':'unknown',provider:'matricula.co.pt'};
}
async function lookupRegistration(value,{username=process.env.REGISTRATION_API_USERNAME,fetcher=fetch}={}){
 const plate=String(value||'').toUpperCase().replace(/[\s-]/g,'');
 if(!PLATE.test(plate))throw failure('Matrícula portuguesa inválida.',400);
 if(!username)throw failure('A consulta por matrícula está preparada, mas falta ativar a conta do fornecedor. Entretanto, escreve a marca, modelo, ano e quilómetros.',503);
 let response;try{response=await fetcher('https://www.matricula.co.pt/api/reg.asmx/CheckPortugal',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({RegistrationNumber:plate,username:username.trim()}),signal:AbortSignal.timeout(45000)});}catch(error){console.error('registration_transport_failure',{kind:error.name,code:error.cause?.code||error.code||'unknown'});throw failure('Não foi possível ligar ao serviço de matrículas. Tenta novamente dentro de instantes.');}
 if(!response.ok)throw failure('Consulta de matrícula indisponível. Verifica o acesso e os créditos do fornecedor.');
 const xml=await response.text();if(xml.length>200000)throw failure('Resposta demasiado extensa do fornecedor.');
 return parseRegistration(xml);
}
module.exports={lookupRegistration,parseRegistration};
