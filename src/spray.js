import * as T from 'three/webgpu';
import {attribute,uv,smoothstep,float,length} from 'three/tsl';

export class Spray{
  constructor(scene,count=700){
    this.particles=Array.from({length:count},()=>({life:0}));this.index=0;this.emitClock=0;this.alpha=new Float32Array(count);
    const geometry=new T.PlaneGeometry(1,1);geometry.setAttribute('sprayAlpha',new T.InstancedBufferAttribute(this.alpha,1));
    const material=new T.MeshBasicNodeMaterial({color:0xd6e9e5,transparent:true,depthWrite:false});
    material.opacityNode=float(1).sub(smoothstep(.12,.5,length(uv().sub(.5)))).mul(attribute('sprayAlpha','float'));
    this.mesh=new T.InstancedMesh(geometry,material,count);this.mesh.frustumCulled=false;scene.add(this.mesh);this.dummy=new T.Object3D();
  }
  emit(state,body,ship,count,impact=0){
    const sn=Math.sin(state.heading),cs=Math.cos(state.heading),speed=Math.abs(state.speed),bow=ship?5:3.4;
    for(let i=0;i<count;i++){const p=this.particles[this.index++%this.particles.length],side=i%2?1:-1;
      Object.assign(p,{x:state.x-sn*bow+cs*side*1.2,y:body.y+.2,z:state.z-cs*bow-sn*side*1.2,vx:cs*side*(1.3+Math.random()*2.4)-sn*speed*.32,vy:1.2+Math.random()*(1+speed*.13+impact*.45),vz:-sn*side*(1.3+Math.random()*2.4)-cs*speed*.32,life:1.1+Math.random()*.7,maxLife:1.8,size:.06+Math.random()*.13});
    }
  }
  update(state,body,dt,ship,camera,getHeight){
    this.emitClock+=dt;
    if(this.emitClock>.04&&Math.abs(state.speed)>3&&body.wet>.05){this.emitClock=0;this.emit(state,body,ship,Math.min(16,Math.ceil(Math.abs(state.speed)*.6)));}
    if(body.impact>1.1)this.emit(state,body,ship,Math.min(100,Math.ceil(body.impact*12)),body.impact);
    for(let i=0;i<this.particles.length;i++){
      const p=this.particles[i];p.life-=dt;
      if(p.life>0){p.vy-=9.81*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;
        if(p.y<getHeight(p.x,p.z)){p.life=0;this.alpha[i]=0;this.dummy.scale.setScalar(0);}else{this.dummy.position.set(p.x,p.y,p.z);this.dummy.quaternion.copy(camera.quaternion);this.dummy.scale.set(p.size,p.size*(1+Math.abs(p.vy)*.15),1);this.alpha[i]=Math.min(.8,p.life*.8);}
      }else{this.alpha[i]=0;this.dummy.scale.setScalar(0);}
      this.dummy.updateMatrix();this.mesh.setMatrixAt(i,this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate=true;this.mesh.geometry.attributes.sprayAlpha.needsUpdate=true;
  }
  reset(){this.particles.forEach(p=>p.life=0);}
}
