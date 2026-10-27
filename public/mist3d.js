import * as THREE from 'three';
import { groundHeight } from './scene3d.js';

// Deterministic state clock: snapshots do not reset the idle timer unless an agent is active.
export class VillageClock {
  constructor(now=0) { this.lastActive=now; this.state='awake'; this.wakeAt=-Infinity; this.wake={x:440,y:420}; this.wasActive=false; }
  update(snapshot,now) {
    const turn=snapshot?.world?.activeTurns?.[0]||snapshot?.world?.activeTurn;
    const hero=(snapshot?.workers||[]).find(w=>w.status==='running');
    const active=!!turn||!!hero;
    if(active) {
      this.lastActive=now;
      if(!this.wasActive) { this.wakeAt=now; this.wake=(snapshot.residents||[]).find(r=>r.name===turn?.resident)||hero||this.wake; }
    }
    this.wasActive=active;
    this.state=snapshot?.world?.paused?'paused':now-this.lastActive>=20000?'idle':'awake';
    return {state:this.state, density:active?0:this.state==='paused'?0.06:this.state==='idle'?0.045:0};
  }
}
// Low ground mist only (ART.md consensus): a few wide, feathered sheets lying in the hollows between buildings,
// never a cover. Thin enough that roofs, paths, figures and the Almond stay fully legible; it drifts very slowly.
export function createMist(scene) {
  const group=new THREE.Group(); scene.add(group);
  const clock=new VillageClock(performance.now());
  const positions=[[575,350,150,90],[650,520,170,100],[250,650,150,90],[170,505,140,90],[300,330,160,90],[455,690,140,80],[800,650,150,90],[870,440,140,80]];
  const pools=positions.map(([x,z,w,d],i)=>{
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
      uniforms:{opacity:{value:0},time:{value:0},tint:{value:new THREE.Color('#EEEAE0')}},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 vUv; uniform float opacity; uniform float time; uniform vec3 tint; void main(){vec2 p=vUv*2.-1.;float r=length(p*vec2(1.,1.15));float edge=1.-smoothstep(.0,1.,r);edge*=edge;float wisps=.55+.45*sin(p.x*5.5+sin(p.y*4.+time*.7)*1.6+time);float wisps2=.7+.3*sin(p.y*7.-time*.6+p.x*3.);float a=edge*pow(wisps*wisps2,1.6);gl_FragColor=vec4(tint,opacity*a);}' });
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,d),material);
    mesh.rotation.x=-Math.PI/2;mesh.position.set(x,groundHeight(x,z)+1.2,z); mesh.renderOrder=3;group.add(mesh);
    return {mesh,x,z,phase:i*1.7,opacity:0};
  });
  let density=0;
  const dayTint=new THREE.Color('#F1ECE2'), nightTint=new THREE.Color('#B9C3D8');
  return {clock,tick(snapshot,now,dt,light){
    const result=clock.update(snapshot,now);
    const ds=dt/1000;
    density += Math.sign(result.density-density)*Math.min(Math.abs(result.density-density),ds*.075/8);
    const night=!!light?.night;
    for(const p of pools) {
      const radius=Math.hypot(p.x-clock.wake.x,p.z-clock.wake.y);
      const clear=Math.max(0,Math.min(1,(now-clock.wakeAt-radius/850*900)/700));
      if(result.density===0) p.opacity=Math.min(p.opacity,density)*(1-clear);
      else p.opacity=density;
      const speed=result.state==='paused'?.02:.09;
      p.mesh.position.x=p.x+Math.sin(now/1000*speed+p.phase)*6;
      p.mesh.position.z=p.z+Math.cos(now/1000*speed*.7+p.phase)*3;
      p.mesh.material.uniforms.time.value=now/1000*speed+p.phase;
      p.mesh.material.uniforms.opacity.value=p.opacity*(night?1.35:1);
      p.mesh.material.uniforms.tint.value.copy(night?nightTint:dayTint);
      p.mesh.visible=p.opacity>.001;
    }
    if(result.density===0&&now-clock.wakeAt>2000) density=0;
    return result.state;
  }};
}
