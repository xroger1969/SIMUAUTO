const {waitUntil}=require("@vercel/functions");

const running=new Map();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// The same owner-scoped poll used by the browser also collects results while
// iOS suspends the page. Bounded by the function lifetime; later polls can resume.
async function collectMarketJob(poll,{deadline=Date.now()+240000,now=Date.now,sleep=delay}={}){
  let failures=0;
  while(now()<deadline){
    await sleep(4000);
    try{
      const result=await poll();
      failures=0;
      if(result.status!==202)return result;
    }catch(error){
      if([400,401,402,403,404,409].includes(error?.status)||++failures>=3)return;
    }
  }
}

function continueMarketJob(jobId,poll,startedAt=Date.now()){
  if(!process.env.VERCEL||running.has(jobId))return;
  const task=collectMarketJob(poll,{deadline:startedAt+240000})
    .catch(()=>{})
    .finally(()=>running.delete(jobId));
  running.set(jobId,task);
  waitUntil(task);
}

module.exports={continueMarketJob,collectMarketJob};
