module.exports=async function handler(req,res){
  try{
    const first=await fetch('https://mycarplate.online/api/v1/vehicle?plate=14ID91&country=PT&withVin=true',{
      headers:{accept:'application/json','user-agent':'AvaliadorAutoPro/1.0'},signal:AbortSignal.timeout(20000)
    });
    const body=await first.json().catch(()=>null);
    const data=body?.data||null;
    const out={
      plate:{ok:first.ok,status:first.status,make:data?.make||null,model:data?.model||null,version:data?.version||null,year:data?.year||null,fuelType:data?.fuelType||null,hasVin:!!data?.vin}
    };
    if(data?.vin){
      const vp='https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/'+encodeURIComponent(data.vin)+'?format=json'+(data.year?'&modelyear='+encodeURIComponent(data.year):'');
      const vr=await fetch(vp,{headers:{accept:'application/json','user-agent':'AvaliadorAutoPro/1.0'},signal:AbortSignal.timeout(20000)});
      const vj=await vr.json().catch(()=>null);
      const v=Array.isArray(vj?.Results)?vj.Results[0]:null;
      out.vinDecode={ok:vr.ok,status:vr.status,make:v?.Make||null,model:v?.Model||null,modelYear:v?.ModelYear||null,trim:v?.Trim||null,series:v?.Series||null,fuelType:v?.FuelTypePrimary||null,engineModel:v?.EngineModel||null,displacementL:v?.DisplacementL||null,engineHP:v?.EngineHP||null,errorCode:v?.ErrorCode||null,errorText:v?.ErrorText||null};
    }
    return res.status(200).json(out);
  }catch(error){
    return res.status(200).json({ok:false,error:error?.message||String(error),name:error?.name||null,cause:error?.cause?.message||error?.cause?.code||null});
  }
};