const test=require("node:test");
const assert=require("node:assert/strict");
const {
  sameModel,modelFamilyKey,modelMatchLevel,selectEligibleComparables
}=require("../comparador-auto-pro/commercial-identity.js");

const pairs=[
  ["Hyundai","Kona 1.6 Hybrid Prime","Kona"],
  ["Nissan","Qashqai J11 1.5 dCi","Qashqai"],
  ["Peugeot","3008 1.5 BlueHDi","3008"],
  ["Volkswagen","Golf VII 2.0 TDI","Golf"],
  ["Ford","Focus Mk4 1.5 EcoBlue","Focus"],
  ["Audi","A3 Sportback 35 TDI","A3"],
  ["Volvo","XC40 B4 Mild Hybrid","XC40"],
  ["Mazda","CX-5 2.2 Skyactiv-D","CX 5"],
  ["BMW","320d Touring G21","Série 3 Touring"],
  ["Land Rover","Range Rover Evoque D180","Range Rover Evoque"],
  ["Mercedes-Benz","A 180 d W177","Classe A 180 d"]
];

test("formatos comuns de portal, matrícula e fotografia resolvem a mesma família",()=>{
  for(const [make,a,b] of pairs){
    assert.equal(sameModel({make,model:a},{make,model:b}),true,make+" | "+a+" | "+b);
    assert.equal(modelFamilyKey(make,a),modelFamilyKey(make,b),make+" family");
  }
});

test("família aproximada não é confundida com correspondência textual exata",()=>{
  assert.equal(modelMatchLevel({make:"Nissan",model:"Qashqai J11 1.5 dCi"},{make:"Nissan",model:"Qashqai"}),1);
  assert.equal(modelMatchLevel({make:"Mercedes-Benz",model:"A180d"},{make:"Mercedes-Benz",model:"Classe A"}),2);
});

test("resolvedor mantém famílias diferentes separadas",()=>{
  const different=[
    ["Mercedes-Benz","A 180 d","CLA 180 d"],
    ["Mercedes-Benz","A 180 d","GLA 180 d"],
    ["Audi","A3 35 TDI","Q3 35 TDI"],
    ["Peugeot","2008 1.5 BlueHDi","3008 1.5 BlueHDi"],
    ["Nissan","Qashqai","Juke"],
    ["Volkswagen","Golf","Polo"],
    ["Hyundai","Kona","Tucson"],
    ["Volvo","XC40","XC60"],
    ["BMW","320d Touring","320d Coupé"]
  ];
  for(const [make,a,b] of different){
    assert.equal(sameModel({make,model:a},{make,model:b}),false,make+" | "+a+" != "+b);
  }
});

test("comparável da mesma família pode avançar sem desbloquear modelos errados",()=>{
  const subject={make:"Nissan",model:"Qashqai J11 1.5 dCi",fuel:"diesel",year:2019,mileage_km:180000,power_cv:115,transmission:"manual"};
  const common={seller_type:"professional",country:"PT",availability:"available",price_basis:"gross",evidence:{verified:true,source_url_verified:true}};
  const selected=selectEligibleComparables(subject,[
    {...common,make:"Nissan",model:"Qashqai",trim:"1.5 dCi N-Connecta",fuel:"diesel",year:2019,mileage_km:170000,power_cv:115,transmission:"manual",price:17900,url:"https://stand.example/qashqai/1"},
    {...common,make:"Nissan",model:"Juke",trim:"1.5 dCi",fuel:"diesel",year:2019,mileage_km:170000,power_cv:110,transmission:"manual",price:15900,url:"https://stand.example/juke/1"}
  ]);
  assert.equal(selected.rows.length,1);
  assert.match(selected.rows[0].comp.model,/Qashqai/i);
  assert.ok(selected.excluded.some(x=>x.reason==="modelo diferente ou desconhecido"&&/Juke/i.test(x.comp.model)));
});
