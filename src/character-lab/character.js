import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Authored geometry in metres. Fabric is a profiled surface, not capsule limbs.
export function createExplorer() {
 const root=new T.Group(); root.name='Explorador La señal';
 let seed=29; const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
 const textile=document.createElement('canvas');textile.width=textile.height=256;
 const ctx=textile.getContext('2d'), pixels=ctx.createImageData(256,256);
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4,v=205+random()*25+((x%3===0||y%3===0)?-24:0);pixels.data.set([v,v,v,255],i);}
 ctx.putImageData(pixels,0,0);
 for(let i=0;i<170;i++){ctx.fillStyle='rgba(66,48,28,'+(random()*.10)+')';ctx.beginPath();ctx.ellipse(random()*256,random()*256,random()*15+1,random()*5+1,random()*6,0,7);ctx.fill();}
 const tex=new T.CanvasTexture(textile);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.anisotropy=8;
 const white=new T.MeshStandardMaterial({color:0xbfbba9,map:tex,bumpMap:tex,bumpScale:.0007,roughness:.89});
 const yellow=white.clone();yellow.color.set(0x99742d);
 const dark=new T.MeshStandardMaterial({color:0x282c2b,roughness:.73,bumpMap:tex,bumpScale:.0004});
 const shell=new T.MeshStandardMaterial({color:0xbebdac,roughness:.43,metalness:.2});
 const metal=new T.MeshStandardMaterial({color:0x747a76,roughness:.3,metalness:.83});
 const rubber=new T.MeshStandardMaterial({color:0x151c1d,roughness:.8});
 const glass=new T.MeshPhysicalMaterial({color:0x997045,metalness:1,roughness:.13,clearcoat:1,clearcoatRoughness:.08,envMapIntensity:1.6});
 const light=new T.MeshStandardMaterial({color:0xffe7c3,emissive:0xffd5a2,emissiveIntensity:2});
 const cyan=new T.MeshStandardMaterial({color:0x5cc6c6,emissive:0x309d9c,emissiveIntensity:.7});
 const add=(p,g,m,pos=[0,0,0],scale)=>{const o=new T.Mesh(g,m);o.position.set(...pos);if(scale)o.scale.set(...scale);o.castShadow=true;o.receiveShadow=true;p.add(o);return o;};
 const box=(p,m,pos,size,r=.008)=>add(p,new RoundedBoxGeometry(...size,3,r),m,pos);
 const ball=(p,m,pos,scale)=>add(p,new T.SphereGeometry(1,32,24),m,pos,scale);
 const tube=(p,points,r,m,seg=48)=>add(p,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(v=>new T.Vector3(...v))),seg,r,8,false),m);
 const torus=(p,pos,r,thick,m,rotationX=0)=>{const a=add(p,new T.TorusGeometry(r,thick,10,48),m,pos);a.rotation.x=rotationX;return a;};
 const bolt=(p,pos)=>{const o=add(p,new T.CylinderGeometry(.004,.004,.004,6),metal,pos);o.rotation.x=Math.PI/2;};
 function fabric(p,profiles,length,mat,sign=-1,fold=.0025){
  const vertices=[],uvs=[],indices=[],rings=60,sides=48;
  for(let j=0;j<=rings;j++){
   const t=j/rings;let k=0;while(k<profiles.length-2&&t>profiles[k+1][0])k++;
   const a=profiles[k],b=profiles[k+1],f=T.MathUtils.smoothstep(t,a[0],b[0]);
   const rx=T.MathUtils.lerp(a[1],b[1],f),rz=T.MathUtils.lerp(a[2],b[2],f);
   for(let i=0;i<=sides;i++){
    const u=i/sides,angle=u*Math.PI*2;
    const jointFold=.25+Math.pow(Math.cos(t*Math.PI*1.3),8);
    const wrinkles=fold*jointFold*Math.sin(Math.PI*t)*(Math.sin(t*29+Math.sin(angle*2.7)*4)+.35*Math.sin(t*69+angle*7+Math.sin(t*17)*2));
    const pinched=1-.035*Math.pow(Math.cos(angle),12);
    vertices.push((rx+wrinkles)*Math.sin(angle)*pinched,sign*t*length,(rz+wrinkles)*Math.cos(angle));
    uvs.push(u*3,t*2);
    if(j<rings&&i<sides){const n=j*(sides+1)+i;if(sign<0)indices.push(n,n+sides+1,n+1,n+1,n+sides+1,n+sides+2);else indices.push(n,n+1,n+sides+1,n+1,n+sides+2,n+sides+1);}
   }
  }
  for(const j of [0,rings]){const c=vertices.length/3;vertices.push(0,sign*j/rings*length,0);uvs.push(.5,.5);
   for(let i=0;i<sides;i++){const n=j*(sides+1)+i;if((j===0)===(sign<0))indices.push(c,n+1,n);else indices.push(c,n,n+1);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();
  return add(p,g,mat);
 }
 const pelvis=new T.Group();pelvis.position.y=1.02;root.add(pelvis);
 fabric(pelvis,[[0,.20,.13],[.35,.235,.145],[1,.19,.125]],.20,white,1,.002);
 const waist=new T.Group();waist.position.y=1.06;root.add(waist);
 const body=new T.Group();body.position.y=.11;waist.add(body);
 fabric(body,[[0,.19,.12],[.3,.205,.135],[.7,.25,.15],[.88,.24,.135],[1,.14,.105]],.40,white,1,.002);
 box(body,dark,[0,.17,-.202],[.40,.53,.19],.025);
 box(body,shell,[0,.17,-.231],[.375,.49,.17],.025);
 box(body,yellow,[0,.31,-.324],[.245,.11,.013],.008);
 box(body,rubber,[0,.12,-.327],[.275,.22,.015],.008);
 for(let i=0;i<12;i++)box(body,metal,[0,.025+i*.017,-.34],[.245,.005,.008],.001);
 for(const s of [-1,1]){
  for(const y of [-.035,.385])bolt(body,[s*.147,y,-.321]);
  box(body,metal,[s*.172,.19,-.325],[.022,.29,.014],.004);
  tube(body,[[s*.15,-.08,.16],[s*.18,.18,.162],[s*.17,.4,.07],[s*.17,.39,-.19]],.017,dark);
  torus(body,[s*.087,.18,.175],.027,.008,metal);
  add(body,new T.CylinderGeometry(.024,.024,.019,24),rubber,[s*.087,.18,.174]).rotation.x=Math.PI/2;
  const pts=[[s*.087,.18,.19],[s*.09,-.02,.25],[s*.2,-.13,.18],[s*.27,-.06,-.08],[s*.19,.04,-.29]];
  const curve=new T.CatmullRomCurve3(pts.map(a=>new T.Vector3(...a)));
  add(body,new T.TubeGeometry(curve,64,.017,10,false),dark);
  for(let i=0;i<38;i++){const p=curve.getPoint(i/37),t=curve.getTangent(i/37);const r=torus(body,p.toArray(),.019,.0028,metal);r.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),t);}
 }
 box(body,shell,[0,.22,.143],[.29,.21,.027],.025);
 for(const sx of [-1,1]){box(body,metal,[sx*.17,.07,.167],[.038,.056,.011],.004);box(body,dark,[sx*.17,.07,.175],[.018,.036,.009],.002);}
 for(const s of [-1,1]){torus(body,[s*.087,.18,.179],.029,.006,metal);bolt(body,[s*.13,.3,.168]);}
 box(body,dark,[0,.29,.171],[.085,.028,.008],.003);
 box(body,yellow,[0,.296,.177],[.045,.009,.004],.001);
 box(pelvis,dark,[0,.15,.025],[.42,.046,.29],.009);
 box(pelvis,metal,[0,.15,.184],[.075,.039,.02],.004);
 torus(body,[0,.42,0],.123,.026,metal,Math.PI/2);
 const head=new T.Group();head.position.set(0,.60,.008);body.add(head);
 ball(head,shell,[0,0,-.018],[.173,.212,.17]);
 ball(head,rubber,[0,-.006,.04],[.166,.194,.169]);
 const vp=[],vi=[],uv=[];
 const U=56,V=36;
 for(let j=0;j<=V;j++)for(let i=0;i<=U;i++){const u=(i/U-.5)*2.25,v=(j/V-.5)*1.98;
  vp.push(.174*Math.sin(u)*Math.cos(v),.193*Math.sin(v),.045+.187*Math.cos(u)*Math.cos(v));uv.push(i/U,j/V);
  if(i<U&&j<V){const n=j*(U+1)+i;vi.push(n,n+1,n+U+1,n+1,n+U+2,n+U+1);}}
 const vg=new T.BufferGeometry();vg.setAttribute('position',new T.Float32BufferAttribute(vp,3));vg.setAttribute('uv',new T.Float32BufferAttribute(uv,2));vg.setIndex(vi);vg.computeVertexNormals();add(head,vg,glass);
 const edge=[];
 for(let i=0;i<=100;i++){const a=i/100*Math.PI*2,u=1.125*Math.cos(a),v=.99*Math.sin(a);edge.push([.174*Math.sin(u)*Math.cos(v),.193*Math.sin(v),.045+.187*Math.cos(u)*Math.cos(v)]);}
 tube(head,edge,.008,metal,100);
 for(const s of [-1,1]){
  const hinge=add(head,new T.CylinderGeometry(.042,.042,.025,32),metal,[s*.167,-.03,0]);hinge.rotation.z=Math.PI/2;
  box(head,dark,[s*.16,.072,.07],[.061,.052,.068]);
  if(s===-1)box(head,light,[s*.165,.072,.108],[.044,.034,.008],.005);
  for(const y of [-.12,.12])bolt(head,[s*.11,y,.12]);
 }
 tube(head,[[-.115,.12,-.10],[-.09,.19,-.06],[0,.214,-.018],[.09,.19,-.06],[.115,.12,-.10]],.004,metal);

 // ─── buildHand: articulated 3-phalanx fingers + opposable thumb ─────────────
 // Phalanges use RoundedBoxGeometry (fast) instead of fabric() (expensive).
 // Returns { group, fingers: [{prox,mid,dist,f}×4], thumb:{meta,prox,dist}, side }
 function buildHand(parent, side) {
  const handGroup = new T.Group();
  // Rotate hand 90 deg inward: palms face the body/thighs naturally (not upwards)
  handGroup.rotation.y = -side * (Math.PI / 2);
  parent.add(handGroup);

  // Palm
  box(handGroup, white, [0, -.04, .007], [.105, .107, .067], .025);
  box(handGroup, dark,  [0, -.039, .041], [.081, .065, .013], .006);

  // Shared knuckle geometry (small sphere, instantiated once per joint)
  const knuckleGeo = new T.SphereGeometry(1, 8, 6);

  const fingerData = [];
  // Lengths & widths per finger: [index, middle, ring, pinky]
  const fingerLengths = [.030, .033, .031, .024];
  const fingerWidths  = [.011, .012, .011, .009];

  for (let f = 0; f < 4; f++) {
   // Index (f=0) sits toward front/thumb; Pinky (f=3) sits toward back
   const xOff = side * (1.5 - f) * .024;
   const L0 = fingerLengths[f];   // proximal phalanx length
   const L1 = L0 * .76;           // middle phalanx length
   const L2 = L0 * .62;           // distal phalanx length
   const w  = fingerWidths[f];
   const restSpread = -side * (f - 1.5) * .014;

   // ── Proximal phalanx ──────────────────────────────────────────────────
   const proxGroup = new T.Group();
   proxGroup.position.set(xOff, -.085, .013);
   proxGroup.rotation.set(-.13 - f * .04, restSpread, 0);
   handGroup.add(proxGroup);
   // knuckle joint sphere
   const kn0 = new T.Mesh(knuckleGeo, dark);
   kn0.scale.set(w*1.1, w*.9, w*1.0); kn0.castShadow = true; proxGroup.add(kn0);
   // segment box (pivot at top, extends downward)
   const p0 = new T.Group(); p0.position.y = -w*.5; proxGroup.add(p0);
   box(p0, white, [0, -L0*.5+w*.5, 0], [w*1.8, L0, w*1.8], .006);

   // ── Middle phalanx ────────────────────────────────────────────────────
   const midGroup = new T.Group();
   midGroup.position.set(0, -L0, 0);
   proxGroup.add(midGroup);
   const kn1 = new T.Mesh(knuckleGeo, dark);
   kn1.scale.set(w*1.0, w*.85, w*.95); kn1.castShadow = true; midGroup.add(kn1);
   const p1 = new T.Group(); p1.position.y = -w*.4; midGroup.add(p1);
   box(p1, white, [0, -L1*.5+w*.4, 0], [w*1.65, L1, w*1.65], .005);

   // ── Distal phalanx (rounded tip) ─────────────────────────────────────
   const distGroup = new T.Group();
   distGroup.position.set(0, -L1, 0);
   midGroup.add(distGroup);
   const kn2 = new T.Mesh(knuckleGeo, dark);
   kn2.scale.set(w*.9, w*.8, w*.9); kn2.castShadow = true; distGroup.add(kn2);
   const p2 = new T.Group(); p2.position.y = -w*.35; distGroup.add(p2);
   box(p2, white, [0, -L2*.5+w*.35, 0], [w*1.5, L2, w*1.5], .006);
   // rounded fingertip cap
   const tip = new T.Mesh(new T.SphereGeometry(w*.72, 8, 6), white);
   tip.position.set(0, -L2+w*.35, 0); tip.castShadow = true; p2.add(tip);

   fingerData.push({ prox: proxGroup, mid: midGroup, dist: distGroup, f });
  }

  // ── Thumb: 3 segments, forward & opposable to palm ───────────────────────
  const thumbBase = new T.Group();
  thumbBase.position.set(side * .058, -.04, .029);
  handGroup.add(thumbBase);

  const thumbMeta = new T.Group();
  thumbMeta.rotation.set(.2, side * .35, -side * .32);
  thumbBase.add(thumbMeta);
  box(thumbMeta, white, [0, -.012, 0], [.019, .025, .019], .006);

  const thumbProx = new T.Group();
  thumbProx.position.set(0, -.025, 0);
  thumbMeta.add(thumbProx);
  const tkn = new T.Mesh(knuckleGeo, dark);
  tkn.scale.set(.017,.015,.016); tkn.castShadow=true; thumbProx.add(tkn);
  box(thumbProx, white, [0, -.014, 0], [.018, .028, .018], .005);

  const thumbDist = new T.Group();
  thumbDist.position.set(0, -.028, 0);
  thumbProx.add(thumbDist);
  box(thumbDist, white, [0, -.011, 0], [.016, .022, .016], .005);
  const ttip = new T.Mesh(new T.SphereGeometry(.009, 8, 6), white);
  ttip.position.set(0, -.022, 0); ttip.castShadow = true; thumbDist.add(ttip);

  return { group: handGroup, fingers: fingerData,
           thumb: { meta: thumbMeta, prox: thumbProx, dist: thumbDist },
           idleCurls: [0,0,0,0], side };
 }

 // ── setFingers: drive all phalanges from a single curl [0=open, 1=fist] ──────
 // spread: lateral fan of fingers (nice for open/idle)
 // individualCurl: optional array [curl_i,curl_m,curl_r,curl_p]
 function setFingers({ fingers, thumb, side }, curl, spread=0, individualCurl=null) {
  for (const { prox, mid, dist, f } of fingers) {
   const c = individualCurl ? individualCurl[f] : curl;
   prox.rotation.x = -.13 - f * .04 - c * 1.4;
   prox.rotation.y = -side * (f - 1.5) * spread;
   mid.rotation.x  = -c * 1.1;
   dist.rotation.x = -c * .85;
  }
  thumb.prox.rotation.x = -curl * .9;
  thumb.dist.rotation.x = -curl * .7;
 }

 const arms = [], legs = [];
 for (const s of [-1, 1]) {
  const shoulder = new T.Group();
  shoulder.position.set(s * .262, .315, 0);
  body.add(shoulder);
  ball(shoulder, yellow, [0,-.025,0], [.104,.105,.109]);
  fabric(shoulder, [[0,.092,.093],[.3,.096,.09],[.8,.073,.072],[1,.068,.067]], .29, yellow, -1, .0032);
  box(shoulder, yellow, [s*.062,-.067,.052], [.072,.13,.057], .022);
  tube(shoulder, [[s*.061,-.04,.07],[s*.065,-.14,.066],[s*.047,-.26,.052]], .002, shell, 20);

  const elbow = new T.Group();
  elbow.position.y = -.29;
  shoulder.add(elbow);
  ball(elbow, dark, [0,0,0], [.069,.065,.071]);
  fabric(elbow, [[0,.071,.073],[.3,.079,.079],[.8,.061,.06],[1,.055,.053]], .265, yellow, -1, .003);
  torus(elbow, [0,-.25,0], .058, .009, metal, Math.PI/2);
  for (let j=0;j<3;j++) torus(elbow,[0,-j*.012,0],.068,.004,dark,Math.PI/2);

  // Wrist pivot group
  const wrist = new T.Group();
  wrist.position.set(0, -.285, 0);
  elbow.add(wrist);

  const handData = buildHand(wrist, s);

  if (s === -1) {
   box(elbow, dark,  [0,-.16,.079],[.107,.10,.03],.01);
   box(elbow, metal, [0,-.16,.097],[.094,.088,.012],.005);
   box(elbow, cyan,  [0,-.16,.104],[.074,.060,.003],.003);
   for (let j=0;j<3;j++) box(elbow,dark,[-.024+j*.024,-.17,.107],[.012,.025+(j%2)*.015,.001],.0004);
  }

  arms.push({ shoulder, elbow, wrist, handData, side: s });

  const thigh=new T.Group();thigh.position.set(s*.12,1.035,0);root.add(thigh);
  fabric(thigh,[[0,.113,.125],[.15,.119,.127],[.5,.104,.115],[.9,.081,.091],[1,.077,.085]],.445,white,-1,.0037);
  box(thigh,white,[s*.083,-.17,.067],[.075,.15,.09],.018);
  tube(thigh,[[s*.10,-.045,0],[s*.108,-.20,0],[s*.078,-.41,0]],.003,dark,30);
  const knee=new T.Group();knee.position.y=-.445;thigh.add(knee);
  ball(knee,dark,[0,0,0],[.077,.078,.085]);
  fabric(knee,[[0,.083,.09],[.3,.09,.096],[.65,.074,.081],[1,.071,.07]],.40,white,-1,.0042);
  box(knee,dark,[0,-.025,.082],[.119,.13,.028],.025);
  box(knee,shell,[0,-.026,.102],[.102,.105,.016],.022);
  const foot=new T.Group();foot.position.set(0,-.40,0);knee.add(foot);
  box(foot,rubber,[0,-.055,-.025],[.162,.071,.20],.019);
  box(foot,white,[0,-.011,-.025],[.153,.095,.20],.027);
  const toe=new T.Group();toe.position.z=.075;foot.add(toe);
  box(toe,rubber,[0,-.055,.065],[.162,.071,.15],.019);
  box(toe,white,[0,-.011,.065],[.153,.095,.15],.027);
  box(toe,dark,[0,-.008,.11],[.15,.052,.048],.013);
  for(let j=0;j<3;j++){const z=.02+j*.042;if(z<.075)box(foot,metal,[0,.035,z],[.13,.012,.018],.003);else box(toe,metal,[0,.035,z-.075],[.13,.012,.018],.003);}
  for(let j=0;j<7;j++){const z=-.055+j*.035;if(z<.075)box(foot,rubber,[0,-.093,z],[.163,.013,.016],.002);else box(toe,rubber,[0,-.093,z-.075],[.163,.013,.016],.002);}
  torus(knee,[0,-.34,0],.071,.008,dark,Math.PI/2);
  legs.push({thigh,knee,foot,toe,side:s});
 }

 const joints={head,body,waist,pelvis,arms,legs};

 function pose(time, mode, walkWeight = 1, runWeight = 0, turnWeight = 0, airWeight = 0) {
  root.position.set(0,-.09,0);
  waist.rotation.set(0,0,0);
  pelvis.rotation.set(0,0,0);
  body.position.y = .11 + Math.sin(time*1.9)*.0025;
  body.rotation.set(0,0,0);
  head.rotation.set(0, Math.sin(time*.6)*.08, 0);

  // Default arm/wrist reset
  for (const {shoulder, elbow, wrist, handData, side} of arms) {
   shoulder.rotation.set(0, 0, side*.12);
   elbow.rotation.set(-.15, 0, 0);
   wrist.rotation.set(0, 0, 0);
   // ── Idle: subtle organic finger drift driven by time + per-arm phase ──
   const phase = time * .7 + side * .8;
   const idleCurl   = .12 + Math.sin(phase)       * .025;
   const idleSpread = .012 + Math.abs(Math.sin(time*.45 + side)) * .010;
   // Per-finger micro-delay for a natural "breathing" look
   const indiv = handData.idleCurls;
   for(let f=0;f<4;f++)indiv[f]=T.MathUtils.clamp(idleCurl+Math.sin(phase+f*.7)*.018,.04,.35);
   setFingers(handData, idleCurl, idleSpread, indiv);
  }
  for (const {thigh,knee,foot,toe} of legs){thigh.rotation.set(0,0,0);knee.rotation.set(0,0,0);foot.rotation.set(0,0,0);toe.rotation.set(0,0,0);}

  if (mode === 'scan') {
   const p = Math.sin(Math.min(time/5, 1)*Math.PI);
   // Left arm raised – flat open hand, fingers extended & spread
   arms[0].shoulder.rotation.x = -.6*p;
   arms[0].shoulder.rotation.z = -.12+.35*p;
   arms[0].elbow.rotation.x    = -.15-1.25*p;
   arms[0].wrist.rotation.x    = .15*p;
   setFingers(arms[0].handData, .07, .04+.03*p);  // wide open

   // Right arm lower – gently curled, thumb relaxed outward
   arms[1].shoulder.rotation.x = -.28*p;
   arms[1].shoulder.rotation.z = .12+.45*p;
   arms[1].elbow.rotation.x    = -.15-.75*p;
   arms[1].wrist.rotation.x    = .10*p;
   setFingers(arms[1].handData, .22+.08*p, .010);

   head.rotation.x = .32*p; head.rotation.y = -.27*p;
   body.rotation.y = -.06*p;

  } else if (mode === 'walk') {
   const duration=3.6, phase=Math.min(time,duration)/duration;
   const stride=Math.sin(phase*Math.PI*4), envelope=Math.sin(Math.PI*phase);
   root.position.z = phase*.40;
   root.position.y = -.09-.032*Math.sin(Math.PI*phase);
   body.rotation.z = stride*.016*envelope;

   for (const {thigh,knee,foot,side} of legs) {
    const start = side===-1 ? 0 : .5;
    const u = T.MathUtils.clamp((phase-start)*2, 0, 1);
    const zFoot=.4*u*u*(3-2*u), yFoot=.1+.065*Math.sin(u*Math.PI);
    const dz=zFoot-root.position.z, dy=1.035+root.position.y-yFoot;
    const L1=.445,L2=.40,r=T.MathUtils.clamp(Math.hypot(dy,dz),.02,L1+L2-.0001);
    const bend=Math.PI-Math.acos(T.MathUtils.clamp((L1*L1+L2*L2-r*r)/(2*L1*L2),-1,1));
    const hip=-Math.atan2(dz,dy)-Math.acos(T.MathUtils.clamp((L1*L1+r*r-L2*L2)/(2*L1*r),-1,1));
    thigh.rotation.x=hip; knee.rotation.x=bend; foot.rotation.x=-hip-bend;
   }

   arms.forEach(({shoulder,elbow,wrist,handData,side}) => {
    shoulder.rotation.x = -side*stride*.2*envelope;
    elbow.rotation.x    = -.2-Math.abs(stride)*.1*envelope;
    // Wrist flexes naturally with stride swing
    const wristSwing = -side*stride*.06*envelope;
    wrist.rotation.x = wristSwing;
    const walkCurl = .18+Math.abs(stride)*.14*envelope;
    setFingers(handData, walkCurl, .007);
   });
   head.rotation.y = 0;
   if (walkWeight < 1) {
    const w=T.MathUtils.clamp(walkWeight,0,1);
    root.position.y=T.MathUtils.lerp(-.09,root.position.y,w);
    root.position.z*=w;
    body.rotation.z*=w;
    for (const {thigh,knee,foot} of legs) {
     thigh.rotation.x*=w;knee.rotation.x*=w;foot.rotation.x*=w;
    }
    for (const {shoulder,elbow,wrist} of arms) {
     shoulder.rotation.x*=w;
     elbow.rotation.x=T.MathUtils.lerp(-.15,elbow.rotation.x,w);
     wrist.rotation.x*=w;
    }
   }

  } else if (mode === 'locomotion') {
   // Gait cíclico: cada pie despega y apoya en oposición; el tronco amortigua el paso.
   const w=T.MathUtils.clamp(walkWeight,0,1),run=T.MathUtils.clamp(runWeight,0,1);
   const turn=T.MathUtils.clamp(turnWeight,-1,1),air=T.MathUtils.clamp(airWeight,0,1);
   const cycle=time/3.6*Math.PI*2,step=Math.sin(cycle),sideSway=Math.cos(cycle);
   const stride=(.39+.13*run)*w;
   root.position.y=-.09+Math.abs(step)*(.024+.014*run)*w;
   waist.rotation.x=(.025+.018*run)*w;
   waist.rotation.y=.052*step*w+turn*.045;
   waist.rotation.z=.026*sideSway*w+turn*.05;
   pelvis.rotation.y=-.055*step*w;
   pelvis.rotation.z=-.024*sideSway*w;
   body.rotation.x=(.015+.025*run)*w;
   body.rotation.z=-.012*sideSway*w-turn*.018;
   head.rotation.x=-(.012+.018*run)*w;
   head.rotation.y=-waist.rotation.y*.55+Math.sin(time*.35)*.018;

   for(const {thigh,knee,foot,toe,side} of legs){
    const phase=cycle+(side===-1?0:Math.PI);
    const swing=Math.sin(phase),roll=Math.cos(phase);
    thigh.rotation.x=-stride*swing+.045*run*w;
    thigh.rotation.y=side*.025*swing*w;
    thigh.rotation.z=side*(.027+.018*roll)*w;
    knee.rotation.x=(.09+.58*Math.max(0,-swing))*(1+.16*run)*w;
    knee.rotation.z=-side*.012*w;
    foot.rotation.x=-thigh.rotation.x*.34-knee.rotation.x*.48+.065*roll*w;
    foot.rotation.z=-thigh.rotation.z*.45;
    toe.rotation.x=-.22*Math.max(0,roll)*w;
   }
   for(const {shoulder,elbow,wrist,handData,side} of arms){
    const swing=Math.sin(cycle+(side===-1?0:Math.PI));
    shoulder.rotation.x=-side*(.27+.07*run)*step*w;
    shoulder.rotation.y=side*(.025+.018*sideSway)*w;
    shoulder.rotation.z=side*(.12+.035*sideSway*w);
    elbow.rotation.x=-.15-(.10+.13*Math.max(0,-swing))*w;
    wrist.rotation.x=-shoulder.rotation.x*.20+.025*sideSway*w;
    wrist.rotation.y=side*.045*step*w;
    const curl=.12+(.08+.055*Math.max(0,swing))*w;
    const curls=handData.idleCurls;
    for(let f=0;f<4;f++)curls[f]=curl+.018*Math.sin(cycle+f*.55+side);
    setFingers(handData,curl,.012,curls);
   }
   if(air>0){
    root.position.y+=.035*air;
    waist.rotation.x=T.MathUtils.lerp(waist.rotation.x,.06,air);
    for(const {thigh,knee,foot,toe,side} of legs){
     thigh.rotation.x=T.MathUtils.lerp(thigh.rotation.x,side*.18,air);
     knee.rotation.x=T.MathUtils.lerp(knee.rotation.x,.46,air);
     foot.rotation.x=T.MathUtils.lerp(foot.rotation.x,-.19,air);
     toe.rotation.x=T.MathUtils.lerp(toe.rotation.x,-.10,air);
    }
    for(const {shoulder,elbow,wrist,side} of arms){
     shoulder.rotation.x=T.MathUtils.lerp(shoulder.rotation.x,-.34,air);
     shoulder.rotation.z+=side*.12*air;
     elbow.rotation.x=T.MathUtils.lerp(elbow.rotation.x,-.36,air);
     wrist.rotation.x+=.08*air;
    }
   }

  } else if (mode === 'idle') {
   waist.rotation.x=Math.sin(time*1.8)*.004;
   waist.rotation.z=Math.sin(time*.72)*.006;
   pelvis.rotation.y=Math.sin(time*.55)*.005;
   head.rotation.x=Math.sin(time*.88)*.012;
   for(const {shoulder,elbow,wrist,side} of arms){
    shoulder.rotation.x=Math.sin(time*.88+side)*.018;
    elbow.rotation.x=-.15+Math.sin(time*.73+side)*.012;
    wrist.rotation.x=Math.sin(time*.95-side)*.012;
   }

  } else if (mode === 'turn') {
   head.rotation.y = Math.sin(Math.min(time/4,1)*Math.PI)*.6;
   body.rotation.y = head.rotation.y*.2;
   for (const {handData} of arms) setFingers(handData, .15, .016);
  }
 }

 pose(0,'idle');
 return {root,joints,pose,dispose(){
  const gs=new Set(),ms=new Set(),ts=new Set();
  root.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of [].concat(o.material||[])){ms.add(m);for(const v of Object.values(m))if(v?.isTexture)ts.add(v);}});
  gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());ts.forEach(t=>t.dispose());
 }};
}
