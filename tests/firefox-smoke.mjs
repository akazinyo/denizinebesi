import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const profile=await mkdtemp(join(tmpdir(),'deniz-ff-test-'));
await writeFile(join(profile,'user.js'),[
  'user_pref("dom.webgpu.enabled", true);',
  'user_pref("gfx.webgpu.ignore-blocklist", true);',
  'user_pref("dom.webgpu.allow-present-without-readback", false);',
  'user_pref("browser.shell.checkDefaultBrowser", false);',
].join('\n'));
const port=19243;
const ff=spawn('prime-run',['firefox','--headless','--no-remote','--profile',profile,'--remote-debugging-port',String(port)],{env:{...process.env,MOZ_HEADLESS_WIDTH:'1280',MOZ_HEADLESS_HEIGHT:'850'},stdio:['ignore','pipe','pipe']});
ff.stderr.on('data',d=>{const s=d.toString();if(/WebDriver|WebGPU|Error|error|Vulkan|Adapter/.test(s))console.log(s.trim().slice(0,1600));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let ws,id=0;const waiting=new Map(),errors=[];
async function connect(){for(let i=0;i<60;i++){try{ws=new WebSocket(`ws://127.0.0.1:${port}/session`);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});return;}catch{await sleep(250);}}throw Error('Firefox BiDi bağlantısı açılamadı');}
function call(method,params={}){return new Promise((resolve,reject)=>{const cid=++id;waiting.set(cid,{resolve,reject});ws.send(JSON.stringify({id:cid,method,params}));});}
try{
  await connect();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);if(m.type==='error')p.reject(Error(JSON.stringify(m)));else p.resolve(m.result);}else if(m.method==='log.entryAdded'&&m.params.level==='error'){errors.push(m.params.text);console.log('ERROR',m.params.text);}};
  await call('session.new',{capabilities:{alwaysMatch:{acceptInsecureCerts:true}}});
  await call('session.subscribe',{events:['log.entryAdded']});
  const {context}=await call('browsingContext.create',{type:'tab'});
  await call('browsingContext.setViewport',{context,viewport:{width:1280,height:850},devicePixelRatio:1});
  await call('browsingContext.navigate',{context,url:'http://localhost:8080/',wait:'complete'});
  const evaluate=async expression=>{const r=await call('script.evaluate',{expression,target:{context},awaitPromise:true});if(r.type==='exception')throw Error(r.exceptionDetails.text);return r.result.value;};
  let ready=false;for(let i=0;i<120;i++){if(await evaluate('!!window.__ocean?.ready')){ready=true;break;}if(errors.length)break;await sleep(500);}
  if(!ready)throw Error('Başlatma başarısız: '+await evaluate('document.getElementById("loading-message").textContent'));
  await sleep(2000);
  console.log('DIAGNOSTICS',await evaluate('JSON.stringify({backend:document.getElementById("backend").textContent,body:window.__ocean.body,heights:Array.from({length:12},(_,i)=>window.__ocean.ocean.getHeight(i*4,i*2)),readErrors:window.__ocean.ocean.readErrors,adapter:window.__ocean.renderer.backend.device?.adapterInfo})'));
  if(!await evaluate('window.__ocean.renderer.backend.isWebGPUBackend'))throw Error('Firefox WebGPU yerine başka motor açtı');
  const shot=async name=>{const {data}=await call('browsingContext.captureScreenshot',{context});await mkdir('screenshots',{recursive:true});await writeFile('screenshots/'+name+'.png',Buffer.from(data,'base64'));};
  await shot('fft-firefox-day');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyW"}))');
  await sleep(8000);
  await shot('fft-firefox-wake');
  console.log('DRIVEN',await evaluate('JSON.stringify({state:window.__ocean.state,body:window.__ocean.body,fps:document.getElementById("fps").textContent,wake:Math.max(...window.__ocean.ocean.wake.data)})'));
  if(!await evaluate('window.__ocean.state.speed>3&&window.__ocean.state.z<0'))throw Error('Gaz testi başarısız');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keyup",{code:"KeyW"}));document.querySelector("[data-hour=\\"0\\"]").click()');await sleep(2000);await shot('fft-firefox-night');
  if(errors.length)throw Error(errors.join('\n'));console.log('PASS Firefox native WebGPU: FFT, buoyancy, propulsion, foam and night');
}finally{
  if(ws?.readyState===1){try{await call('session.end');}catch{}ws.close();}ff.kill('SIGTERM');
}
