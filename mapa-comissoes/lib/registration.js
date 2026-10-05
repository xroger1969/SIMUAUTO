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
function parseRegistrationData(data,provider='matricula.co.pt'){
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
    provider
  };
}

function parseRegistration(xml){
  return parseRegistrationData(decodeVehicleJson(xml),'matricula.co.pt');
}
function inferModelFromOptions(make,options){
  const rows=(Array.isArray(options)?options:[]).map(v=>field(v)).filter(Boolean).slice(0,20);
  if(!rows.length)return '';
  const makeText=field(make);
  const escape=s=>s.replace(/[|\\{}()[\]^$+*?.-]/g,'\\function parseRegistration(xml){
  return parseRegistrationData(decodeVehicleJson(xml),'matricula.co.pt');
}
function parseMyCarPlateData(payload){');
  const tokenRows=rows.map(row=>{
    const stripped=makeText?row.replace(new RegExp('^'+escape(makeText)+'\\s+','i'),''):row;
    return stripped.split(/\\s+/).filter(Boolean);
  }).filter(parts=>parts.length);
  if(!tokenRows.length)return '';
  const first=tokenRows[0],prefix=[];
  for(let i=0;i<first.length;i++){
    const key=first[i].normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    if(!key||!tokenRows.every(parts=>{
      const p=parts[i];
      return p&&p.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'')===key;
    }))break;
    prefix.push(first[i]);
  }
  if(!prefix.length)return '';
  const generic=new Set(['model','modelo','series','serie','class','classe','diesel','petrol','gasolina','hybrid','hibrido','electric','eletrico']);
  const firstKey=prefix[0].normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  if(generic.has(firstKey)||firstKey.length<2)return '';
  return prefix.join(' ').trim();
}
function parseMyCarPlateData(payload){
  const data=payload&&typeof payload==='object'&&payload.data&&typeof payload.data==='object'?payload.data:payload;
  if(!data||typeof data!=='object')throw failure('O MyCarPlate não devolveu uma ficha válida para esta matrícula.');
  const make=field(data.make);
  const versionOptions=(Array.isArray(data.versionOptions)?data.versionOptions:[]).map(v=>field(v)).filter(Boolean).slice(0,20);
  const model=field(data.model)||inferModelFromOptions(make,versionOptions);
  if(!make&&!model)throw failure('O MyCarPlate não conseguiu identificar a viatura por esta matrícula.',404);
  const year=intField(data.year);
  const engine=intField(data.engineSize);
  const doors=intField(data.doors);
  const seats=intField(data.seats);
  const powerCv=intField(data.horsePower);
  const powerKw=numberField(data.powerKw);
  const co2=numberField(data.co2Emissions);
  return {
    registration:displayRegistration(data.plate)||null,
    make,
    model,
    trim:field(data.version)||null,
    version_options:versionOptions,
    confidence:Number.isFinite(Number(data.confidence))?Number(data.confidence):null,
    year:Number.isInteger(year)&&year>=1900&&year<=new Date().getFullYear()+1?year:null,
    description:null,
    fuel:field(data.fuelType)||null,
    first_registration:normalizeDate(data.firstRegistration),
    body_type:field(data.bodyClass)||null,
    engine_cc:Number.isInteger(engine)&&engine>0?engine:null,
    power_cv:Number.isInteger(powerCv)&&powerCv>0?powerCv:null,
    power_kw:Number.isFinite(powerKw)&&powerKw>0?powerKw:null,
    transmission:field(data.transmission)||null,
    doors:Number.isInteger(doors)&&doors>0&&doors<10?doors:null,
    seats:Number.isInteger(seats)&&seats>0&&seats<20?seats:null,
    color:field(data.color)||null,
    vin:field(data.vin)||null,
    engine_code:field(data.engineCode)||null,
    co2_g_km:Number.isFinite(co2)&&co2>=0?co2:null,
    origin:'unknown',
    provider:'mycarplate'
  };
}
async function lookupRegistration(value,{
 username=process.env.REGISTRATION_API_USERNAME,
 apiKey=process.env.REGISTRATION_API_KEY,
 myCarPlateApiKey=process.env.MYCARPLATE_API_KEY,
 fetcher=fetch
}={}){
  const plate=normalizeRegistration(value);
  if(!plate)throw failure('Matrícula portuguesa inválida.',400);

  let myCarPlateStatus=null,myCarPlateTransportError=null;
  try{
    const headers={accept:'application/json','user-agent':'AvaliadorAutoPro/1.0'};
    if(myCarPlateApiKey)headers['X-API-Key']=myCarPlateApiKey.trim();
    const response=await fetcher(
      'https://mycarplate.online/api/v1/vehicle?plate='+encodeURIComponent(plate)+'&country=PT&withVin=true',
      {headers,signal:AbortSignal.timeout(20000)}
    );
    myCarPlateStatus=response.status;
    if(response.ok){
      const json=await response.json();
      if(json?.success!==false){
        const result=parseMyCarPlateData(json);
        result.registration=result.registration||displayRegistration(plate);
        return result;
      }
    }else if(response.status!==404&&response.status!==422){
      console.warn('mycarplate_http_failure',{status:response.status});
    }
  }catch(error){
    myCarPlateTransportError=error;
    console.warn('mycarplate_transport_failure',{kind:error?.name||'unknown',message:error?.message||'',cause:error?.cause?.message||error?.cause?.code||'',code:error?.cause?.code||error?.code||'unknown'});
  }

  if(!username){
    if(myCarPlateStatus===429)throw failure('O limite gratuito da consulta de matrícula foi atingido. A avaliação pode continuar pelas fotografias e pesquisa de mercado.',429);
    if(myCarPlateTransportError)throw failure('Não foi possível ligar ao serviço gratuito de matrículas. A avaliação pode continuar pelas fotografias e pesquisa de mercado.');
    throw failure('Não foi possível identificar automaticamente esta matrícula. A avaliação pode continuar pelas fotografias e pesquisa de mercado.',404);
  }

  if(apiKey){
    try{
      const auth=Buffer.from(username.trim()+':'+apiKey.trim()).toString('base64');
      const response=await fetcher(
        'https://www.regcheck.org.uk/api/json.aspx/CheckPortugal/'+encodeURIComponent(plate),
        {headers:{authorization:'Basic '+auth,accept:'application/json'},signal:AbortSignal.timeout(12000)}
      );
      if(response.ok){
        const data=await response.json();
        const result=parseRegistrationData(data,'regcheck_rest');
        result.registration=displayRegistration(plate);
        return result;
      }
      if(response.status===401||response.status===403){
        console.warn('registration_rest_auth_failure',{status:response.status});
      }
    }catch(error){
      console.warn('registration_rest_failure',{kind:error?.name||'unknown'});
    }
  }

  const endpoints=[
    'https://www.matricula.co.pt/api/reg.asmx/CheckPortugal',
    'https://www.regcheck.org.uk/api/reg.asmx/CheckPortugal'
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
module.exports={lookupRegistration,parseRegistration,parseRegistrationData,parseMyCarPlateData,inferModelFromOptions,normalizeRegistration,displayRegistration};
