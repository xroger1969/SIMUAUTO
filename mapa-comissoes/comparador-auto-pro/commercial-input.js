// Explicit monetary instructions only. Ambiguous vehicle messages continue to identification.
const amount=v=>{
  const raw=String(v).replace(/\s/g,'').replace(/€/g,'');
  if(/^\d{1,3}(?:[.]\d{3})+(?:,\d{1,2})?$/.test(raw))return Number(raw.replace(/\./g,'').replace(',','.'));
  return Number(raw.replace(',','.'));
};
export function commercialInstruction(text){
  const t=String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[?!.]$/,'');
  const money='([0-9][0-9 .]*(?:,[0-9]{1,2})?)';
  const margin=t.match(new RegExp('^(?:quero|pretendo) (?:ganhar|uma margem de)(?: pelo menos)? '+money+'\\s*(?:euros?|€)?$'));
  if(margin){const value=amount(margin[1]);return Number.isFinite(value)&&value>=0?{type:'target_margin',value}:null;}
  const price=t.match(new RegExp('^(?:e se (?:conseguir )?comprar por|consegui comprar por|preco de compra[: ]+) '+money+'\\s*(?:euros?|€)?$'));
  if(price){const value=amount(price[1]);return Number.isFinite(value)&&value>0?{type:'purchase_price',value}:null;}
  return null;
}
