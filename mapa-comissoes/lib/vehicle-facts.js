const meaningful=v=>v!==null&&v!==undefined&&v!==''&&v!=='unknown'&&(!Array.isArray(v)||v.length>0);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function mergeFacts(previous={},incoming={},registration=null,reported=[]){
  const subject={...previous},facts={...(previous.field_evidence||{})},conflicts=[];
  const descriptions=new Map(reported.map(f=>[f.field,f]));
  for(const [key,value] of Object.entries(incoming)){
    if(key==='field_evidence')continue;
    if(!meaningful(value)){if(!(key in subject))subject[key]=value;continue;}
    const report=descriptions.get(key);
    const old=facts[key];
    const next={value,source:report?.source||'ai_interpretation',status:report?.status==='confirmed'?'inferred':report?.status||'inferred',evidence:report?.evidence||'',confidence:report?.confidence||'low'};
    // User corrections are explicit facts; model interpretations cannot replace them silently.
    if(report?.source==='user'&&report?.status==='confirmed')next.status='confirmed';
    if(meaningful(subject[key])&&!equal(subject[key],value)){
      conflicts.push({field:key,previous:subject[key],incoming:value,source:next.source});
      if(old?.status==='confirmed'&&next.status!=='confirmed')continue;
    }
    subject[key]=value;facts[key]=next;
  }
  if(registration){
    for(const [key,value] of Object.entries(registration)){
      if(!['registration','make','model','trim','year','first_registration','fuel','engine_cc','power_cv','transmission','body_type'].includes(key)||!meaningful(value))continue;
      if(meaningful(subject[key])&&!equal(subject[key],value)){
        conflicts.push({field:key,previous:subject[key],incoming:value,source:'plate_provider'});continue;
      }
      subject[key]=value;facts[key]={value,source:'plate_provider',status:'confirmed',confidence:'high',evidence:registration.provider||'registration'};
    }
  }
  subject.field_evidence=facts;
  return {subject,conflicts};
}
module.exports={mergeFacts};
