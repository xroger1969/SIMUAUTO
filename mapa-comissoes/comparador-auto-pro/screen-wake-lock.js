/** Keep the foreground application awake when the platform allows it. */
export function createScreenWakeLock({
  wakeLock=globalThis.navigator?.wakeLock,
  doc=globalThis.document,
  win=globalThis,
  now=()=>Date.now(),
  retryMs=12000,
  onStatus=()=>{},
}={}){
  let enabled=false,sentinel=null,pending=null,epoch=0,lastAttempt=-Infinity,status='disabled';
  const supported=typeof wakeLock?.request==='function';
  const visible=()=>doc?.visibilityState?doc.visibilityState==='visible':doc?.hidden!==true;
  function emit(next,reason=''){status=next;onStatus({status,enabled,supported,reason});}
  function releaseHeld(){
    const held=sentinel;sentinel=null;
    if(!held)return;
    try{Promise.resolve(held.release()).catch(()=>{});}catch{}
  }
  async function ensure({force=false}={}){
    if(!enabled){emit('disabled');return false;}
    if(!visible()){emit('inactive');return false;}
    if(!supported){emit('unsupported');return false;}
    if(sentinel&&!sentinel.released){emit('active');return true;}
    if(pending?.epoch===epoch)return pending.promise;
    if(!force&&now()-lastAttempt<retryMs)return false;
    lastAttempt=now();
    const version=epoch,request={epoch:version,promise:null};
    emit('pending');
    request.promise=(async()=>{
      try{
        const held=await wakeLock.request('screen');
        if(!enabled||version!==epoch||!visible()){
          try{await held.release();}catch{}
          return false;
        }
        sentinel=held;
        held.addEventListener?.('release',()=>{
          if(sentinel!==held)return;
          sentinel=null;
          if(enabled&&visible())emit('released');
        });
        emit('active');return true;
      }catch(error){
        if(enabled&&version===epoch&&visible())emit('blocked',String(error?.name||'NotAllowedError'));
        return false;
      }finally{if(pending===request)pending=null;}
    })();
    pending=request;
    return request.promise;
  }
  function setEnabled(value){
    const next=!!value;
    if(next===enabled){if(next)void ensure({force:true});return;}
    enabled=next;epoch++;
    if(!enabled){releaseHeld();emit('disabled');return;}
    lastAttempt=-Infinity;
    void ensure({force:true});
  }
  function onVisibility(){
    if(!visible()){epoch++;releaseHeld();emit(enabled?'inactive':'disabled');}
    else if(enabled)void ensure({force:true});
  }
  function onFocus(){if(enabled&&visible())void ensure();}
  doc?.addEventListener?.('visibilitychange',onVisibility);
  win?.addEventListener?.('pageshow',onFocus);
  win?.addEventListener?.('focus',onFocus);
  return {
    ensure,setEnabled,get enabled(){return enabled},get status(){return status},
    get supported(){return supported},
    destroy(){
      enabled=false;epoch++;releaseHeld();emit('disabled');
      doc?.removeEventListener?.('visibilitychange',onVisibility);
      win?.removeEventListener?.('pageshow',onFocus);
      win?.removeEventListener?.('focus',onFocus);
    }
  };
}
