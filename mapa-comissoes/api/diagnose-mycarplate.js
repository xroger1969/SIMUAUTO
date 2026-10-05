module.exports=async function handler(req,res){
  const urls=[
    'https://mycarplate.online/api/v1/vehicle?plate=1906NC&country=PT',
    'https://www.mycarplate.online/api/v1/vehicle?plate=1906NC&country=PT'
  ];
  const out=[];
  for(const url of urls){
    try{
      const response=await fetch(url,{headers:{accept:'application/json','user-agent':'AvaliadorAutoPro/1.0'},signal:AbortSignal.timeout(12000)});
      out.push({host:new URL(url).host,ok:response.ok,status:response.status,contentType:response.headers.get('content-type')});
    }catch(error){
      out.push({host:new URL(url).host,ok:false,error:error?.message||String(error),name:error?.name||null,cause:error?.cause?.message||error?.cause?.code||null});
    }
  }
  res.status(200).json({ok:true,tests:out});
};