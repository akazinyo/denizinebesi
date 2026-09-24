import * as T from 'three/webgpu';
import {Fn,positionLocal,positionWorld,cameraPosition,cameraViewMatrix,uniform,vec2,vec3,vec4,float,sin,cos,dot,normalize,mix,pow,max,smoothstep,texture,reflector} from 'three/tsl';
import {WAVES,waveAmplitudeScale,waveChoppiness,waveHeight} from './physics.js';
import {WakeField} from './wake.js';
import {OceanSimulator} from './vendor/seedocean/fft/ocean-simulator.js';
import {buildSpectrumParams} from './vendor/seedocean/fft/defaults.js';

function makeNoise(){
  const size=256,bytes=new Uint8Array(size*size*4);let seed=8249;
  const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const grids=[8,16,32,64].map(n=>({n,data:Float32Array.from({length:n*n},rnd)}));
  const noise=(x,y)=>{let v=0,weight=.53;for(const g of grids){const u=x/size*g.n,w=y/size*g.n,ix=Math.floor(u),iy=Math.floor(w),fx=u-ix,fy=w-iy,sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy);const at=(a,b)=>g.data[((b%g.n+g.n)%g.n)*g.n+(a%g.n+g.n)%g.n];v+=T.MathUtils.lerp(T.MathUtils.lerp(at(ix,iy),at(ix+1,iy),sx),T.MathUtils.lerp(at(ix,iy+1),at(ix+1,iy+1),sx),sy)*weight;weight*=.5;}return v;};
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4;bytes[i]=noise(x,y)*255;bytes[i+1]=noise(x+53,y+91)*255;bytes[i+2]=rnd()*255;bytes[i+3]=255;}
  const t=new T.DataTexture(bytes,size,size);t.wrapS=t.wrapT=T.RepeatWrapping;t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}

