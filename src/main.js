import './style.css';
import * as T from 'three/webgpu';
import { pass } from 'three/tsl';
import { Ocean } from './ocean.js';
import { Spray } from './spray.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { createVessel } from './vessel.js';
import { initialState, stepBoat, compassHeading, initialBuoyancy, stepBuoyancy } from './physics.js';

const $=id=>document.getElementById(id);
const state=initialState();
const body=initialBuoyancy();
const settings={hour:16,waves:1.15,cycle:false,camera:0,ship:false,quality:'medium'};
const keys=new Set();
const scene=new T.Scene();
const camera=new T.PerspectiveCamera(53,innerWidth/innerHeight,.15,22000);
camera.position.set(17,9.5,24);
const renderer=new T.WebGPURenderer({antialias:true,alpha:false,powerPreference:'high-performance',forceWebGL:new URLSearchParams(location.search).has('compat')});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.5;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
$('scene').appendChild(renderer.domElement);
scene.fog=new T.FogExp2(0x97b4be,.0001);

const sky=new SkyMesh();sky.scale.setScalar(10000);sky.material.fog=false;sky.turbidity.value=3;sky.rayleigh.value=2.5;
sky.mieCoefficient.value=.005;sky.mieDirectionalG.value=.85;sky.cloudCoverage.value=.33;sky.cloudDensity.value=.35;scene.add(sky);
const sun=new T.DirectionalLight(0xffe1b5,3);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-28,right:28,top:28,bottom:-28,near:1,far:180});sun.shadow.bias=-.0003;sun.shadow.normalBias=.08;scene.add(sun,sun.target);
const ambient=new T.HemisphereLight(0xb8d8ec,0x24464c,1.5);scene.add(ambient);
const envCanvas=document.createElement('canvas');envCanvas.width=128;envCanvas.height=64;
const ec=envCanvas.getContext('2d'),eg=ec.createLinearGradient(0,0,0,64);eg.addColorStop(0,'#adcbe5');eg.addColorStop(.48,'#ece3cc');eg.addColorStop(.53,'#547b85');eg.addColorStop(1,'#102732');ec.fillStyle=eg;ec.fillRect(0,0,128,64);
const environment=new T.CanvasTexture(envCanvas);environment.mapping=T.EquirectangularReflectionMapping;environment.colorSpace=T.SRGBColorSpace;scene.environment=environment;
const moonDirection=new T.Vector3(-.45,.22,-.82).normalize();
const moon=new T.Mesh(new T.SphereGeometry(43,24,16),new T.MeshBasicMaterial({color:0xdfeaff,fog:false}));scene.add(moon);
const starGeo=new T.BufferGeometry(),starPositions=[];
let seed=71;function random(){seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;}
for(let i=0;i<1800;i++){const az=random()*Math.PI*2,alt=random()*1.45+.06,r=8500;starPositions.push(Math.cos(az)*Math.cos(alt)*r,Math.sin(alt)*r,Math.sin(az)*Math.cos(alt)*r);}
starGeo.setAttribute('position',new T.Float32BufferAttribute(starPositions,3));
const stars=new T.Points(starGeo,new T.PointsMaterial({color:0xd7e6ff,size:9,sizeAttenuation:true,transparent:true,opacity:0,depthWrite:false,fog:false}));scene.add(stars);

const ocean=new Ocean(renderer);scene.add(ocean.root);
const getHeight=(x,z)=>ocean.getHeight(x,z);

