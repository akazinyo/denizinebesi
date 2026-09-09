import * as T from 'three/webgpu';

export function createVessel(large = false) {
  const boat = new T.Group();
  const white = new T.MeshStandardMaterial({color:0xecebe2,roughness:0.28,metalness:0.12});
  const navy = new T.MeshStandardMaterial({color:0x122d3a,roughness:0.25,metalness:0.4});
  const chrome = new T.MeshStandardMaterial({color:0xbeced0,roughness:0.17,metalness:0.85});
  const teak = new T.MeshStandardMaterial({color:0x927052,roughness:0.85,side:T.DoubleSide});
  const seat = new T.MeshStandardMaterial({color:0xd4c9ad,roughness:0.75});
  const dark = new T.MeshStandardMaterial({color:0x182129,roughness:0.38,metalness:0.35});
  const glass = new T.MeshPhysicalMaterial({color:0x91c9d4,roughness:0.05,metalness:0.35,transparent:true,opacity:0.48,side:T.DoubleSide});
  function mesh(geo,mat,x=0,y=0,z=0){const m=new T.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;boat.add(m);return m;}
  function box(w,h,d,mat,x,y,z){return mesh(new T.BoxGeometry(w,h,d),mat,x,y,z);}
  function bar(a,b,r=.025,mat=chrome){const start=new T.Vector3(...a),end=new T.Vector3(...b);const m=mesh(new T.CylinderGeometry(r,r,start.distanceTo(end),8),mat);m.position.copy(start).add(end).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.sub(start).normalize());return m;}
  // Cross sections form a pointed bow and a V-shaped keel, rather than a box hull.
  const sections=[[-5.6,.04,.5],[-4.5,.85,-.2],[-2.8,1.5,-.7],[0,1.65,-.85],[2.8,1.55,-.75],[4.1,1.38,-.55]];
  const vertices=[],indices=[];
  for(const [z,w,keel] of sections)vertices.push(-w,1.0,z,-w*.83,0,z,0,keel,z,w*.83,0,z,w,1.0,z);
  for(let i=0;i<sections.length-1;i++)for(let j=0;j<4;j++){const a=i*5+j,b=a+5;indices.push(a,b,a+1,b,b+1,a+1);}
  indices.push(25,26,27,25,27,29,27,28,29);
  const hullGeo=new T.BufferGeometry();hullGeo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));hullGeo.setIndex(indices);hullGeo.computeVertexNormals();
  white.side=T.DoubleSide;mesh(hullGeo,white);
  const deckShape=new T.Shape();deckShape.moveTo(0,-5.55);for(const [z,w] of sections)deckShape.lineTo(w,z);for(const [z,w] of [...sections].reverse())deckShape.lineTo(-w,z);deckShape.closePath();
  const deck=mesh(new T.ShapeGeometry(deckShape),teak,0,1.01,0);deck.rotation.x=Math.PI/2;
  // Thin contrasting gunwales and stainless steel bow rails.
  for(const side of [-1,1]){
    for(let i=0;i<sections.length-1;i++){const a=sections[i],b=sections[i+1];bar([side*a[1],1,a[0]],[side*b[1],1,b[0]],.065,navy);}
    for(let i=0;i<4;i++){const [z,w]=sections[i];bar([side*w,1,z],[side*w,1.65,z]);if(i<3){const next=sections[i+1];bar([side*w,1.65,z],[side*next[1],1.65,next[0]]);}}
  }
  for(let x=-1.3;x<=1.3;x+=.17)box(.014,.012,5.5,dark,x,1.023,.9);
  box(2.15,.33,2.2,seat,0,1.22,-2.8);
  box(2.35,.58,1.05,white,0,1.29,-.75);
  box(2.3,.12,.9,navy,0,1.62,-.85);
  const wind=box(2.55,1.02,.04,glass,0,2,-1.36);wind.rotation.x=-.25;
  bar([-1.28,1.52,-1.24],[-1.28,2.5,-1.49],.035);bar([1.28,1.52,-1.24],[1.28,2.5,-1.49],.035);bar([-1.28,2.5,-1.49],[1.28,2.5,-1.49],.04);
  for(const x of [-.76,.76]){box(.76,.35,.8,seat,x,1.54,.6);box(.76,.85,.2,seat,x,1.98,.97);bar([x,1,.65],[x,1.4,.65],.08);}
  box(2.5,.4,.72,seat,0,1.35,2.93);box(2.5,.55,.18,seat,0,1.77,3.3);
  const wheel=mesh(new T.TorusGeometry(.23,.025,8,24),dark,.7,1.92,-.39);wheel.rotation.x=-.3;
  for(const x of [.38,.78]){const dial=mesh(new T.CylinderGeometry(.095,.095,.02,16),dark,x,1.7,-.65);dial.rotation.x=.7;}
  for(const x of [-.65,.65]){box(.52,.95,.58,dark,x,.52,4.22);box(.17,.8,.21,chrome,x,-.3,4.36);mesh(new T.SphereGeometry(.24,12,8),dark,x,-.62,4.4).scale.set(1,.25,1);}
  // Fabric canopy, supports, radar and navigation lights.
  for(const x of [-1.25,1.25])for(const z of [0,2.2])bar([x,1,z],[x,3.05,z-.15],.035);
  box(2.8,.09,3.1,large?white:navy,0,3.07,.8);
  bar([0,3.1,1.2],[0,3.9,1.2],.025);box(.7,.12,.18,white,0,3.69,1.2);
  const lightMaterials=[];
  for(const [x,color] of [[-1.48,0xff3028],[1.48,0x55ffb0],[0,0xffefc5]]){
    const mat=new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:2});lightMaterials.push(mat);mesh(new T.SphereGeometry(.065,12,8),mat,x,x===0?3.88:1.13,x===0?1.2:-1.2);
  }
  const cabinLight=new T.PointLight(0xffcd86,0,12,2);cabinLight.position.set(0,2.65,.6);boat.add(cabinLight);
  const headlight=new T.SpotLight(0xffefcc,0,65,.48,.7,1.3);headlight.position.set(0,2.3,-1.5);headlight.target.position.set(0,0,-28);boat.add(headlight,headlight.target);
  if(large){
    box(2.48,1.9,3.4,white,0,2.02,.48);
    box(2.5,.8,2.8,glass,0,2.55,.3);
    box(2.8,.16,4.1,white,0,3.09,.42);
    box(1.8,.55,1.5,white,0,3.43,1.05);
    boat.scale.set(1.5,1.35,1.65);
  }
  boat.userData={cabinLight,headlight,lightMaterials};
  return boat;
}
