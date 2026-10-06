const {safeFetch}=require('./safe-fetch');
const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
function structuredVehicles(html){
  const rows=[];
  const walk=v=>{
    if(Array.isArray(v)){v.forEach(walk);return;}
    if(!v||typeof v!=='object')return;
    const types=[v['@type']].flat();
    if(types.some(t=>['Car','Vehicle','Product'].includes(t)))rows.push(v);
    if(v['@graph'])walk(v['@graph']);
    if(v.itemListElement)walk(v.itemListElement);
    if(v.item)walk(v.item);
  };
  for(const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{walk(JSON.parse(match[1]));}catch{}
  }
  return rows;
}
function corroborate(c,html){
  for(const v of structuredVehicles(html)){
    const offer=Array.isArray(v.offers)?v.offers[0]:v.offers||{};
    const seller=offer.seller||v.seller||{};
    const address=seller.address||offer.availableAtOrFrom?.address||{};
    const country=address.addressCountry?.name||address.addressCountry;
    const make=v.brand?.name||v.brand||v.manufacturer?.name;
    const mileage=v.mileageFromOdometer;
    const fields={
      make:norm(make)===norm(c.make)&&!!make,
      model:norm(v.model)===norm(c.model)&&!!v.model,
      trim:norm(v.vehicleConfiguration)===norm(c.trim)&&!!v.vehicleConfiguration,
      year:Number(String(v.vehicleModelDate||v.productionDate||'').slice(0,4))===Number(c.year),
      mileage_km:mileage?.value!=null&&Number(mileage.value)===Number(c.mileage_km)&&['KMT','km'].includes(mileage.unitCode||mileage.unitText),
      price:offer.price!=null&&Number(offer.price)===Number(c.price)&&offer.priceCurrency==='EUR',
      seller_type:['AutoDealer','AutomotiveBusiness','Organization'].includes(seller['@type']),
      country:['PT','Portugal'].includes(country),
      availability:/\/InStock$/.test(offer.availability||''),
      price_basis:offer.priceSpecification?.valueAddedTaxIncluded===true
    };
    if(Object.values(fields).every(Boolean))return {verified:true,fields,method:'listing_json_ld',url:c.url};
  }
  return {verified:false,method:'listing_json_ld',reason:'listing_fields_not_independently_confirmed',url:c.url};
}
async function verifyComparables(comparables,reader=safeFetch){
  // Four concurrent bounded requests; no browser session or access-control bypass.
  const result=[];
  for(let i=0;i<comparables.length;i+=4){
    result.push(...await Promise.all(comparables.slice(i,i+4).map(async c=>{
      const evidence={...c.evidence,verified:false,verification_method:'listing_json_ld'};
      if(!c.evidence?.source_url_verified)return {...c,evidence:{...evidence,verification_reason:'url_not_in_search_sources'}};
      try{
        const response=await reader(c.url,{timeout:4000,maxBytes:1500000,maxRedirects:2});
        const proof=response.ok?corroborate(c,await response.text()):{verified:false,reason:'listing_http_'+response.status};
        return {...c,evidence:{...evidence,...proof,observed_at:new Date().toISOString()}};
      }catch{return {...c,evidence:{...evidence,verification_reason:'listing_unavailable'}};}
    })));
  }
  return result;
}
module.exports={structuredVehicles,corroborate,verifyComparables};
