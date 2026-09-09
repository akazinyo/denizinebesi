// Deterministic broad-band swell. CPU and fallback shader share these exact waves.
export const WAVES = [
  [1.05, 62, 1.08, .2], [.78, 38, 1.42, 2.1], [.50, 24, .79, 4.3],
  [.32, 15, 1.70, 1.7], [.22, 10, .35, 5.3], [.16, 7.1, 2.25, .8],
  [.10, 4.8, 1.05, 3.1], [.065, 3.3, -.45, 4.8], [.042, 2.1, 1.9, 2.5],
  [.028, 1.35, .64, 5.9], [.017, .86, 2.7, 1.4], [.012, .57, -.7, 3.8],
].map(([amplitude,length,angle,phase])=>({amplitude,k:2*Math.PI/length,x:Math.cos(angle),z:Math.sin(angle),speed:Math.sqrt(9.81*2*Math.PI/length),phase,chop:.48}));

export function waveDisplacement(x,z,time,strength){
  let dx=0,dy=0,dz=0;
  for(const w of WAVES){const phase=(x*w.x+z*w.z)*w.k-time*w.speed+w.phase,a=w.amplitude*strength;dy+=Math.sin(phase)*a;dx+=Math.cos(phase)*a*w.chop*w.x;dz+=Math.cos(phase)*a*w.chop*w.z;}
  return {x:dx,y:dy,z:dz};
}
export function waveHeight(x, z, time, strength) {
  let u=x,v=z;
  for(let i=0;i<4;i++){const d=waveDisplacement(u,v,time,strength);u=x-d.x;v=z-d.z;}
  return waveDisplacement(u,v,time,strength).y;
}

export function initialBuoyancy(){return {y:0,vy:0,pitch:0,roll:0,pitchRate:0,rollRate:0,wet:1,impact:0,airborne:false,initialized:false,lastSurface:0};}

// A buoyancy spring acts only while the hull touches water. In air gravity
// takes over; no assignment or lerp pins the hull to the instantaneous surface.
export function stepBuoyancy(body,state,getHeight,dt,ship=false){
  const sn=Math.sin(state.heading),cs=Math.cos(state.heading),length=ship?5.6:3.5,width=ship?1.95:1.3;
  const center=getHeight(state.x,state.z);
  const front=getHeight(state.x-sn*length,state.z-cs*length),back=getHeight(state.x+sn*length,state.z+cs*length);
  const left=getHeight(state.x-cs*width,state.z+sn*width),right=getHeight(state.x+cs*width,state.z-sn*width);
  const surface=center*.4+(front+back+left+right)*.15;
  if(!body.initialized){body.y=surface+.08;body.lastSurface=surface;body.initialized=true;}
  const draft=ship?.8:.52,immersion=surface+draft+.08-body.y;
  const contact=Math.max(0,Math.min(1,immersion/draft));
  const waterVelocity=Math.max(-5,Math.min(5,(surface-body.lastSurface)/Math.max(dt,.001)));
  const relativeVelocity=body.vy-waterVelocity*.5;
  const lift=9.81*Math.max(0,Math.min(3.2,immersion/draft));
  const planing=(ship?1:3.5)*Math.min(1,Math.max(0,state.speed)/18)*contact;
  body.impact=body.airborne&&contact>0?Math.max(0,-relativeVelocity):0;
  body.vy+=(lift-9.81+planing-relativeVelocity*(ship?3.5:2.7)*contact)*dt;
  body.y+=body.vy*dt;
  const pitchTarget=Math.atan2(front-back,length*2)+Math.max(0,state.speed)*.004;
  const rollTarget=Math.atan2(right-left,width*2)-state.rudder*state.speed*.012;
  body.pitchRate+=((pitchTarget-body.pitch)*(ship?9:15)*contact-body.pitchRate*2.5)*dt;
  body.rollRate+=((rollTarget-body.roll)*(ship?8:12)*contact-body.rollRate*2.1)*dt;
  body.pitch+=body.pitchRate*dt;body.roll+=body.rollRate*dt;
  body.wet=contact;body.airborne=immersion<=0;body.lastSurface=surface;
  return body;
}
export function stepBoat(state, controls, dt, ship = false) {
  const desired = controls.brake ? 0 : controls.forward ? 1 : controls.reverse ? -0.35 : 0;
  state.throttle += (desired - state.throttle) * (1-Math.exp(-dt*2));
  const max = ship ? 13 : 21;
  const targetSpeed = state.throttle * max;
  state.speed += (targetSpeed-state.speed)*(1-Math.exp(-dt*(controls.brake?1.4:0.24)));
  const rudder = (controls.left?1:0) - (controls.right?1:0);
  state.rudder += (rudder-state.rudder)*(1-Math.exp(-dt*3));
  state.heading += state.rudder * Math.tanh(state.speed/5) * dt * (ship?0.23:0.42);
  state.x -= Math.sin(state.heading)*state.speed*dt;
  state.z -= Math.cos(state.heading)*state.speed*dt;
  state.distance += Math.abs(state.speed)*dt;
  return state;
}
export function initialState(){return {x:0,z:0,speed:0,heading:0,throttle:0,rudder:0,distance:0};}
export function compassHeading(heading){return ((-heading*180/Math.PI)%360+360)%360;}
