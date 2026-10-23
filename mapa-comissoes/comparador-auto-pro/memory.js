const norm=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g," ");
const fuel=v=>({gasoleo:"diesel",gasolina:"petrol",eletrico:"electric",electrico:"electric",hibrido:"hybrid",
  "hibrido plug in":"phev","plug in hybrid":"phev","gasolina plug in":"phev","gasolina plugin":"phev",
  "hibrido plug in gasolina":"phev","gasolina hibrido plug in":"phev"}[norm(v).replace(/[-_]+/g," ")]||norm(v));
const identity=vehicle=>globalThis.CommercialIdentity?.normalizeVehicleIdentity?.(vehicle)||vehicle||{};
export function relevantMemories(rules,vehicle){
  const subject=identity(vehicle);
  return (rules||[]).filter(rule=>{
    if(!rule.statement||rule.active===false||rule.effect?.mode==="supervised")return false;
    if(rule.valid_until&&(!Number.isFinite(Date.parse(rule.valid_until))||Date.parse(rule.valid_until)<=Date.now()))return false;
    const scope=identity(rule.scope||{});
    for(const key of ["make","model","trim"]){if(scope[key]&&norm(scope[key])!==norm(subject?.[key]))return false}
    if(scope.fuel&&fuel(scope.fuel)!==fuel(subject?.fuel))return false;
    for(const [field,min,max] of [["year","year_min","year_max"],["mileage_km","mileage_min","mileage_max"]]){
      if(scope[min]!=null||scope[max]!=null){
        const value=subject?.[field];if(value==null||!Number.isFinite(Number(value)))return false;
        if(scope[min]!=null&&Number(value)<Number(scope[min]))return false;
        if(scope[max]!=null&&Number(value)>Number(scope[max]))return false;
      }
    }
    return true;
  }).slice(0,12);
}

