import * as T from 'three';
import { state } from './state.js';
import { createExplorer } from './character-lab/character.js';
const $=s=>document.querySelector(s), ui=$('#intro-cinematic');
let active=false, started=false, elapsed=0, total=0, last=0, savedFocus, savedOrbit, siblings=[];
let renderer,scene,camera,astronaut,rocket,flame,portal,ring,dust,stars, sound, ctx, musicTimer;
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x)};
const mat=(c,metal=0)=>new T.MeshStandardMaterial({color:c,roughness:.73,metalness:metal,flatShading:true});
const orange=mat(0xd96740), cream=mat(0xe9ddd0),dark=mat(0x292331),bronze=mat(0xf1bb69,.25);
function mesh(parent,g,m,x=0,y=0,z=0){const o=new T.Mesh(g,m);o.position.set(x,y,z);o.castShadow=true;parent.add(o);return o}
function makeRocket(){
 const g=new T.Group();g.position.set(.75,.3,-.2);scene.add(g);
 mesh(g,new T.CylinderGeometry(.17,.21,1.05,12),cream,0,.63);
 mesh(g,new T.ConeGeometry(.175,.38,12),orange,0,1.34);
 mesh(g,new T.CylinderGeometry(.21,.21,.14,12),dark,0,.09);
 mesh(g,new T.CylinderGeometry(.07,.07,.3,12),dark,0,-.12);
 for(let i=0;i<3;i++){const f=mesh(g,new T.BoxGeometry(.09,.38,.33),orange,0,.27,.26);f.rotation.y=i*Math.PI*2/3;f.position.set(Math.sin(i*Math.PI*2/3)*.2,.28,Math.cos(i*Math.PI*2/3)*.2)}
 for(let y of [.42,.85]) mesh(g,new T.TorusGeometry(.18,.018,5,24),bronze,0,y).rotation.x=Math.PI/2;
 mesh(g,new T.SphereGeometry(.09,12,8),dark,0,.82,.174);
 flame=mesh(g,new T.ConeGeometry(.12,.65,9),new T.MeshBasicMaterial({color:0xffbd66,transparent:true,opacity:.9}),0,-.46);
 flame.rotation.z=Math.PI;flame.visible=false;
 return g;
}
function makePortal(){
 const n=72,rings=42,positions=[],colors=[],indices=[];
 const center=new T.Color(0xf18d57),edge=new T.Color(0x883d40);
 for(let j=0;j<=rings;j++){const r=j/rings*3;for(let i=0;i<=n;i++){const a=i/n*Math.PI*2,x=Math.cos(a)*r,z=Math.sin(a)*r;
 const noise=Math.sin(x*2.7)*Math.cos(z*3.1)*.12+Math.sin(x*8+z*5)*.035;
 const y=.03+noise*(.15+.85*j/rings);
 positions.push(x,y,z);const c=center.clone().lerp(edge,j/rings*.82+Math.sin(a*7+r*5)*.07);colors.push(c.r,c.g,c.b);
 if(j<rings&&i<n){let k=j*(n+1)+i;indices.push(k,k+n+1,k+1,k+1,k+n+1,k+n+2)}
 }}
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
 portal=mesh(scene,geo,new T.MeshStandardMaterial({vertexColors:true,roughness:1,side:T.DoubleSide,flatShading:true}));portal.scale.setScalar(.84);portal.receiveShadow=true;
 ring=mesh(scene,new T.TorusGeometry(3.02,.024,6,96),new T.MeshBasicMaterial({color:0xffdcb0}),0,.015);ring.rotation.x=Math.PI/2;ring.scale.setScalar(.84);
 const rim=mesh(scene,new T.CylinderGeometry(2.96,2.85,.16,72,1,true),mat(0x62343c),0,-.1);rim.scale.set(.84,1,.84);rim.material.side=T.DoubleSide;
 return rim;
}
function particles(){
 const count=260,p=new Float32Array(count*3);for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*2.7;p[i*3]=Math.cos(a)*r;p[i*3+1]=Math.random()*1.8;p[i*3+2]=Math.sin(a)*r}
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.BufferAttribute(p,3));
 dust=new T.Points(geo,new T.PointsMaterial({color:0xffba78,size:.055,transparent:true,opacity:.8,depthWrite:false}));scene.add(dust);
 const sp=[];for(let i=0;i<160;i++)sp.push((Math.random()-.5)*20,Math.random()*6-1,(Math.random()-.5)*20);
 const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(sp,3));stars=new T.Points(sg,new T.PointsMaterial({color:0x8d637e,size:.025}));scene.add(stars);
}
function initScene(){
 scene=new T.Scene();scene.background=new T.Color(0x201824);scene.fog=new T.Fog(0x201824,9,22);
 camera=new T.PerspectiveCamera(38,innerWidth/innerHeight,.1,60);camera.position.set(5.6,5.2,8);camera.lookAt(0,.65,0);
 renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;$('#signal-3d-stage').appendChild(renderer.domElement);
 scene.add(new T.HemisphereLight(0xffc69d,0x312a42,2.7));const sun=new T.DirectionalLight(0xffd1a8,3);sun.position.set(4,8,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=9;sun.shadow.camera.bottom=-9;scene.add(sun);
 const grid=new T.GridHelper(40,40,0x754262,0x61344d);grid.position.y=-.22;scene.add(grid);
 makePortal();rocket=makeRocket();astronaut=createExplorer();astronaut.root.position.x=-.77;astronaut.root.position.z=.25;scene.add(astronaut.root);particles();
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
 const ray=new T.Raycaster(),pointer=new T.Vector2();
 renderer.domElement.addEventListener('pointerup',e=>{if(started||!active)return;pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(pointer,camera);if(ray.intersectObjects([rocket,astronaut.root],true).length)launch()});
 renderer.domElement.style.cursor='pointer';requestAnimationFrame(frame);
}
function audioOn(){
 if(sound)return;ctx=new AudioContext();const master=ctx.createGain();master.gain.value=.16;master.connect(ctx.destination);
 const tones=[110,164.81,220,261.63],osc=[];
 tones.forEach((f,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type=i?'sine':'triangle';o.frequency.value=f;g.gain.value=i===0?.08:.024;o.connect(g).connect(master);o.start();osc.push(o)});
 musicTimer=setInterval(()=>{if(!active||!ctx)return;const t=ctx.currentTime,o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=tones[Math.floor(total*1.2)%tones.length]*2;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.04,t+.04);g.gain.exponentialRampToValueAtTime(.0001,t+.8);o.connect(g).connect(master);o.start(t);o.stop(t+.85)},700);
 sound={master,osc};
}
function whoosh(){if(!ctx)return;const t=ctx.currentTime,o=ctx.createOscillator(),g=ctx.createGain();o.type='sawtooth';o.frequency.setValueAtTime(65,t);o.frequency.exponentialRampToValueAtTime(240,t+1.7);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.055,t+.12);g.gain.exponentialRampToValueAtTime(.0001,t+2.4);o.connect(g).connect(sound.master);o.start(t);o.stop(t+2.5)}
function launch(){if(started)return;started=true;elapsed=0;$('#signal-start').hidden=true;$('#signal-hint').textContent='DESPEGUE EN CURSO · ABRIENDO SUPERFICIE';ui.classList.add('launched');if(!reduce){audioOn();$('#signal-sound').textContent='♪ SONIDO ACTIVADO';$('#signal-sound').setAttribute('aria-pressed','true');whoosh()}else{elapsed=7;ready()}}
function ready(){ui.classList.add('ready');$('#signal-hint').textContent='SUPERFICIE MARCIANA DISPONIBLE';$('#signal-continue').hidden=false;$('#signal-continue').focus({preventScroll:true})}
function frame(now){requestAnimationFrame(frame);const dt=Math.min(.05,(now-last)/1000||0);last=now;if(!active)return;
 total+=dt;if(started&&elapsed<7.1){elapsed+=dt;if(elapsed>=7.1)ready()}
 const t=elapsed,open=smooth((t-.25)/3.3),lift=Math.max(0,t-.35);portal.scale.setScalar(.84+open*3.1);ring.scale.setScalar(.84+open*3.1);
 rocket.position.y=.3+lift*lift*.27;rocket.rotation.z=-Math.min(.42,lift*.08);flame.visible=started&&t<6;flame.scale.y=.8+Math.sin(total*28)*.2;
 astronaut.root.position.x=-.77;astronaut.root.position.z=.25;astronaut.pose(total%5,'idle');
 const arr=dust.geometry.attributes.position;for(let i=0;i<arr.count;i++){let y=arr.getY(i)+dt*(.25+(i%9)*.06);if(y>3.2)y=.02;arr.setY(i,y)}arr.needsUpdate=true;dust.rotation.y+=dt*.04;
 camera.position.x=5.6+open*.8;camera.position.y=5.2+open*1.5;camera.position.z=8+open*2;camera.lookAt(0,.55,0);renderer.render(scene,camera);
}
export const isIntroCinematicActive=()=>active;
export function initIntroCinematic(){
 if(!ui)return;initScene();$('#signal-start').onclick=launch;$('#signal-continue').onclick=stopIntroCinematic;
 $('#signal-sound').onclick=async e=>{if(!ctx){audioOn();await ctx.resume();e.currentTarget.textContent='♪ SONIDO ACTIVADO';e.currentTarget.setAttribute('aria-pressed','true')}else{const muted=sound.master.gain.value>0;sound.master.gain.value=muted?0:.16;e.currentTarget.textContent=muted?'♪ ACTIVAR SONIDO':'♪ SONIDO ACTIVADO';e.currentTarget.setAttribute('aria-pressed',String(!muted))}};
 $('#signal-replay').onclick=()=>{started=false;elapsed=0;ui.classList.remove('ready','launched');$('#signal-start').hidden=false;$('#signal-continue').hidden=true;$('#signal-hint').textContent='PULSA EL ASTRONAUTA O EL COHETE PARA COMENZAR';rocket.position.y=.3;rocket.rotation.z=0;portal.scale.setScalar(.84);ring.scale.setScalar(.84)};
 document.getElementById('replay-cinematic-btn')?.addEventListener('click',()=>startIntroCinematic(true));
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&ctx)ctx.suspend();else if(active&&ctx)ctx.resume()});
 const params=new URLSearchParams(location.search);if(params.get('nointro')!=='1')startIntroCinematic();
}
export function startIntroCinematic(){if(active||state.mode==='fp')return;active=true;started=false;elapsed=0;total=0;ui.classList.remove('ready','launched');$('#signal-start').hidden=false;$('#signal-continue').hidden=true;
 savedFocus=document.activeElement;savedOrbit=state.orbitControls.enabled;state.orbitControls.enabled=false;siblings=[...document.body.children].filter(el=>el!==ui&&!['SCRIPT','STYLE'].includes(el.tagName)).map(el=>[el,el.inert]);siblings.forEach(([el])=>el.inert=true);document.body.classList.add('intro-playing');ui.classList.remove('hidden');$('#signal-start').focus({preventScroll:true})}
export function tickIntroCinematic(){}
export function stopIntroCinematic(){if(!active)return;active=false;ui.classList.add('hidden');document.body.classList.remove('intro-playing');siblings.forEach(([el,v])=>el.inert=v);siblings=[];state.orbitControls.enabled=savedOrbit;
 if(ctx){clearInterval(musicTimer);sound.osc.forEach(o=>o.stop());ctx.close();ctx=null;sound=null}try{sessionStorage.setItem('marswalk.signal.v3','seen')}catch{}(savedFocus?.tagName==='BUTTON'?savedFocus:document.getElementById('mode-btn'))?.focus({preventScroll:true})}
