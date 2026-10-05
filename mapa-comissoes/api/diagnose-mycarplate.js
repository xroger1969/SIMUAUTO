module.exports=async function handler(req,res){
  const url='https://mycarplate.online/api/v1/vehicle?plate=14ID91&country=PT&withVin=true';
  try{
    const response=await fetch(url,{headers:{accept:'application/json','user-agent':'AvaliadorAutoPro/1.0'},signal:AbortSignal.timeout(20000)});
    const text=await response.text();
    let body=null;try{body=JSON.parse(text)}catch{}
    const data=body?.data||null;
    return res.status(200).json({
      ok:response.ok,status:response.status,
      vehicle:data?{
        plate:data.plate,make:data.make,model:data.model,version:data.version,year:data.year,
        fuelType:data.fuelType,engineSize:data.engineSize,horsePower:data.horsePower,powerKw:data.powerKw,
        firstRegistration:data.firstRegistration,bodyClass:data.bodyClass,engineCode:data.engineCode,
        hasVin:!!data.vin,vinLength:data.vin?String(data.vin).length:0,
        keys:Object.keys(data).sort()
      }:null,
      error:body?.error||null
    });
  }catch(error){
    return res.status(200).json({ok:false,error:error?.message||String(error),name:error?.name||null,cause:error?.cause?.message||error?.cause?.code||null});
  }
};