export class Ocean{
  constructor(renderer){
    this.renderer=renderer;this.root=new T.Group();this.time=uniform(0);this.strength=uniform(1.15);this.origin=uniform(new T.Vector2());this.sunDirection=uniform(new T.Vector3(0,1,0));this.daylight=uniform(1);
    this.wake=new WakeField();this.wakeOrigin=uniform(this.wake.origin);this.buffers=null;this.readPending=false;this.readClock=0;this.readErrors=0;
    this.mode='Gerstner';this.simulator=null;this.noise=makeNoise();
  }
  async init(){
    if(this.renderer.backend.isWebGPUBackend){
      const params=buildSpectrumParams({spectrum:{lengthScales:[220,40,8],local:{windSpeed:13,scale:1.1,swell:.3},swell:{windSpeed:7,scale:.45},lambda:1.3}},{seed:71,foamPersistence:.8},'perf');
      this.simulator=new OceanSimulator(this.renderer,params);
      await this.simulator.updateInitialSpectrum();this.simulator.evolve(24,1/60);this.mode='FFT · 3 KATMAN';
      await this.readWaves();
    }
    this.buildSurface();
    return this;
  }
  buildSurface(){
    const geometry=new T.PlaneGeometry(2,2,300,300);geometry.rotateX(-Math.PI/2);
    const a=geometry.attributes.position;
    for(let i=0;i<a.count;i++){for(const axis of ['X','Z']){const v=a['get'+axis](i);a['set'+axis](i,Math.sign(v)*(Math.abs(v)*85+Math.pow(Math.abs(v),5)*9915));}}
    geometry.computeBoundingSphere();
    const material=new T.MeshStandardNodeMaterial({side:T.FrontSide,metalness:0,roughness:.19});
    const uv=positionLocal.xz.add(this.origin);
    const intensity=this.strength.sub(.15).div(2.05).clamp(0,1);
    const amplitudeScale=length=>{const longWave=Math.max(0,Math.min(1,(length-3)/59)),shortWave=1-longWave;return float(.48).add(intensity.mul(.9)).mul(float(1).add(intensity.mul(.42*longWave))).mul(float(1).sub(intensity.mul(.65*shortWave)));};
    const choppiness=float(1).add(intensity.mul(.32));
    const gerstnerDisp=Fn(([p])=>{const d=vec3(0).toVar();for(const w of WAVES){const phase=dot(p,vec2(w.x,w.z)).mul(w.k).sub(this.time.mul(w.speed)).add(w.phase),amplitude=amplitudeScale(w.length).mul(w.amplitude);d.addAssign(vec3(cos(phase).mul(amplitude).mul(w.chop*w.x).mul(choppiness),sin(phase).mul(amplitude),cos(phase).mul(amplitude).mul(w.chop*w.z).mul(choppiness)));}return d;});
    const gerstnerSurface=Fn(([p])=>{const f=vec3(0).toVar();for(const w of WAVES){const phase=dot(p,vec2(w.x,w.z)).mul(w.k).sub(this.time.mul(w.speed)).add(w.phase),amplitude=amplitudeScale(w.length).mul(w.amplitude);f.addAssign(vec3(cos(phase).mul(amplitude).mul(w.k*w.x),cos(phase).mul(amplitude).mul(w.k*w.z),sin(phase).mul(amplitude)));}return f;});
    const displacement=Fn(()=>{
      if(!this.simulator)return gerstnerDisp(uv);
      const d=vec3(0).toVar();for(const c of this.simulator.cascades){const displacement=texture(c.displacement,uv.div(c.lengthScale)).xyz,scale=amplitudeScale(c.lengthScale);d.addAssign(vec3(displacement.x.mul(scale).mul(choppiness),displacement.y.mul(scale),displacement.z.mul(scale).mul(choppiness)));}return d;
    })();
    material.positionNode=positionLocal.add(displacement);
    const field=Fn(()=>{
      if(!this.simulator)return gerstnerSurface(uv);
      const d=vec3(0).toVar();for(const c of this.simulator.cascades){const p=uv.div(c.lengthScale),scale=amplitudeScale(c.lengthScale),derivative=texture(c.derivatives,p);d.xy.addAssign(derivative.xy.mul(scale));d.z.addAssign(texture(c.displacement,p).y.mul(scale));}return d;
    })();
    const detail1=texture(this.noise,uv.mul(.12).add(vec2(this.time.mul(.022),this.time.mul(-.015))));
    const detail2=texture(this.noise,uv.mul(.41).add(vec2(this.time.mul(-.035),this.time.mul(.024))));
    const detail=detail1.rg.add(detail2.rg.mul(.4)).sub(.7).mul(.34);
    const N=normalize(vec3(field.x.add(detail.x).negate(),float(1),field.y.add(detail.y).negate()));
    material.normalNode=normalize(cameraViewMatrix.mul(vec4(N,0)).xyz);
    const worldUV=positionWorld.xz;
    const lace=texture(this.noise,worldUV.mul(.73)).g;
    const wakeUV=worldUV.sub(this.wakeOrigin).div(this.wake.extent).add(.5);
    const inside=smoothstep(0,.035,wakeUV.x).mul(smoothstep(0,.035,wakeUV.y)).mul(smoothstep(0,.035,float(1).sub(wakeUV.x))).mul(smoothstep(0,.035,float(1).sub(wakeUV.y)));
    const wakeFoam=texture(this.wake.texture,wakeUV).r.mul(inside);
    const coverage=wakeFoam.mul(lace.mul(.9).add(.65)).clamp(0,1);
    const depthColor=uniform(new T.Color(0x053040)),crestColor=uniform(new T.Color(0x107881)),foamColor=uniform(new T.Color(0xd7e5dc));
    const scatter=smoothstep(-.4,2.6,field.z).mul(pow(max(dot(this.sunDirection,N.negate()).add(.5),0),2)).mul(.7);
    material.colorNode=mix(mix(depthColor,crestColor,scatter.clamp(0,1)),foamColor,coverage);
    material.roughnessNode=mix(float(.18),float(.82),coverage);
    const reflection=reflector({resolutionScale:.45,bounces:false});reflection.target.rotation.x=-Math.PI/2;this.root.add(reflection.target);
    reflection.uvNode=reflection.uvNode.add(N.xz.mul(.018));
    const V=normalize(cameraPosition.sub(positionWorld)),fresnel=pow(float(1).sub(max(dot(N,V),0)),5).mul(.82).add(.025);
    material.emissiveNode=reflection.rgb.mul(fresnel).mul(float(1).sub(coverage)).mul(.65).add(crestColor.mul(scatter).mul(.09).mul(this.daylight));
    this.mesh=new T.Mesh(geometry,material);this.mesh.frustumCulled=false;this.mesh.receiveShadow=true;this.root.add(this.mesh);this.material=material;
  }
  async readWaves(){
    if(!this.simulator||this.readPending)return;
    this.readPending=true;
    try{
      const buffers=await Promise.all(this.simulator.cascades.slice(0,2).map(async c=>({length:c.lengthScale,height:new Float32Array(await this.renderer.getArrayBufferAsync(c.DyDxz.value)),horizontal:new Float32Array(await this.renderer.getArrayBufferAsync(c.DxDz.value))})));
      this.buffers=buffers;
    }catch(error){if(this.readErrors++===0)console.warn('Dalga örnekleri okunamadı:',error);}
    finally{this.readPending=false;}
  }
  sampleFFT(x,z){
    if(!this.buffers)return {x:0,y:0,z:0};
    let dx=0,dy=0,dz=0;const n=this.simulator.N;
    for(const b of this.buffers){
      const u=((x/b.length%1)+1)%1*n-.5,v=((z/b.length%1)+1)%1*n-.5,ix=Math.floor(u),iz=Math.floor(v),fx=u-ix,fz=v-iz;
      const read=(data,channel)=>{const at=(px,pz)=>data[(((pz+n)%n)*n+(px+n)%n)*2+channel];return T.MathUtils.lerp(T.MathUtils.lerp(at(ix,iz),at(ix+1,iz),fx),T.MathUtils.lerp(at(ix,iz+1),at(ix+1,iz+1),fx),fz);};
      const scale=waveAmplitudeScale(b.length,this.strength.value),choppiness=waveChoppiness(this.strength.value);dy+=read(b.height,0)*scale;dx+=read(b.horizontal,0)*this.simulator.lambda.value*scale*choppiness;dz+=read(b.horizontal,1)*this.simulator.lambda.value*scale*choppiness;
    }
    return {x:dx,y:dy,z:dz};
  }
  getHeight(x,z){
    if(!this.simulator)return waveHeight(x,z,this.time.value,this.strength.value);
    let u=x,v=z;for(let i=0;i<3;i++){const d=this.sampleFFT(u,v);u=x-d.x;v=z-d.z;}return this.sampleFFT(u,v).y;
  }
  update(t,dt,state,body,ship){
    this.time.value=t+24;this.root.position.set(Math.round(state.x/4)*4,0,Math.round(state.z/4)*4);this.origin.value.set(this.root.position.x,this.root.position.z);
    if(this.simulator){this.simulator.evolve(this.time.value,dt);this.readClock+=dt;if(this.readClock>.045){this.readClock=0;this.readWaves();}}
    this.wake.update(state,body,dt,ship);
  }
}
