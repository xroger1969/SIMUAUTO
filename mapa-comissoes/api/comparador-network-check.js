module.exports=async(req,res)=>{
 res.setHeader('cache-control','no-store');
 try{const r=await fetch('https://www.matricula.co.pt/api/reg.asmx?op=CheckPortugal',{signal:AbortSignal.timeout(15000)});return res.json({ok:r.ok,status:r.status});}
 catch(e){return res.json({ok:false,kind:e.name,code:e.cause?.code||e.code||null});}
};
