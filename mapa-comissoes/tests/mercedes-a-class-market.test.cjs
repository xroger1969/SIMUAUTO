const test=require("node:test");
const assert=require("node:assert/strict");
const {sameModel,selectEligibleComparables}=require("../comparador-auto-pro/commercial-identity.js");

const observed=new Date().toISOString();
const subject={
  make:"Mercedes-Benz",
  model:"A 180 d W177",
  trim:null,
  generation:"W177",
  fuel:"diesel",
  year:2019,
  mileage_km:223000,
  power_cv:116,
  transmission:"automatic"
};

function ad(id,overrides={}){
  return {
    make:"Mercedes-Benz",
    model:"Classe A",
    trim:"180 d Progressive Aut.",
    generation:null,
    fuel:"diesel",
    year:2019,
    mileage_km:220000,
    power_cv:116,
    transmission:"automatic",
    price:20500,
    url:"https://dealer.example/mercedes/"+id,
    seller_type:"professional",
    country:"PT",
    availability:"available",
    price_basis:"gross",
    evidence:{verified:true,source_url_verified:true,observed_at:observed},
    ...overrides
  };
}

test("Mercedes A 180 d W177 e Classe A são a mesma família comercial",()=>{
  assert.equal(sameModel(subject,{make:"Mercedes-Benz",model:"Classe A"}),true);
  assert.equal(sameModel(subject,{make:"Mercedes-Benz",model:"A180d"}),true);
  assert.equal(sameModel(subject,{make:"Mercedes-Benz",model:"Classe A 180 d"}),true);
});

test("normalização Mercedes não mistura Classe A com CLA, GLA ou Classe B",()=>{
  assert.equal(sameModel(subject,{make:"Mercedes-Benz",model:"CLA 180 d"}),false);
  assert.equal(sameModel(subject,{make:"Mercedes-Benz",model:"GLA 180 d"}),false);
  assert.equal(sameModel(subject,{make:"Mercedes-Benz",model:"Classe B"}),false);
});

test("A 180 d 2019 com 223 mil km aceita comparáveis reais da Classe A",()=>{
  const selected=selectEligibleComparables(subject,[
    ad("classe-a"),
    ad("a180d",{model:"A180d",trim:"Style Aut.",mileage_km:226000,price:19999}),
    ad("cla",{model:"CLA 180 d",trim:"Progressive",mileage_km:220000,price:18900}),
    ad("b",{model:"Classe B",trim:"180 d",mileage_km:97000,price:23999})
  ]);
  assert.equal(selected.rows.length,2);
  assert.ok(selected.rows.every(row=>row.similarity>=50));
  assert.ok(selected.excluded.some(row=>row.reason==="modelo diferente ou desconhecido"&&/cla|classe b/i.test(row.comp.model)));
});
