// Real app handlers, synthetic geometry: no server, models or browser dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const listeners = {}, windowListeners = {}, ids = {}, captures = [];
function el(id) { return ids[id] ||= { hidden: id === 'gear-pop', attrs: {}, listeners: {}, style: {}, offsetWidth: 320, classList: { toggle() {} }, setAttribute(k,v) { this.attrs[k] = String(v); }, addEventListener(k,f) { this.listeners[k] = f; }, contains(target) { return target === this; }, focus() { document.activeElement = this; }, getBoundingClientRect() { return { left: 840, right: 872, top: 80, bottom: 112 }; } }; }
const document = { activeElement: null, addEventListener(k,f,capture) { (listeners[k] ||= []).push(f); if (capture) captures.push(k); } };
const window = { innerWidth: 900, innerHeight: 740, addEventListener(k,f) { (windowListeners[k] ||= []).push(f); } };
for (const [,k,v] of html.match(/<button[^>]*id="gear-btn"[^>]*>/)[0].matchAll(/(aria-[\w-]+)="([^"]*)"/g)) el('gear-btn').setAttribute(k,v);
const context = vm.createContext({ $: el, document, window, innerWidth:900, innerHeight:740 });
const start = app.indexOf('\n', app.indexOf('const bellPresence')) + 1;
vm.runInContext(app.slice(start, app.indexOf("$('pace').addEventListener", start)), context);
const click = () => el('gear-btn').listeners.click({target:el('gear-btn')});
const fails=[];
function test(name,fn) { try { fn(); console.log('ok:',name); } catch(e) { fails.push(name); console.error('FAIL:',name,e.message); } }
test('gear starts collapsed and names its controlled popover', () => { assert.equal(el('gear-btn').attrs['aria-expanded'],'false'); assert.equal(el('gear-btn').attrs['aria-controls'],'gear-pop'); });
test('gear click opens with expanded state', () => { click(); assert.equal(el('gear-pop').hidden,false); assert.equal(el('gear-btn').attrs['aria-expanded'],'true'); });
test('Escape closes gear and returns focus', () => { for(const fn of listeners.keydown || []) fn({key:'Escape',preventDefault(){},stopImmediatePropagation(){}}); assert.equal(el('gear-pop').hidden,true); assert.equal(el('gear-btn').attrs['aria-expanded'],'false'); assert.equal(document.activeElement,el('gear-btn')); assert(captures.includes('keydown'), 'Escape must run before drawer dismissal'); });
test('gear fits narrow desktop viewport and anchors below button', () => { if(el('gear-pop').hidden) click(); const p=el('gear-pop'); assert(Number.parseFloat(p.style.left)>=8); assert(Number.parseFloat(p.style.left)+p.offsetWidth<=892); assert.equal(Number.parseFloat(p.style.top),118); });
test('outside pointer closes and updates expanded state', () => { for(const fn of listeners.pointerdown || []) fn({target:{}}); assert.equal(el('gear-pop').hidden,true); assert.equal(el('gear-btn').attrs['aria-expanded'],'false'); });
test('paused header has no second Paused chip; idle still shows', () => { const stateCode=app.slice(app.indexOf('  const villageState ='),app.indexOf('  const pace =',app.indexOf('  const villageState ='))); const c=vm.createContext({ $:el,st:'paused',w:{paused:true},map:{getVillageState:()=> 'idle'},map3d:{} }); vm.runInContext(stateCode,c); assert.equal(el('village-state').hidden,true); vm.runInContext(stateCode,vm.createContext({$:el,w:{paused:false},map:{getVillageState:()=> 'idle'},map3d:{}})); assert.equal(el('village-state').hidden,false); });
test('resize reanchors open gear inside laptop viewport', () => { if(el('gear-pop').hidden) click(); window.innerWidth=1280; el('gear-btn').getBoundingClientRect=()=>({right:1260,bottom:48}); for(const fn of windowListeners.resize || []) fn(); assert.equal(el('gear-pop').style.left,'940px'); assert.equal(el('gear-pop').style.top,'54px'); assert.equal(el('gear-pop').style.maxHeight,'678px'); });
test('paused state stays visible while reconnecting', () => { const code=app.slice(app.indexOf('  const villageState ='),app.indexOf('  const pace =',app.indexOf('  const villageState ='))); vm.runInContext(code,vm.createContext({$:el,st:'reconnecting',w:{paused:true},map:{},map3d:{}})); assert.equal(el('village-state').hidden,false); assert.equal(el('village-state').textContent,'Paused'); });
assert.equal(fails.length,0,`${fails.length} settings/layout behavior regressions`);
