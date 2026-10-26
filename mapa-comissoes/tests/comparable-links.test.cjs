const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const identity=require('../comparador-auto-pro/commercial-identity');
const {finalizeMarketResponse,searchSources}=require('../api/comparador-market')._test;
const subject={make:'Tesla',model:'Model 3',trim:'Standard Range',year:2026,mileage_km:8999,fuel:'electric',power_cv:283,transmission:'Automática'};
const listing=(url,patch={})=>({...subject,url,price:39990,seller_name:'Bruno Car',seller_type:'professional',country:'PT',price_basis:'gross',availability:'available',...patch});
const paths=[
  '/carros/usados/tesla-model-3-60-kwh-standard-range-eletrico/wlQmp',
  '/carros/usados/tesla-model-3-eletrico/j02DY',
  '/carros/usados/tesla-model-3-eletrico/k02ed'
];

test('the three reported Tesla links retain their exact PiscaPisca listing paths',async()=>{
  for(const pathname of paths){
    const url='https://www.piscapisca.pt'+pathname;
    const data={status:'completed',output_text:JSON.stringify({subject,comparables:[listing(url)]}),
      output:[{type:'web_search_call',action:{sources:[{url,title:'Tesla Model 3'}]}}]};
    const result=await finalizeMarketResponse(data);
    assert.equal(result.comparables[0].url,url);
    assert.equal(result.comparables[0].evidence.source_url_verified,true);
    assert.equal(result.search_sources[0].url,url);
    const selected=identity.selectEligibleComparables(result.subject,result.comparables);
    assert.equal(selected.rows.length,1);
    assert.equal(selected.rows[0].comp.url,url);
  }
});

test('cached PiscaPisca URLs are repaired while duplicate keys still merge www variants',()=>{
  const old='https://piscapisca.pt'+paths[0];
  const current='https://www.piscapisca.pt'+paths[0];
  const selected=identity.selectEligibleComparables(subject,[listing(old),listing(current,{seller_name:'Other'})]);
  assert.equal(selected.rows.length,1);
  assert.equal(selected.rows[0].comp.url,current);
  assert.match(selected.excluded[0].reason,/duplicado/);
  const own=identity.selectEligibleComparables(subject,[listing(current)],{source_url:old});
  assert.equal(own.rows.length,0);
  assert.equal(own.excluded[0].reason,'própria viatura');
});

test('navigation keeps hosts, path case, trailing slash, queries and hash intact',()=>{
  const url='https://www.stand.example/Viaturas/AbC/?ref=car42&source=stock&utm_source=search#details';
  assert.equal(identity.listingUrl(url),url);
  assert.notEqual(identity.canonicalUrl(url),url);
  const selected=identity.selectEligibleComparables(subject,[listing(url)]);
  assert.equal(selected.rows[0].comp.url,url);
  assert.equal(searchSources({output:[{url} ]})[0].url,url);
  assert.equal(identity.listingUrl('https://piscapisca.pt.attacker.example/car'),'https://piscapisca.pt.attacker.example/car');
  assert.equal(identity.listingUrl('https://stock.piscapisca.pt/car'),'https://stock.piscapisca.pt/car');
  for(const raw of ['javascript:alert(1)','data:text/html,hello','//example.com/car','https://user:pass@example.com/car',null]){
    assert.equal(identity.listingUrl(raw),null);
  }
});

test('broadened comparison keeps the navigable URL and removes the original insufficient-similarity exclusion',()=>{
  const url='https://www.piscapisca.pt'+paths[0];
  const comparable=listing(url,{trim:null,year:2023,power_cv:null,transmission:null,mileage_km:null});
  const result=identity.selectEligibleComparables(subject,[comparable],{minSimilarity:100});
  assert.ok(result.searchTier>1);
  assert.equal(result.rows[0].comp.url,url);
  assert.equal(result.excluded.length,0);
});

test('rendering an old saved assessment repairs its link without modifying the snapshot',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../comparador-auto-pro/app-v2.js'),'utf8');
  const source=app.slice(app.indexOf('function comparableElement'),app.indexOf('function renderComparables'));
  const ctx={CommercialIdentity:identity,esc:String,fmt:String,originLabel:()=>'',sellerLabel:()=>'',
    document:{createElement:tag=>({tag,firstElementChild:{children:[],appendChild(x){this.children.push(x);}}})}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  for(const pathname of paths){
    const saved=listing('https://piscapisca.pt'+pathname),before=JSON.stringify(saved);
    const el=ctx.comparableElement(saved),link=el.firstElementChild.children[0];
    assert.equal(link.href,'https://www.piscapisca.pt'+pathname);
    assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
    assert.equal(JSON.stringify(saved),before);
  }
  assert.equal(ctx.comparableElement(listing('javascript:alert(1)')).firstElementChild.children.length,0);
});
