const SUPABASE_URL="https://ciyycnjxteqpphgbkneg.supabase.co";
const SUPABASE_KEY="sb_publishable_NLLNaEvhKHfoJNenqpObdA_sNA8UTNa";

function appError(message,status=500,code="request_failed"){
  const error=new Error(message);
  error.status=status;
  error.code=code;
  return error;
}

async function jsonFetch(url,options={},timeout=10000){
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(timeout)});
  const data=await response.json().catch(()=>null);
  return {response,data};
}

async function rest(token,path,{method="GET",body,headers={}}={}){
  const {response,data}=await jsonFetch(SUPABASE_URL+"/rest/v1/"+path,{
    method,
    headers:{
      apikey:SUPABASE_KEY,
      authorization:"Bearer "+token,
      "content-type":"application/json",
      ...headers
    },
    ...(body===undefined?{}:{body:typeof body==="string"?body:JSON.stringify(body)})
  });
  if(!response.ok)throw appError("Não foi possível consultar ou guardar os dados do Comparador.",response.status>=500?503:response.status,"storage_error");
  return data;
}

async function authenticate(req){
  const auth=String(req.headers.authorization||"");
  if(!auth.startsWith("Bearer "))throw appError("Sessão inválida.",401,"invalid_auth");
  const token=auth.slice(7).trim();
  if(!token)throw appError("Sessão inválida.",401,"invalid_auth");

  const {response:userResponse,data:user}=await jsonFetch(SUPABASE_URL+"/auth/v1/user",{
    headers:{apikey:SUPABASE_KEY,authorization:"Bearer "+token}
  });
  if(!userResponse.ok||!user?.id)throw appError("A sessão expirou. Entra novamente.",401,"invalid_auth");

  const {response:memberResponse,data:member}=await jsonFetch(SUPABASE_URL+"/rest/v1/rpc/get_current_member",{
    method:"POST",
    headers:{
      apikey:SUPABASE_KEY,
      authorization:"Bearer "+token,
      "content-type":"application/json",
      "content-profile":"mapa_comercial"
    },
    body:"{}"
  });
  if(!memberResponse.ok||member?.active!==true||member?.role!=="admin")throw appError("Acesso reservado ao administrador.",403,"forbidden");
  return {token,user,member};
}

async function takeQuota(token,kind){
  const allowed=await rest(token,"rpc/cap_take_quota",{method:"POST",body:{p_kind:kind}});
  if(allowed!==true)throw appError("Limite temporário de pedidos atingido. Aguarda e tenta novamente.",429,"rate_limited");
}

function endpoint(handler){
  return async function(req,res){
    res.setHeader("cache-control","no-store");
    try{
      return await handler(req,res);
    }catch(error){
      const timeout=error?.name==="TimeoutError"||error?.name==="AbortError";
      const status=timeout?504:(error?.status||500);
      return res.status(status).json({
        error:timeout?"timeout":(error?.code||"request_failed"),
        message:timeout?"O serviço demorou demasiado. Tenta novamente.":String(error?.message||"Não foi possível concluir o pedido.")
      });
    }
  };
}

module.exports={SUPABASE_URL,SUPABASE_KEY,authenticate,takeQuota,rest,endpoint,appError};
