import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,stepBoat,waveHeight,waveDisplacement,compassHeading,initialBuoyancy,stepBuoyancy,WAVES,waveAmplitudeScale,waveChoppiness} from '../src/physics.js';
test('full throttle moves forward and braking reduces speed',()=>{
  const s=initialState();for(let i=0;i<600;i++)stepBoat(s,{forward:true},1/60);
  assert(s.speed>15);assert(s.z< -80);assert(s.distance>80);
  const before=s.speed;for(let i=0;i<180;i++)stepBoat(s,{brake:true},1/60);assert(s.speed<before*.12);
});
test('turning left changes compass bearing to west; reverse travels backwards',()=>{
  const s=initialState();for(let i=0;i<300;i++)stepBoat(s,{forward:true,left:true},1/60);assert(s.x<0);assert(compassHeading(s.heading)>180);
  const r=initialState();for(let i=0;i<300;i++)stepBoat(r,{reverse:true},1/60);assert(r.speed<0);assert(r.z>0);
});
test('integration is stable across frame rates',()=>{
  const simulate=rate=>{const s=initialState();for(let i=0;i<rate*10;i++)stepBoat(s,{forward:true,left:true},1/rate);return s;};
  const a=simulate(30),b=simulate(120);assert(Math.hypot(a.x-b.x,a.z-b.z)<1.5);assert(Math.abs(a.speed-b.speed)<.1);
});
test('Gerstner heights remain bounded and inverse sampling follows the displaced surface',()=>{
  const limit=WAVES.reduce((n,w)=>n+w.amplitude,0);
  for(let i=0;i<500;i++){const x=i*13,z=-i*7,t=i/3,h=waveHeight(x,z,t,1);assert(Number.isFinite(h));assert(Math.abs(h)<=limit);const d=waveDisplacement(x,z,t,1);assert(Math.abs(waveHeight(x+d.x,z+d.z,t,1)-d.y)<.03);assert.equal(waveHeight(x,z,t,0),0);}
});
test('rougher sea states shift wave energy toward longer swells',()=>{
  assert(waveAmplitudeScale(62,2.2)>waveAmplitudeScale(62,1.15));
  assert(waveAmplitudeScale(1.35,2.2)<waveAmplitudeScale(1.35,1.15));
  assert(waveChoppiness(2.2)>waveChoppiness(1.15));
  assert.equal(waveAmplitudeScale(62,0),0);
});
test('a hull above the surface falls under gravity instead of snapping to water',()=>{
  const body={...initialBuoyancy(),initialized:true,y:4},s=initialState();
  stepBuoyancy(body,s,()=>0,1/120);assert(body.y>3.99);assert(body.vy<0);assert(body.airborne);
  let landed=false,impact=0;for(let i=0;i<1200;i++){stepBuoyancy(body,s,()=>0,1/120);impact=Math.max(impact,body.impact);if(body.wet>.2)landed=true;}
  assert(landed);assert(impact>2);assert(Math.abs(body.y-.08)<.05);assert(Math.abs(body.vy)<.1);
});
test('fast boat can leave a retreating wave and land; spring motion stays stable',()=>{
  const body=initialBuoyancy(),s=initialState();s.speed=20;let air=0,maxY=-Infinity,minY=Infinity;
  for(let i=0;i<2400;i++){const t=i/120;stepBuoyancy(body,s,()=>1.4*Math.sin(t*3.5),1/120);if(body.airborne)air++;maxY=Math.max(maxY,body.y);minY=Math.min(minY,body.y);assert(Number.isFinite(body.y));assert(Math.abs(body.y)<8);}
  assert(air>0);assert(maxY-minY>2);
});