const boat=createVessel(),ship=createVessel(true);scene.add(boat,ship);ship.visible=false;
let activeVessel=boat;
const buoys=[];
for(let i=0;i<10;i++){
  const group=new T.Group(),angle=i*2.4;
  group.position.set(Math.sin(angle)*(180+i*100),0,-190-i*170);
  const buoyMat=new T.MeshStandardMaterial({color:i%2?0x2b796e:0xb85030,roughness:.55});
  const base=new T.Mesh(new T.CylinderGeometry(.7,1.1,.8,12),buoyMat);base.position.y=.4;group.add(base);
  const pole=new T.Mesh(new T.CylinderGeometry(.09,.14,3,8),buoyMat);pole.position.y=2;group.add(pole);
  const cap=new T.Mesh(new T.ConeGeometry(.45,.6,8),buoyMat);cap.position.y=3.3;group.add(cap);
  const bulb=new T.Mesh(new T.SphereGeometry(.12,8,6),new T.MeshStandardMaterial({color:0xffd78e,emissive:0xffd78e,emissiveIntensity:3}));bulb.position.y=3.65;group.add(bulb);group.traverse(o=>{if(o.isMesh)o.castShadow=true;});scene.add(group);buoys.push(group);
}
// Distant rocky silhouettes give the open sea a sense of scale.
const islands=new T.Group();scene.add(islands);
const rock=new T.MeshStandardMaterial({color:0x3d5050,roughness:1});
for(let i=0;i<18;i++){
  const m=new T.Mesh(new T.IcosahedronGeometry(1,2),rock);m.position.set(-3100+i*100,-65,-4300+Math.sin(i*1.7)*230);m.scale.set(120+random()*170,70+random()*105,220+random()*170);m.rotation.y=random()*5;islands.add(m);
}
const spray=new Spray(scene);
let cameraSeaY=0;

