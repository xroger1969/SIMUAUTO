// Layout-only browser regression: real HTML/CSS, scripts disabled, no account or network calls.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'../../comparador-auto-pro');
const out=process.env.LAYOUT_ARTIFACT_DIR||path.resolve('layout-artifacts');
fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(path.join(root,'index.html'),'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace('class="auth-gate" id="authGate"','class="auth-gate hidden" id="authGate"')
  .replace('class="app hidden" id="app"','class="app" id="app"');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
  if(!/^\/(?:[a-z-]+\.css|assets\/car-sunset\.webp)$/.test(pathname)){res.writeHead(404);res.end();return;}
  const filename=path.join(root,pathname.slice(1));
  if(!fs.existsSync(filename)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':pathname.endsWith('.css')?'text/css':'image/webp'});
  res.end(fs.readFileSync(filename));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const results=[];
  try{
    for(const [name,engine] of Object.entries({chromium,webkit})){
      const browser=await engine.launch({headless:true});
      try{
        for(const [width,height] of [[320,568],[375,667],[390,844],[402,874],[430,932],[560,800],[768,1024],[874,402],[1280,900]]){
          const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,isMobile:width<=560,hasTouch:width<=560});
          const page=await context.newPage();
          await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
          await page.goto(base,{waitUntil:'load'});
          for(const state of ['empty','progress','result']){
            await page.evaluate(state=>{
              document.getElementById('progressPanel').classList.toggle('hidden',state!=='progress');
              document.getElementById('result').classList.toggle('hidden',state!=='result');
            },state);
            const m=await page.evaluate(()=>{
              const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
              return {screen:innerWidth,scrollWidth:document.documentElement.scrollWidth,form:rect('#analyzeForm'),header:rect('.topbar'),shell:rect('.vehicle-input-shell'),mileage:rect('.mileage-input-group'),margin:rect('.mileage-input-group:nth-of-type(3)'),actions:rect('.search-actions'),analyze:rect('#analyzeBtn'),reset:rect('#startNewAnalysisBtn'),input:rect('#vehicleUrl'),tools:rect('.input-tools'),icon:rect('#micBtn'),font:parseFloat(getComputedStyle(document.getElementById('vehicleUrl')).fontSize)};
            });
            const label=name+' '+width+'x'+height+' '+state;
            assert.ok(Math.abs(m.form.x+m.form.width/2-width/2)<1,label+' form centre');
            for(const key of ['shell','mileage','margin','actions']){
              assert.ok(Math.abs(m[key].x-m.form.x)<1,label+' '+key+' left');
              assert.ok(Math.abs(m[key].width-m.form.width)<1,label+' '+key+' width');
            }
            assert.ok(m.input.right<=m.tools.x+1,label+' no input/icon overlap');
            assert.ok(m.tools.right<=m.shell.right,label+' tools inside input');
            assert.ok(m.icon.width>=44&&m.icon.height>=44,label+' touch targets');
            assert.ok(m.font>=16,label+' readable input font');
            if(width<=560){
              assert.ok(m.form.y-m.header.bottom<=60,label+' no large top spacer');
              for(const key of ['analyze','reset'])assert.ok(Math.abs(m[key].width-m.form.width)<1,label+' '+key+' width');
            }
            if(state==='empty')assert.ok(m.scrollWidth<=width+1,label+' no horizontal overflow');
            results.push({label,...m});
            if(state==='empty'&&[390,1280].includes(width))await page.screenshot({path:path.join(out,name+'-'+width+'.png'),fullPage:true});
          }
          await context.close();
        }
      }finally{await browser.close();}
    }
    fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify(results,null,2));
    console.log('PASS: '+results.length+' layout cases; Chromium and WebKit; nine viewport sizes; empty, progress and result states.');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
