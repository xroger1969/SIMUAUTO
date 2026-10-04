const PLATE=/^(?:[A-Z]{2}\d{4}|\d{4}[A-Z]{2}|\d{2}[A-Z]{2}\d{2}|[A-Z]{2}\d{2}[A-Z]{2})$/;

function failure(message,status=502){return Object.assign(new Error(message),{status});}
function field(value){
  const v=value&&typeof value==='object'?value.CurrentTextValue:value;
  return typeof v==='string'||typeof v==='number'?String(v).trim():'';
}
function numberField(value){
  const text=field(value).replace(/\s+/g,'').replace(',','.').replace(/[^\d.]/g,'');
  const n=Number(text);
  return Number.isFinite(n)?n:null;
}
function intField(value){
  const n=numberField(value);
  return Number.isFinite(n)?Math.round(n):null;
}
function normalizeRegistration(value){
  const plate=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  return PLATE.test(plate)?plate:null;
}
function displayRegistration(value){
  const plate=normalizeRegistration(value);
  return plate?plate.replace(/(.{2})(.{2})(.{2})/,'$1-$2-$3'):null;
}
function normalizeDate(value){
  const text=field(value);
  if(!text)return null;
  let m=text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if(m)return m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');
  m=text.match(/^(\d{4})[\/-](\d{1,2})(?:[\/-](\d{1,2}))?$/);
  if(m)return m[1]+'-'+String(m[2]).padStart(2,'0')+(m[3]?'-'+String(m[3]).padStart(2,'0'):'');
  return text;
}
function decodeVehicleJson(xml){
  const match=String(xml||'').match(/<vehicleJson(?:\s[^>]*)?>([\s\S]*?)<\/vehicleJson>/i);
  if(!match)throw failure('O fornecedor não devolveu uma ficha válida para esta matrícula.');
  const raw=match[1].startsWith('<![CDATA[')
    ?match[1].slice(9,-3)
    :match[1]
      .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')
      .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n)))
      .replace(/&amp;/g,'&');
  try{return JSON.parse(raw)}catch{throw failure('Resposta inválida do fornecedor de matrículas.');}
}
function parseRegistration(xml){
  const data=decodeVehicleJson(xml);
  const make=field(data.CarMake)||field(data.MakeDescription);
  const model=field(data.CarModel)||field(data.ModelDescription);
  if(!make||!model)throw failure('Não foi possível identificar a viatura por esta matrícula.');
  const year=Number(field(data.RegistrationYear));
  const engine=intField(data.EngineSize);
  const doors=intField(data.NumberOfDoors);
  const seats=intField(data.NumberOfSeats);
  return {
    make,
    model,
    trim:field(data.Version)||null,
    year:Number.isInteger(year)&&year>=1900&&year<=new Date().getFullYear()+1?year:null,
    description:field(data.Description)||null,
    fuel:field(data.FuelType)||null,
    first_registration:normalizeDate(data.RegistrationDate),
    body_type:field(data.BodyStyle)||null,
    engine_cc:Number.isInteger(engine)&&engine>0?engine:null,
    transmission:field(data.Transmission)||null,
    doors:Number.isInteger(doors)&&doors>0&&doors<10?doors:null,
    seats:Number.isInteger(seats)&&seats>0&&seats<20?seats:null,
    color:field(data.Colour)||field(data.Color)||null,
    origin:[1,'1',true].includes(data.Imported)?'imported':[0,'0',false].includes(data.Imported)?'national':'unknown',
    provider:'regcheck_portugal'
  };
}
async function lookupRegistration(value,{username=process.env.REGISTRATION_API_USERNAME,fetcher=fetch}={}){
  const plate=normalizeRegistration(value);
  if(!plate)throw failure('Matrícula portuguesa inválida.',400);
  if(!username)throw failure('A consulta por matrícula está preparada, mas falta ativar a conta do fornecedor. Entretanto, escreve a marca, modelo, ano e quilómetros.',503);
  const endpoints=[
    'https://www.regcheck.org.uk/api/reg.asmx/CheckPortugal',
    'https://www.matricula.co.pt/api/reg.asmx/CheckPortugal'
  ];
  let transportError=null,httpError=null;
  for(const endpoint of endpoints){
    let response;
    try{
      response=await fetcher(endpoint,{
        method:'POST',
        headers:{'content-type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({RegistrationNumber:plate,username:username.trim()}),
        signal:AbortSignal.timeout(12000)
      });
    }catch(error){
      transportError=error;
      console.error('registration_transport_failure',{host:new URL(endpoint).hostname,kind:error.name,code:error.cause?.code||error.code||'unknown'});
      continue;
    }
    if(!response.ok){httpError=response.status;continue;}
    const xml=await response.text();
    if(xml.length>200000)throw failure('Resposta demasiado extensa do fornecedor.');
    const result=parseRegistration(xml);
    result.registration=displayRegistration(plate);
    return result;
  }
  if(httpError)throw failure('Consulta de matrícula indisponível. Verifica o acesso e os créditos do fornecedor.');
  if(transportError)throw failure('Não foi possível ligar ao serviço de matrículas. Tenta novamente dentro de instantes.');
  throw failure('Não foi possível consultar esta matrícula.');
}
module.exports={lookupRegistration,parseRegistration,normalizeRegistration,displayRegistration};