let pipeline,simTime=0,lastTime=0,frameCounter=0,fpsTime=0,lightingTimer=1,hudTimer=0;
let azimuth=.52,elevation=.25,cameraDistance=24,dragging=false,pointerX=0,pointerY=0;
const cameraTarget=new T.Vector3(),desiredCamera=new T.Vector3(),up=new T.Vector3(0,1,0);
let audioContext,engineOsc,engineGain,seaGain,audioOn=false;
function toggleSound(){
  if(!audioContext){audioContext=new AudioContext();const length=audioContext.sampleRate*3,buffer=audioContext.createBuffer(1,length,audioContext.sampleRate),data=buffer.getChannelData(0);let sample=0;for(let i=0;i<length;i++){sample=(sample+Math.random()*.04-.02)*.98;data[i]=sample;}
    const noise=audioContext.createBufferSource();noise.buffer=buffer;noise.loop=true;const filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.value=750;seaGain=audioContext.createGain();noise.connect(filter).connect(seaGain).connect(audioContext.destination);noise.start();
    engineOsc=audioContext.createOscillator();engineOsc.type='sawtooth';engineGain=audioContext.createGain();const ef=audioContext.createBiquadFilter();ef.type='lowpass';ef.frequency.value=180;engineOsc.connect(ef).connect(engineGain).connect(audioContext.destination);engineOsc.start();}
  audioOn=!audioOn;audioContext.resume();$('sound').textContent=`Ses: ${audioOn?'Açık':'Kapalı'}`;$('sound').setAttribute('aria-pressed',audioOn);
}
function notify(message){$('toast').textContent=message;$('toast').style.opacity=1;clearTimeout(notify.timeout);notify.timeout=setTimeout(()=>$('toast').style.opacity=0,5500);}
function setCamera(){settings.camera=(settings.camera+1)%3;$('camera').textContent=`Kamera: ${['Takip','Kaptan','Yörünge'][settings.camera]}`;notify(['Takip kamerası · Fareyle etrafına bak.','Kaptan köşkü · Ufka doğru.','Yörünge kamerası · Fareyle sürükle, tekerlekle yaklaş.'][settings.camera]);}
function updateLighting(){
  const angle=(settings.hour-6)/24*Math.PI*2;
  const sunDir=new T.Vector3(-.38,Math.sin(angle),-Math.abs(Math.cos(angle))*.88).normalize();
  const daylight=T.MathUtils.smoothstep(sunDir.y,-.09,.13),sunset=1-T.MathUtils.smoothstep(sunDir.y,.05,.55);
  sky.sunPosition.value.copy(sunDir);sky.visible=daylight>.015;
  scene.background=new T.Color(0x071222);scene.fog.color.set(0x071222).lerp(new T.Color(0x8babb5),daylight);scene.fog.density=.00010+settings.waves*.000035;
  const lightDir=daylight>.12?sunDir:moonDirection;
  sun.position.set(state.x+lightDir.x*80,Math.max(12,lightDir.y*80),state.z+lightDir.z*80);sun.target.position.set(state.x,0,state.z);
  sun.color.set(0xc7dcff).lerp(new T.Color(0xfff4dd).lerp(new T.Color(0xffb36e),sunset*.68),daylight);sun.intensity=.65+daylight*3.4;
  ambient.intensity=.22+daylight*1.1;ambient.color.set(0x8daecc).lerp(new T.Color(0xc7e8f8),daylight);
  scene.environmentIntensity=.12+daylight*.7;
  renderer.toneMappingExposure=.65-daylight*.28;
  ocean.sunDirection.value.copy(lightDir);ocean.daylight.value=daylight;
  stars.material.opacity=1-daylight;stars.visible=daylight<.98;moon.visible=daylight<.8;moon.position.copy(moonDirection).multiplyScalar(6500).add(new T.Vector3(state.x,0,state.z));
  for(const v of [boat,ship]){v.userData.cabinLight.intensity=(1-daylight)*35;v.userData.headlight.intensity=(1-daylight)*90;}

  const h=Math.floor(settings.hour),m=Math.floor(settings.hour%1*60);$('time-label').textContent=`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
function drawRadar(){
  const ctx=$('radar').getContext('2d'),w=220,c=110,r=91;ctx.clearRect(0,0,w,w);ctx.fillStyle='#071d2855';ctx.beginPath();ctx.arc(c,c,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#b3d6cb33';ctx.lineWidth=1;
  for(const radius of [30,60,91]){ctx.beginPath();ctx.arc(c,c,radius,0,Math.PI*2);ctx.stroke();}ctx.beginPath();ctx.moveTo(19,c);ctx.lineTo(201,c);ctx.moveTo(c,19);ctx.lineTo(c,201);ctx.stroke();ctx.fillStyle='#d5e6dd';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillText('N',c,12);
  for(const buoy of buoys){const x=(buoy.position.x-state.x)/500*r,z=(buoy.position.z-state.z)/500*r;if(x*x+z*z<r*r){ctx.fillStyle='#ebc280';ctx.beginPath();ctx.arc(c+x,c+z,2.5,0,Math.PI*2);ctx.fill();}}
  ctx.save();ctx.translate(c,c);ctx.rotate(-state.heading);ctx.fillStyle='#e6d6b4';ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(5,6);ctx.lineTo(0,3);ctx.lineTo(-5,6);ctx.closePath();ctx.fill();ctx.restore();
}
function updateHUD(){const heading=compassHeading(state.heading);$('speed').textContent=(Math.abs(state.speed)*1.94384).toFixed(1);$('heading').textContent=String(Math.round(heading)%360).padStart(3,'0')+'°';$('direction').textContent=['KUZEY','KUZEYDOĞU','DOĞU','GÜNEYDOĞU','GÜNEY','GÜNEYBATI','BATI','KUZEYBATI'][Math.round(heading/45)%8];$('distance').textContent=(state.distance/1852).toFixed(2);$('gear').textContent=state.speed<-.3?'GERİ':state.throttle>.1?'İLERİ':'BOŞTA';$('throttle-bar').style.height=Math.abs(state.throttle)*100+'%';drawRadar();}

function animate(now){
  const realDt=(now-lastTime)/1000||.016,dt=Math.min(realDt,.12);lastTime=now;
  const controls={forward:keys.has('KeyW')||keys.has('ArrowUp'),reverse:keys.has('KeyS')||keys.has('ArrowDown'),left:keys.has('KeyA')||keys.has('ArrowLeft'),right:keys.has('KeyD')||keys.has('ArrowRight'),brake:keys.has('Space')};
  const steps=Math.ceil(dt/(1/120)),subDt=dt/steps;let impact=0;
  ocean.strength.value=settings.waves;
  for(let i=0;i<steps;i++){
    simTime+=subDt;ocean.time.value=simTime+24;
    stepBoat(state,controls,subDt,settings.ship);
    stepBuoyancy(body,state,getHeight,subDt,settings.ship);impact=Math.max(impact,body.impact);
  }
  body.impact=impact;
  activeVessel.position.set(state.x,body.y,state.z);activeVessel.rotation.order='YXZ';activeVessel.rotation.set(body.pitch,state.heading,body.roll);
  ocean.update(simTime,dt,state,body,settings.ship);
  sky.position.set(state.x,0,state.z);stars.position.set(state.x,0,state.z);
  for(let i=0;i<buoys.length;i++){const b=buoys[i];b.position.y=getHeight(b.position.x,b.position.z);b.rotation.z=Math.sin(simTime*1.2+i)*.08*settings.waves;}
  spray.update(state,body,dt,settings.ship,camera,getHeight);
  cameraSeaY=T.MathUtils.damp(cameraSeaY,body.y*.35,1.1,dt);const y=cameraSeaY;
  if(settings.camera===1){desiredCamera.set(.65,2.45,0.2);activeVessel.localToWorld(desiredCamera);camera.position.lerp(desiredCamera,1-Math.exp(-dt*9));cameraTarget.set(0,2,-70);activeVessel.localToWorld(cameraTarget);camera.lookAt(cameraTarget);}else{
    const yaw=(settings.camera===0?state.heading:0)+azimuth,dist=cameraDistance*(settings.ship?1.4:1);cameraTarget.set(state.x,y+1.2,state.z);desiredCamera.set(state.x+Math.sin(yaw)*Math.cos(elevation)*dist,y+Math.sin(elevation)*dist+2,state.z+Math.cos(yaw)*Math.cos(elevation)*dist);camera.position.lerp(desiredCamera,1-Math.exp(-dt*3));camera.position.y=Math.max(camera.position.y,getHeight(camera.position.x,camera.position.z)+1.1);camera.up.copy(up);camera.lookAt(cameraTarget);
  }
  if(settings.cycle){settings.hour=(settings.hour+dt*.045)%24;$('time').value=settings.hour;}
  lightingTimer+=dt;if(lightingTimer>.1){updateLighting();lightingTimer=0;}
  if(audioContext){engineOsc.frequency.setTargetAtTime(28+Math.abs(state.speed)*3,audioContext.currentTime,.15);engineGain.gain.setTargetAtTime(audioOn?.015+Math.abs(state.throttle)*.035:0,audioContext.currentTime,.1);seaGain.gain.setTargetAtTime(audioOn?.55+settings.waves*.2:0,audioContext.currentTime,.1);}
  hudTimer+=dt;if(hudTimer>.1){updateHUD();hudTimer=0;}frameCounter++;fpsTime+=realDt;if(fpsTime>1){$('fps').textContent=Math.round(frameCounter/fpsTime)+' FPS';frameCounter=0;fpsTime=0;}
  pipeline.render();
}

document.addEventListener('keydown',e=>{if(['INPUT','SELECT'].includes(document.activeElement?.tagName)||(e.code==='Space'&&document.activeElement?.tagName==='BUTTON'))return;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();keys.add(e.code);if(!e.repeat){if(e.code==='KeyC')setCamera();if(e.code==='KeyR'){Object.assign(state,initialState());Object.assign(body,initialBuoyancy());ocean.wake.reset();spray.reset();notify('Yeni bir rota, yeni bir başlangıç.');}if(e.code==='KeyH')$('settings').classList.toggle('hidden');}});
document.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>{keys.clear();lastTime=performance.now();});
const canvas=renderer.domElement;
canvas.addEventListener('pointerdown',e=>{dragging=true;pointerX=e.clientX;pointerY=e.clientY;canvas.setPointerCapture(e.pointerId);document.activeElement?.blur();});canvas.addEventListener('pointermove',e=>{if(dragging){azimuth-=(e.clientX-pointerX)*.005;elevation=T.MathUtils.clamp(elevation+(e.clientY-pointerY)*.004,.07,1.2);pointerX=e.clientX;pointerY=e.clientY;}});canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);canvas.addEventListener('wheel',e=>{cameraDistance=T.MathUtils.clamp(cameraDistance+e.deltaY*.025,12,100);e.preventDefault();},{passive:false});
document.querySelectorAll('[data-key]').forEach(button=>{button.addEventListener('pointerdown',e=>{e.preventDefault();keys.add(button.dataset.key);button.setPointerCapture(e.pointerId);});for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,()=>keys.delete(button.dataset.key));});
$('settings-toggle').onclick=()=>$('settings').classList.toggle('hidden');$('camera').onclick=setCamera;$('sound').onclick=toggleSound;
$('time').oninput=e=>{settings.hour=+e.target.value;document.querySelectorAll('[data-hour]').forEach(b=>b.classList.remove('active'));updateLighting();};
document.querySelectorAll('[data-hour]').forEach(button=>button.onclick=()=>{settings.hour=+button.dataset.hour;$('time').value=settings.hour;document.querySelectorAll('[data-hour]').forEach(b=>b.classList.toggle('active',b===button));updateLighting();button.blur();});
$('cycle').onchange=e=>settings.cycle=e.target.checked;
$('foam').oninput=e=>{ocean.foamAmount.value=+e.target.value;$('foam-label').textContent=Math.round(+e.target.value*100)+'%';};
document.querySelectorAll('[data-sea]').forEach(button=>button.onclick=()=>{$('waves').value=button.dataset.sea;$('waves').dispatchEvent(new Event('input'));});
$('waves').oninput=e=>{settings.waves=+e.target.value;$('wave-label').textContent=settings.waves<.4?'Sakin':settings.waves<.9?'Hafif dalgalı':settings.waves<1.6?'Açık deniz':'Sert deniz';sky.cloudCoverage.value=.2+settings.waves*.15;};
$('vessel').onchange=e=>{settings.ship=e.target.value==='ship';boat.visible=!settings.ship;ship.visible=settings.ship;activeVessel=settings.ship?ship:boat;Object.assign(body,initialBuoyancy());notify(settings.ship?'Mavi 52 · Daha ağır gövde, daha yumuşak dönüş.':'Kıyı 28 · Gazı aç, ufka yaklaş.');e.target.blur();};
$('quality').onchange=e=>{settings.quality=e.target.value;renderer.setPixelRatio(Math.min(devicePixelRatio,{low:1,medium:1.5,high:2}[settings.quality]));renderer.shadowMap.enabled=settings.quality!=='low';e.target.blur();};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('Bu tarayıcıda tam ekran kullanılamıyor.');}};
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
if(innerWidth<800)$('settings').classList.add('hidden');

async function init(){
  try{
    await renderer.init();
    $('loading-message').textContent='Dalga spektrumu ve köpük alanı hazırlanıyor…';
    await ocean.init();
    $('backend').textContent=(renderer.backend.isWebGPUBackend?'WEBGPU':'WEBGL2')+' · '+ocean.mode;
    pipeline=new T.RenderPipeline(renderer);const scenePass=pass(scene,camera),color=scenePass.getTextureNode('output');pipeline.outputNode=color.add(bloom(color.clamp(0,4),.12,.25,1.15));
    updateLighting();updateHUD();
    await renderer.compileAsync(scene,camera);
    renderer.setAnimationLoop(animate);
    $('loading').classList.add('done');notify('W ile gaz ver, açık denize çık.');
    // Read-only diagnostics for automated smoke tests and troubleshooting.
    window.__ocean={state,body,settings,renderer,scene,ocean,get frames(){return renderer.info.render.frameCalls;},get ready(){return true;}};
  }catch(error){console.error(error);showGraphicsError(error.message);}
}
function showGraphicsError(message){
  renderer.setAnimationLoop(null);$('loading').classList.remove('done');
  $('loading-message').textContent='Grafik sürücüsü görüntüyü sürdüremedi. Donanım hızlandırmasını açabilir veya uyumluluk modunu deneyebilirsin. '+message;
  if(!$('recovery')){const button=document.createElement('button');button.id='recovery';button.textContent='Uyumluluk modunda yeniden aç';button.onclick=()=>{const url=new URL(location.href);url.searchParams.set('compat','1');location.href=url.href;};$('loading').appendChild(button);}
}
renderer.onDeviceLost=info=>showGraphicsError(info.message||'GPU bağlantısı kesildi.');
init();
