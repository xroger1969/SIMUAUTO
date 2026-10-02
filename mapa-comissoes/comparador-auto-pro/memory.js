const norm=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
export function relevantMemories(rules,vehicle){
  return (rules||[]).filter(rule=>{
    if(!rule.statement||rule.active===false)return false;
    if(rule.valid_until&&(!Number.isFinite(Date.parse(rule.valid_until))||Date.parse(rule.valid_until)<=Date.now()))return false;
    const scope=rule.scope||{};
    for(const key of ["make","model","trim"]){if(scope[key]&&norm(scope[key])!==norm(vehicle?.[key]))return false}
    for(const [field,min,max] of [["year","year_min","year_max"],["mileage_km","mileage_min","mileage_max"]]){
      if(scope[min]!=null||scope[max]!=null){
        const value=vehicle?.[field];if(value==null||!Number.isFinite(Number(value)))return false;
        if(scope[min]!=null&&Number(value)<Number(scope[min]))return false;
        if(scope[max]!=null&&Number(value)>Number(scope[max]))return false;
      }
    }
    return true;
  }).slice(0,12);
}
