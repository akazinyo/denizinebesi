import * as T from 'three/webgpu';

// A world-anchored, scrolling foam map. Trails persist after a turn or stop.
export class WakeField{
  constructor(size=256,extent=220){
    this.size=size;this.extent=extent;this.origin=new T.Vector2();this.data=new Uint8Array(size*size);this.energy=new Float32Array(size*size);
    this.texture=new T.DataTexture(this.data,size,size,T.RedFormat);this.texture.minFilter=this.texture.magFilter=T.LinearFilter;this.texture.needsUpdate=true;
    this.history=[];this.clock=0;this.stampClock=0;
  }
  stamp(x,z,radius,amount){
    const n=this.size,scale=n/this.extent,cx=(x-this.origin.x)*scale+n/2,cy=(z-this.origin.y)*scale+n/2,r=radius*scale;
    for(let y=Math.max(0,Math.floor(cy-r*2));y<Math.min(n,cy+r*2);y++)for(let x=Math.max(0,Math.floor(cx-r*2));x<Math.min(n,cx+r*2);x++){
      const d=((x-cx)**2+(y-cy)**2)/Math.max(.2,r*r),i=y*n+x;if(d<4)this.energy[i]=Math.min(1,this.energy[i]+Math.exp(-d*1.4)*amount);
    }
  }
  update(state,body,dt,ship){
    this.clock+=dt;this.stampClock+=dt;
    const unit=this.extent/this.size,ox=Math.round(state.x/unit),oz=Math.round(state.z/unit),dx=ox-Math.round(this.origin.x/unit),dz=oz-Math.round(this.origin.y/unit);
    if(Math.abs(dx)>8||Math.abs(dz)>8){
      const old=this.energy,newData=new Float32Array(old.length),n=this.size;
      for(let y=0;y<n;y++)for(let x=0;x<n;x++){const px=x+dx,py=y+dz;if(px>=0&&px<n&&py>=0&&py<n)newData[y*n+x]=old[py*n+px];}
      this.energy=newData;this.origin.set(ox*unit,oz*unit);
    }
    const decay=Math.exp(-dt*.19);for(let i=0;i<this.energy.length;i++)this.energy[i]*=decay;
    const speed=Math.abs(state.speed),sn=Math.sin(state.heading),cs=Math.cos(state.heading),stern=ship?6.7:4.1;
    if(this.stampClock>.045&&speed>.8&&body.wet>.03){
      this.stampClock=0;
      this.history.push({x:state.x+sn*stern,z:state.z+cs*stern,sn,cs,age:0,speed});
      this.stamp(state.x+sn*stern,state.z+cs*stern,ship?2.2:1.25,.35+speed*.025);
      for(const side of [-1,1])this.stamp(state.x-sn*2+cs*side*1.25,state.z-cs*2-sn*side*1.25,.8,speed*.018);
    }
    for(const p of this.history){p.age+=dt;const spread=(ship?2:1.3)+p.age*1.05;
      for(const side of [-1,1])this.stamp(p.x+p.cs*side*spread,p.z-p.sn*side*spread,.9+p.age*.1,dt*.2*Math.min(1,p.speed/8)*Math.exp(-p.age*.23));
    }
    this.history=this.history.filter(p=>p.age<14);
    if(body.impact>1.2)this.stamp(state.x,state.z,ship?5:3,Math.min(1,body.impact*.15));
    for(let i=0;i<this.data.length;i++)this.data[i]=Math.min(255,this.energy[i]*255);this.texture.needsUpdate=true;
  }
  reset(){this.energy.fill(0);this.data.fill(0);this.history=[];this.texture.needsUpdate=true;}
}
