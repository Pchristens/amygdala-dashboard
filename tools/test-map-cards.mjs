// Execute the real map callbacks and card/drawer dismissal handlers, without WebGL or a server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const handlers=[],calls=[],card={info:null,pinned:false};
const cardEl={hidden:true,textContent:'',children:[],classList:{toggle(){}},addEventListener(){},append(...x){this.children.push(...x)},appendChild(x){this.children.push(x)},contains(n){return !!n&&this.children.includes(n)}};
const document={activeElement:null,querySelector:()=>null,addEventListener:(type,fn)=>{if(type==='keydown')handlers.push(fn)}};
const context=vm.createContext({card,cardEl,document,state:{},gift:{active:false},map:{pulseAt:()=>calls.push('pulse'),setHover:x=>calls.push(['hover',x])},api:()=>calls.push('move'),placeGift:()=>calls.push('gift'),setGiftMode:()=>calls.push('cancel gift'),h:(tag,props)=>({tag,...props}),buildCard:()=>[],cardPlaceName:()=>null,repositionCard(){},drawerOpen:true,setDrawer(open){context.drawerOpen=open;calls.push('drawer')},panel:{},zoneNav:{dataset:{}}});
vm.runInContext(app.slice(app.indexOf('const mapOpts ='),app.indexOf('async function makeMap')),context);
vm.runInContext(app.slice(app.indexOf('function pinCard('),app.indexOf('// The map\'s place label')),context);
const keyStart=app.indexOf("document.addEventListener('keydown'",app.indexOf('// resize by dragging'));
vm.runInContext(app.slice(keyStart,app.indexOf('{ const pref = loadPref(); if (pref.open)',keyStart)),context);
const run=code=>vm.runInContext(code,context),fails=[];
function test(name,f){try{f();console.log('ok:',name)}catch(e){fails.push(name);console.error('FAIL:',name,e.message)}}
function open(){cardEl.children=[];run("showCard({type:'resident',id:'Synthetic'},true)");calls.length=0;}
function escape(){for(const fn of handlers)fn({key:'Escape',preventDefault(){}})}
test('hover never opens a card, only highlights',()=>{run("mapOpts.onHover({type:'resident',id:'Synthetic'})");assert.equal(cardEl.hidden,true);assert.equal(JSON.stringify(calls.at(-1)),JSON.stringify(['hover',{type:'resident',id:'Synthetic'}]));});
test('hover leaving does not close an open card',()=>{open();run('mapOpts.onHover(null)');assert.equal(cardEl.hidden,false);});
test('first Escape closes card only; second closes drawer',()=>{open();context.drawerOpen=true;escape();assert.equal(cardEl.hidden,true);assert.equal(context.drawerOpen,true);escape();assert.equal(context.drawerOpen,false);});
test('ground dismisses open card without walking or pulsing',()=>{open();run('mapOpts.onGroundClick(1,2)');assert.equal(cardEl.hidden,true);assert.deepEqual(calls,[]);run('mapOpts.onGroundClick(1,2)');assert.deepEqual(calls,['pulse','move']);});
test('ground dismissal wins over gift placement',()=>{open();context.gift.active=true;run('mapOpts.onGroundClick(1,2)');assert.equal(cardEl.hidden,true);assert.deepEqual(calls,[]);context.gift.active=false;});
test('every opened card has a close control',()=>{cardEl.children=[];run("showCard({type:'resident',id:'Synthetic'},false)");assert(cardEl.children.some(n=>n.class?.includes('card-close')));});
test('3D hover highlights names and minor places; pointerleave clears them',()=>{
  const source=fs.readFileSync(new URL('../public/map3d.js',import.meta.url),'utf8');
  const label=()=>({classList:{values:new Set(),toggle(k,on){if(on)this.values.add(k);else this.values.delete(k)}}});
  const resident=label(),worker=label(),place=label(),events={},canvas={style:{},addEventListener:(type,fn)=>events[type]=fn};
  const ctx=vm.createContext({renderer:{domElement:canvas},figures:new Map([['resident:Synthetic',{F:{label:resident}}],['god:hero',{F:{label:worker}}]]),placeLabels:new Map([['square',{element:place}]]),figureKey:(type,id)=>`${type}:${id}`,hoverStele:null,setSteleHover(){},declutter(){},startLoop(){},needsRender:false,opts:{onHover:info=>assert.equal(info,null)}});
  vm.runInContext(source.slice(source.indexOf('  let hovered = null;'),source.indexOf("  controls.addEventListener('change'")),ctx);
  vm.runInContext("setHover({type:'resident',id:'Synthetic'})",ctx);
  assert(resident.classList.values.has('hover'));assert.equal(canvas.style.cursor,'pointer');
  vm.runInContext("setHover({type:'worker',id:'hero'})",ctx);
  assert(worker.classList.values.has('hover'));assert(!resident.classList.values.has('hover'));
  vm.runInContext("setHover({type:'place',id:'square'})",ctx);
  assert(place.classList.values.has('hover'));assert(!worker.classList.values.has('hover'));
  events.pointerleave();assert(!place.classList.values.has('hover'));assert.equal(canvas.style.cursor,'');
});
assert.equal(fails.length,0,`${fails.length} map card regressions`);
