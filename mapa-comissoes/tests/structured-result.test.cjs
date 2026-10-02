const test=require("node:test");const assert=require("node:assert/strict");const {structuredResult}=require("../lib/structured-result");
test("completed structured output parses",()=>assert.deepEqual(structuredResult({status:"completed",output:[{type:"message",content:[{type:"output_text",text:'{"subject":{}}'}]}]}),{subject:{}}));
test("incomplete valid-looking output is rejected",()=>assert.throws(()=>structuredResult({status:"incomplete",output_text:'{"price":100}'}),/incompleta/));
test("malformed JSON has an actionable message",()=>assert.throws(()=>structuredResult({status:"completed",output_text:'{"price":100,}'}),/resposta inválida/));
test("refusals are not parsed as valuations",()=>assert.throws(()=>structuredResult({status:"completed",output:[{type:"message",content:[{type:"refusal",refusal:"no"}]}]}),/analisar/));
