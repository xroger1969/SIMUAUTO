module.exports=async function handler(req,res){
  try{
    const first=await fetch('https://mycarplate.online/api/v1/vehicle?plate=14ID91&country=PT&withVin=true',{
      headers:{accept:'application/json','user-agent':'AvaliadorAutoPro/1.0'},signal:AbortSignal.timeout(20000)
    });
    const body=await first.json().catch(()=>null);
    const d=body?.data||null;
    return res.status(200).json({
      ok:first.ok,status:first.status,
      vehicle:d?{
        plate:d.plate,make:d.make,model:d.model,version:d.version,year:d.year,fuelType:d.fuelType,
        engineSize:d.engineSize,horsePower:d.horsePower,powerKw:d.powerKw,firstRegistration:d.firstRegistration,
        bodyClass:d.bodyClass,engineCode:d.engineCode,transmission:d.transmission,doors:d.doors,
        versionOptions:d.versionOptions||null,doorsOptions:d.doorsOptions||null,base7Code:d.base7Code||null,
        confidence:d.confidence||null,hasVin:!!d.vin
      }:null,error:body?.error||null
    });
  }catch(error){
    return res.status(200).json({ok:false,error:error?.message||String(error),name:error?.name||null,cause:error?.cause?.message||error?.cause?.code||null});
  }
};