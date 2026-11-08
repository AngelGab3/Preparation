import * as T from 'three';
import { state } from './state.js';
import { createExplorer } from './character-lab/character.js';

const ui=document.querySelector('#intro-cinematic');
const el=id=>ui.querySelector('#'+id);
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v);return v*v*(3-2*v)};
const mix=(a,b,t)=>a+(b-a)*t;
const V=(x,y,z)=>new T.Vector3(x,y,z);
const material=(color,metalness=0)=>new T.MeshStandardMaterial({color,roughness:.82,metalness,flatShading:true});
const cream=material(0xe9e3da), ink=material(0x293342), orange=material(0xd67852), brass=material(0xe7bd87,.25);
let active=false,playing=false,elapsed=0,lastFrame=0,elapsedTotal=0,ready=false;
let scene,camera,renderer,earthGroup,marsGroup,solarGroup,fpTerrain,explorer,actor,rocket,route,solarRocket,dust,outerStars;
let audioContext,audioMaster,musicLoop,prevPhase='',prevEarthBeat='',savedFocus,savedOrbit,siblings=[];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const duration=33;

function add(parent,geometry,mat,x=0,y=0,z=0){
 const mesh=new T.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function circleTerrain(group,earth){
 const n=96,steps=40,positions=[],colors=[],indices=[];
 const green=new T.Color(0x79935d),blue=new T.Color(0x385d6e),red=new T.Color(0xb85640),sand=new T.Color(0xe39a6f);
 for(let j=0;j<=steps;j++)for(let i=0;i<=n;i++){
  const r=3*j/steps,a=i/n*Math.PI*2,x=r*Math.cos(a),z=r*Math.sin(a);
  const h=Math.sin(x*2.2)*Math.cos(z*2.5)*.08+Math.sin(x*7+z*4)*.025;
  positions.push(x,h+.03,z);
  const wet=Math.sin(x*2.8+z)*Math.cos(z*3.4-x*1.2);
  const c=earth?(wet>.43?blue.clone():green.clone().multiplyScalar(1+.14*Math.sin(x*4+z*3))):red.clone().lerp(sand,.24+.26*Math.sin(x*3+z*4));
  colors.push(c.r,c.g,c.b);
  if(j<steps&&i<n){const k=j*(n+1)+i;indices.push(k,k+n+1,k+1,k+1,k+n+1,k+n+2)}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
 add(group,g,new T.MeshStandardMaterial({vertexColors:true,side:T.DoubleSide,roughness:1,flatShading:true}));
 const border=add(group,new T.TorusGeometry(3.025,.028,6,100),new T.MeshBasicMaterial({color:earth?0xdef1b7:0xffcaa1}),0,.02);border.rotation.x=Math.PI/2;
 const rim=add(group,new T.CylinderGeometry(3,2.94,.22,96,1,true),material(earth?0x405844:0x713c38),0,-.09);rim.material.side=T.DoubleSide;
 if(earth){
  for(let i=0;i<20;i++){const a=i*2.399,r=Math.sqrt((i+.3)/20)*2.6;
   const tuft=add(group,new T.ConeGeometry(.035,.11,5),material(i%3?0x496e4a:0xa9a56b),Math.cos(a)*r,.07,Math.sin(a)*r);tuft.rotation.z=.13;
  }
 }else{
  for(let i=0;i<35;i++){const a=i*2.399,r=Math.sqrt((i+.2)/35)*2.65;
   add(group,new T.DodecahedronGeometry(.035+(i%4)*.017,0),material(i%2?0x874940:0xd18961),Math.cos(a)*r,.07,Math.sin(a)*r);
  }
 }
}
function makeRocket(parent){
 const root=new T.Group();parent.add(root);
 add(root,new T.CylinderGeometry(.28,.34,1.85,16),cream,0,1.15);
 add(root,new T.ConeGeometry(.28,.56,16),orange,0,2.35);
 add(root,new T.CylinderGeometry(.35,.35,.18,16),ink,0,.17);
 add(root,new T.CylinderGeometry(.15,.15,.25,16),ink,0,-.02);
 for(let i=0;i<4;i++){const a=i*Math.PI/2;const fin=add(root,new T.BoxGeometry(.13,.7,.58),orange,Math.sin(a)*.29,.48,Math.cos(a)*.29);fin.rotation.y=a}
 for(const y of [.7,1.68]){const stripe=add(root,new T.TorusGeometry(.29,.025,5,28),brass,0,y);stripe.rotation.x=Math.PI/2}
 add(root,new T.SphereGeometry(.12,14,10),ink,0,1.83,.275);
 // Escotilla frontal y escalones: el personaje entra en el mismo volumen que despega.
 add(root,new T.BoxGeometry(.51,.84,.055),ink,0,1.12,.352);
 add(root,new T.BoxGeometry(.43,.76,.065),ink,0,1.12,.392);
 const hatchDoor=add(root,new T.BoxGeometry(.43,.76,.065),cream,0,1.12,.435);
 add(hatchDoor,new T.BoxGeometry(.26,.085,.012),orange,0,.19,.038);
 const steps=new T.Group();root.add(steps);steps.visible=false;
 for(let i=0;i<3;i++)add(steps,new T.BoxGeometry(.43,.055,.24),ink,0,.18+i*.18,1.0-i*.22);
 const nozzle=add(root,new T.ConeGeometry(.16,.8,10),new T.MeshBasicMaterial({color:0xffb660,transparent:true,opacity:.95}),0,-.42);nozzle.rotation.z=Math.PI;nozzle.visible=false;
 return {root,nozzle,hatchDoor,steps};
}
function globe(group,x,r,color,accent){
 const main=add(group,new T.SphereGeometry(r,24,16),material(color),x,0,0);
 for(let i=0;i<10;i++){const a=i*2.399,y=Math.sin(i*1.7)*r*.6;
  const patch=add(main,new T.DodecahedronGeometry(r*(.12+i%3*.035),0),material(accent),Math.cos(a)*r*.87,y,Math.sin(a)*r*.87);
  patch.scale.set(1.3,.45,.8);
 }
 return main;
}
function makeSolar(){
 solarGroup=new T.Group();scene.add(solarGroup);
 globe(solarGroup,-6.2,1.14,0xeabd69,0xffde9e);
 globe(solarGroup,-3.1,.57,0x326fa1,0x70a367);
 globe(solarGroup,3.2,.45,0xc56c4d,0xe69e74);
 const sun=solarGroup.children[0];sun.material.emissive=new T.Color(0xb66d33);sun.material.emissiveIntensity=.75;
 for(const r of [3.1,6.4]){const curve=new T.EllipseCurve(-6.2,0,r,r*.32,0,Math.PI*2);const points=curve.getPoints(120).map(v=>V(v.x,-.7,v.y));const line=new T.LineLoop(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:0x645362,transparent:true,opacity:.45}));solarGroup.add(line)}
 const points=[];for(let i=0;i<=90;i++){const u=i/90;points.push(V(mix(-3.1,3.2,u),.28+2.1*Math.sin(Math.PI*u),1.25+Math.sin(Math.PI*u)*.65))}
 route=new T.CatmullRomCurve3(points);
 const routeLine=new T.Line(new T.BufferGeometry().setFromPoints(route.getPoints(150)),new T.LineDashedMaterial({color:0xf9b68e,dashSize:.1,gapSize:.09,transparent:true,opacity:.85}));routeLine.computeLineDistances();solarGroup.add(routeLine);
 const marker=add(solarGroup,new T.SphereGeometry(.08,12,8),new T.MeshBasicMaterial({color:0xffe9b2}),-3.1,.3,1.25);marker.name='route-marker';
 solarRocket=makeRocket(solarGroup);solarRocket.root.scale.setScalar(.46);solarRocket.root.position.copy(points[0]);solarRocket.root.rotation.z=-Math.PI/2;solarRocket.nozzle.visible=true;
 const labelMaterial=new T.MeshBasicMaterial({color:0xf6d1b1});
 for(const [x,r] of [[-6.2,1.35],[-3.1,.78],[3.2,.65]]){const ring=add(solarGroup,new T.TorusGeometry(r,.008,4,60),labelMaterial,x,0);ring.rotation.x=Math.PI/2}
}
function makeFpTerrain(){
 const geometry=new T.PlaneGeometry(100,100,90,90);geometry.rotateX(-Math.PI/2);
 const pos=geometry.attributes.position,colors=[];
 const low=new T.Color(0x944333),high=new T.Color(0xd98257);
 for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),h=Math.sin(x*.5)*Math.cos(z*.4)*.34+Math.sin(x*1.8+z*1.1)*.11+Math.max(0,-z-9)*.025;
  pos.setY(i,h);const c=low.clone().lerp(high,clamp(.42+h*.38));colors.push(c.r,c.g,c.b)}
 geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
 fpTerrain=add(scene,geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:1,side:T.DoubleSide,flatShading:true}));fpTerrain.visible=false;
 for(let i=0;i<28;i++){const x=Math.sin(i*2.4)*((i%5)+2),z=-2-(i%7)*2;
  add(fpTerrain,new T.DodecahedronGeometry(.16+(i%4)*.1,0),material(i%2?0x763d35:0xb86649),x,.1,z);
 }
}
function makeParticles(){
 const positions=[];for(let i=0;i<350;i++){const a=i*2.399,r=Math.sqrt((i%90)/90)*4;positions.push(Math.cos(a)*r,(i%31)/31*2.5,Math.sin(a)*r)}
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));
 dust=new T.Points(geo,new T.PointsMaterial({color:0xe2a27b,size:.046,transparent:true,opacity:.8,depthWrite:false}));scene.add(dust);
 const stars=[];for(let i=0;i<200;i++)stars.push((Math.random()-.5)*24,(Math.random()-.5)*12,(Math.random()-.5)*14-2);
 outerStars=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(stars,3)),new T.PointsMaterial({color:0xc9aac2,size:.027}));scene.add(outerStars);
}
function initWorld(){
 scene=new T.Scene();scene.background=new T.Color(0x1a2430);scene.fog=new T.Fog(0x1a2430,16,65);
 camera=new T.PerspectiveCamera(42,innerWidth/innerHeight,.04,120);
 renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.shadowMap.enabled=true;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.22;el('signal-3d-stage').appendChild(renderer.domElement);
 scene.add(new T.HemisphereLight(0xffe1bd,0x4a5260,2.5));const sun=new T.DirectionalLight(0xffefc9,3);sun.position.set(4,8,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-12;sun.shadow.camera.right=12;sun.shadow.camera.top=12;sun.shadow.camera.bottom=-12;scene.add(sun);
 earthGroup=new T.Group();scene.add(earthGroup);circleTerrain(earthGroup,true);
 marsGroup=new T.Group();scene.add(marsGroup);circleTerrain(marsGroup,false);
 makeSolar();makeFpTerrain();makeParticles();
 rocket=makeRocket(scene);rocket.root.scale.setScalar(1.45);rocket.root.position.set(1.1,.15,-.2);
 explorer=createExplorer();actor=new T.Group();actor.position.set(-1.5,0,.35);actor.add(explorer.root);scene.add(actor);
 const grid=new T.GridHelper(40,40,0x5d6970,0x40505d);grid.position.y=-.24;scene.add(grid);
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
 const ray=new T.Raycaster(),p=new T.Vector2();
 renderer.domElement.addEventListener('pointerup',e=>{if(!active||playing||ready)return;p.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(p,camera);if(ray.intersectObjects([rocket.root,actor],true).length)start()});
 requestAnimationFrame(frame);
}
function audioOn(){
 if(audioContext)return;
 try{audioContext=new (window.AudioContext||window.webkitAudioContext)();audioMaster=audioContext.createGain();audioMaster.gain.value=.24;audioMaster.connect(audioContext.destination);
 const chord=[110,164.8,220];for(const [i,f] of chord.entries()){const o=audioContext.createOscillator(),g=audioContext.createGain();o.type=i?'sine':'triangle';o.frequency.value=f;g.gain.value=i===0?.08:.02;o.connect(g).connect(audioMaster);o.start()}
 musicLoop=setInterval(()=>{if(!active||!audioContext)return;tone([220,261.6,329.6,392][Math.floor(elapsedTotal*1.5)%4],.7,.04)},680);
 }catch{audioContext=null}
}
function tone(f,d=.3,volume=.12,type='sine'){if(!audioContext)return;const t=audioContext.currentTime,o=audioContext.createOscillator(),g=audioContext.createGain();o.type=type;o.frequency.setValueAtTime(f,t);if(type==='sawtooth')o.frequency.exponentialRampToValueAtTime(f*2,t+d);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(volume,t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+d);o.connect(g).connect(audioMaster);o.start(t);o.stop(t+d+.02)}
function syncAudioLabel(){const on=audioContext&&audioMaster.gain.value>0;el('signal-sound').textContent=on?'♪ SONIDO ACTIVADO':'♪ ACTIVAR SONIDO';el('signal-sound').setAttribute('aria-pressed',String(!!on))}
function setText(chapter,title,sub,hint){el('signal-kicker').textContent=chapter;el('signal-title').textContent=title;el('signal-subtitle').textContent=sub;el('signal-hint').textContent=hint}
function start(){if(playing)return;playing=true;ready=false;elapsed=0;prevPhase='';prevEarthBeat='';el('signal-start').hidden=true;el('signal-continue').hidden=true;ui.classList.add('is-running');if(!reduced)audioOn();syncAudioLabel()}
function finish(){if(ready)return;ready=true;playing=false;ui.classList.add('is-ready');setText('04 / SUPERFICIE MARCIANA','EL NUEVO HORIZONTE','El terreno te espera. Continúa al mapa para explorar.','VISOR EVA ACTIVO · SUPERFICIE DISPONIBLE');el('signal-continue').hidden=false;el('signal-skip').hidden=true;el('signal-continue').focus({preventScroll:true});tone(392,.6,.06)}
function reset(){playing=false;ready=false;elapsed=0;prevPhase='';prevEarthBeat='';ui.classList.remove('is-ready','is-running','is-visor');el('signal-start').hidden=false;el('signal-continue').hidden=true;el('signal-skip').hidden=false;setText('01 / TIERRA','LA MISIÓN COMIENZA','Haz clic en el astronauta o en el cohete para comenzar.','PULSA UNA FIGURA PARA INICIAR');}
function phaseUpdate(phase){
 if(phase===prevPhase)return;prevPhase=phase;ui.dataset.phase=phase;
 if(phase==='earth')setText('01 / TIERRA','EL PRIMER PASO','El astronauta se dirige al cohete.','RUMBO A MARTE · PREPARANDO DESPEGUE');
 if(phase==='solar'){setText('02 / VIAJE INTERPLANETARIO','RUMBO A MARTE','Sigue la ruta punteada a través del sistema solar.','TRAYECTORIA TIERRA → MARTE');tone(70,2.2,.08,'sawtooth')}
 if(phase==='mars'){setText('03 / ATERRIZAJE','MARTE A LA VISTA','El cohete toca suelo y el astronauta desciende.','APROXIMACIÓN FINAL · SUPERFICIE MARCIANA');tone(90,1.5,.07,'sawtooth')}
 if(phase==='visor'){setText('04 / VISOR EVA','UN NUEVO MUNDO','La cámara entra en el casco. El paisaje se abre ante ti.','TRANSICIÓN A PRIMERA PERSONA');tone(280,.8,.05)}
}
function frame(now){
 requestAnimationFrame(frame);const dt=Math.min(.05,(now-lastFrame)/1000||0);lastFrame=now;if(!active)return;
 elapsedTotal+=dt;if(playing&&!ready){elapsed=Math.min(duration,elapsed+dt);if(elapsed>=duration)finish()}
 const t=elapsed,phase=t<8?'earth':t<17?'solar':t<26?'mars':'visor';phaseUpdate(phase);
 const inEarth=phase==='earth',inSolar=phase==='solar',inMars=phase==='mars',inVisor=phase==='visor';
 earthGroup.visible=inEarth;solarGroup.visible=inSolar;marsGroup.visible=inMars||inVisor;
 fpTerrain.visible=inVisor&&t>29;
 outerStars.visible=inSolar;dust.visible=!inSolar;
 scene.background.setHex(inSolar?0x100f20:inEarth?0x1a2430:0x35232b);
 scene.fog.color.copy(scene.background);
 const launch=ease((t-5.85)/2.15),travel=ease((t-8)/9),land=ease((t-17)/5.5);
 if(inEarth){
  const approach=ease((t-1.2)/2.25),board=ease((t-4.05)/1.5);
  const facing=ease((t-.35)/.95),toHatch=ease((t-3.35)/.65);
  const doorOpen=ease((t-3.3)/.45)*(1-ease((t-5.35)/.42));
  actor.visible=t<5.55;
  actor.position.set(mix(-1.5,1.1,approach),mix(0,.62,board),mix(.35,1.24,approach)-1.04*board);
  actor.rotation.y=mix(0,Math.PI/2,facing)+Math.PI/2*toHatch;
  actor.scale.setScalar(mix(1,.68,board));
  const gait=ease((t-1.05)/.35)*(1-ease((t-3.2)/.42))
   +ease((t-3.9)/.25)*(1-ease((t-5.24)/.24));
  const turn=(ease((t-.35)/.95)-ease((t-1.3)/.35))
   +(ease((t-3.35)/.65)-ease((t-4.0)/.3));
  explorer.pose(Math.max(0,t-1.05)*4.6,'locomotion',clamp(gait),0,clamp(turn));
  rocket.root.visible=true;
  rocket.root.position.set(1.1,.15+launch*13,-.2);
  rocket.root.rotation.set(0,0,-launch*.18);
  rocket.hatchDoor.position.x=.55*doorOpen;
  rocket.steps.visible=doorOpen>.015;
  rocket.nozzle.visible=t>5.85;
  const beat=t<3.35?'camino':t<5.55?'abordaje':'despegue';
  if(beat!==prevEarthBeat&&playing){prevEarthBeat=beat;
   if(beat==='abordaje'){setText('01 / TIERRA','A BORDO','El astronauta gira y sube al cohete.','ESCOTILLA ABIERTA · SISTEMAS LISTOS');tone(390,.22,.045)}
   if(beat==='despegue'){setText('01 / TIERRA','DESPEGUE','La misión deja atrás la Tierra.','TRAYECTORIA A MARTE INICIADA');tone(78,1.8,.08,'sawtooth')}
  }
  camera.position.set(5.8+launch*.7,5.5+launch*1.2,9.6+launch*1.6);
  camera.lookAt(.15,.92+launch*1.8,0);
 }else if(inSolar){
  actor.visible=false;rocket.root.visible=false;solarRocket.root.position.copy(route.getPoint(travel));solarRocket.root.rotation.z=-Math.PI/2;solarRocket.nozzle.visible=true;
  solarGroup.children.find(c=>c.name==='route-marker').position.copy(route.getPoint(travel));
  camera.position.set(0,4.7,15.5);camera.lookAt(-1,.25,0);
 }else if(inMars){
  const open=ease((t-21.35)/.6)*(1-ease((t-25.35)/.5));
  const emerge=ease((t-22.05)/1.15),leave=ease((t-23.15)/2.65);
  marsGroup.scale.setScalar(1+land*.1);
  actor.visible=t>22.05;
  actor.position.set(mix(1.35,.05,leave),mix(.62,0,emerge),mix(.08,1.24,emerge)-1.04*leave);
  actor.rotation.y=Math.PI+Math.PI/2*ease((t-23.0)/.7);
  actor.scale.setScalar(mix(.68,1,emerge));
  const gait=ease((t-22.08)/.25)*(1-ease((t-25.55)/.35));
  explorer.pose(Math.max(0,t-22.08)*4.6,'locomotion',gait,0,ease((t-23.0)/.7)*(1-ease((t-23.7)/.3)));
  rocket.root.visible=true;rocket.root.position.set(1.35,.15+(1-land)*5.5,-.2);rocket.root.rotation.set(0,0,(1-land)*.14);
  rocket.hatchDoor.position.x=.55*open;rocket.steps.visible=open>.015;
  rocket.nozzle.visible=t<22;
  camera.position.set(mix(5.5,4.1,land),mix(7.3,3.2,land),mix(10,7.5,land));camera.lookAt(0,mix(1.8,.65,land),0);
 }else{
  rocket.root.visible=t<30;actor.visible=t<30;
  rocket.hatchDoor.position.x=0;rocket.steps.visible=false;
  explorer.pose(elapsedTotal,'idle');actor.position.set(.05,0,.2);actor.rotation.y=Math.PI*1.5;actor.scale.setScalar(1);
  const toward=ease((t-26)/3.6);
  marsGroup.scale.setScalar(1+ease((t-26)/3.1)*6);
  const from=V(3.8,3.1,6.4),to=V(.05,1.7,.45);camera.position.copy(from.lerp(to,toward));
  camera.fov=mix(42,68,toward);camera.updateProjectionMatrix();
  camera.lookAt(V(mix(0,.05,toward),mix(.8,1.45,toward),mix(0,-8,toward)));
  if(t>29){ui.classList.add('is-visor');fpTerrain.visible=true}
 }
 if(!inVisor&&camera.fov!==42){camera.fov=42;camera.updateProjectionMatrix();ui.classList.remove('is-visor')}
 const arr=dust.geometry.attributes.position;for(let i=0;i<arr.count;i++){let y=arr.getY(i)+dt*(.22+(i%7)*.06);if(y>3.4)y=.01;arr.setY(i,y)}arr.needsUpdate=true;dust.rotation.y+=dt*.06;
 renderer.render(scene,camera);
}
export const isIntroCinematicActive=()=>active;
export function initIntroCinematic(){
 if(!ui)return;initWorld();
 el('signal-start').onclick=start;el('signal-continue').onclick=stopIntroCinematic;el('signal-skip').onclick=stopIntroCinematic;el('signal-replay').onclick=reset;
 el('signal-sound').onclick=()=>{if(!audioContext){audioOn();audioContext?.resume()}else audioMaster.gain.value=audioMaster.gain.value>0?0:.24;syncAudioLabel()};
 document.getElementById('replay-cinematic-btn')?.addEventListener('click',()=>startIntroCinematic());
 document.addEventListener('visibilitychange',()=>{if(!audioContext)return;if(document.hidden)audioContext.suspend();else if(active)audioContext.resume()});
 if(new URLSearchParams(location.search).get('nointro')!=='1')startIntroCinematic();
}
export function startIntroCinematic(){
 if(active||state.mode==='fp')return;active=true;elapsedTotal=0;reset();
 savedFocus=document.activeElement;savedOrbit=state.orbitControls.enabled;state.orbitControls.enabled=false;
 siblings=[...document.body.children].filter(node=>node!==ui&&!['SCRIPT','STYLE'].includes(node.tagName)).map(node=>[node,node.inert]);siblings.forEach(([node])=>node.inert=true);
 document.body.classList.add('intro-playing');ui.classList.remove('hidden');el('signal-start').focus({preventScroll:true});
}
export function tickIntroCinematic(){}
export function stopIntroCinematic(){
 if(!active)return;active=false;ui.classList.add('hidden');document.body.classList.remove('intro-playing');siblings.forEach(([node,inert])=>node.inert=inert);siblings=[];state.orbitControls.enabled=savedOrbit;
 if(audioContext){clearInterval(musicLoop);audioContext.close();audioContext=null;audioMaster=null}
 playing=false;syncAudioLabel();
 (savedFocus?.tagName==='BUTTON'?savedFocus:document.getElementById('mode-btn'))?.focus({preventScroll:true});
}
