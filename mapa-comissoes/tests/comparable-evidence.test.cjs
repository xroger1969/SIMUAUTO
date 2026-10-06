const test=require('node:test');
const assert=require('node:assert/strict');
const {corroborate,verifyComparables}=require('../lib/comparable-evidence');
const c={make:'Tesla',model:'Model 3',trim:'Long Range',year:2021,mileage_km:82000,price:25000,url:'https://dealer.example/1',evidence:{source_url_verified:true}};
const v={'@type':'Car',brand:{name:'Tesla'},model:'Model 3',vehicleConfiguration:'Long Range',vehicleModelDate:'2021',mileageFromOdometer:{value:82000,unitCode:'KMT'},offers:{price:25000,priceCurrency:'EUR',availability:'https://schema.org/InStock',priceSpecification:{valueAddedTaxIncluded:true},seller:{'@type':'AutoDealer',address:{addressCountry:'PT'}}}};
const html=x=>'<script type="application/ld+json">'+JSON.stringify(x)+'</script>';
test('URL returned by search alone does not verify listing facts',async()=>{
 const [r]=await verifyComparables([c],async()=>({ok:true,text:async()=>'<p>Car for sale</p>'}));assert.equal(r.evidence.verified,false);
});
test('independent structured fields corroborate a complete comparable',()=>assert.equal(corroborate(c,html(v)).verified,true));
test('wrong price version and mileage cannot be corroborated',()=>{
 for(const patch of [{price:20000},{trim:'Performance'},{mileage_km:1000}])assert.equal(corroborate({...c,...patch},html(v)).verified,false);
});
test('blocked source is explicitly unverified',async()=>{
 const [r]=await verifyComparables([c],async()=>{throw Error('403');});assert.equal(r.evidence.verified,false);assert.equal(r.evidence.verification_reason,'listing_unavailable');
});
