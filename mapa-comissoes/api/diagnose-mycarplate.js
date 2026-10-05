const {lookupRegistration}=require("../lib/registration");

module.exports=async function handler(req,res){
  try{
    const data=await lookupRegistration("14-ID-91",{
      username:null,
      apiKey:null,
      myCarPlateApiKey:process.env.MYCARPLATE_API_KEY,
      fetcher:fetch
    });
    return res.status(200).json({
      ok:true,
      vehicle:{
        registration:data.registration,
        make:data.make,
        model:data.model,
        trim:data.trim,
        year:data.year,
        fuel:data.fuel,
        first_registration:data.first_registration,
        transmission:data.transmission,
        power_cv:data.power_cv,
        provider:data.provider,
        version_options:data.version_options
      }
    });
  }catch(error){
    return res.status(200).json({ok:false,error:error?.message||String(error),status:error?.status||null});
  }
};