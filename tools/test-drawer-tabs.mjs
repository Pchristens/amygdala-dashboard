// Drawer tabs follow the WAI-ARIA tabs pattern: markup wiring, roving tabindex, arrow/Home/End keys.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),panel=fs.readFileSync(new URL('../public/panel.js',import.meta.url),'utf8');
const fails=[];
function test(name,f){try{f();console.log('ok:',name)}catch(e){fails.push(name);console.error('FAIL:',name,e.message)}}
const tabs=[...html.matchAll(/<button class="tab" role="tab"([^>]*)>/g)].map(m=>m[1]);
const attr=(s,k)=>(s.match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`))||[])[1];
test('six tabs, each with id, aria-controls, and a matching tabpanel',()=>{
  assert.equal(tabs.length,6);
  for(const t of tabs){const n=attr(t,'data-tab');assert.equal(attr(t,'id'),`tabbtn-${n}`);assert.equal(attr(t,'aria-controls'),`tab-${n}`);
    const sec=html.match(new RegExp(`<section class="tab-body"[^>]*id="tab-${n}"[^>]*>`));assert.ok(sec,n);assert.match(sec[0],/role="tabpanel"/);assert.match(sec[0],new RegExp(`aria-labelledby="tabbtn-${n}"`));}
});
test('only the selected tab starts in the tab order',()=>{
  for(const t of tabs)assert.equal(attr(t,'tabindex'),attr(t,'aria-selected')==='true'?'0':'-1');
});
test('close button is not a tab',()=>assert.doesNotMatch(html.match(/<button[^>]*id="drawer-close"[^>]*>/)[0],/role="tab"|tabindex/));
// Exercise the real selectTab + tabKey with a stub.
const mk=n=>({dataset:{tab:n},attrs:{},tabIndex:0,setAttribute(k,v){this.attrs[k]=v},focus(){ctx.focused=n}});
const names=['board','exhibits','residents'],els={tabs:names.map(mk),bodies:names.map(n=>({dataset:{tab:n},hidden:false}))};
const ctx=vm.createContext({els,activeTab:'board',opts:{},scrollBoardToBottom(){},focused:null});
const a=panel.indexOf('function tabKey'),b=panel.indexOf('// ---- zone switch');
test('panel.js defines tabKey',()=>assert.ok(a>0&&b>a));
if(a>0&&b>a){
  vm.runInContext(panel.slice(a,b).replace(/for \(const t of els\.tabs\) t\.addEventListener\('keydown', tabKey\);/,''),ctx);
  const key=(from,k)=>{const e={key:k,target:els.tabs[from],prevented:false,preventDefault(){this.prevented=true}};ctx.tabKey(e);return e};
  const sel=()=>els.tabs.filter(t=>t.attrs['aria-selected']==='true').map(t=>t.dataset.tab).join();
  test('ArrowRight selects and focuses next, wrapping',()=>{key(0,'ArrowRight');assert.equal(sel(),'exhibits');assert.equal(ctx.focused,'exhibits');key(2,'ArrowRight');assert.equal(sel(),'board')});
  test('ArrowLeft wraps to last',()=>{key(0,'ArrowLeft');assert.equal(sel(),'residents')});
  test('Home and End',()=>{key(1,'End');assert.equal(sel(),'residents');key(1,'Home');assert.equal(sel(),'board')});
  test('roving tabindex follows selection',()=>{key(0,'ArrowRight');assert.deepEqual(els.tabs.map(t=>t.tabIndex),[-1,0,-1])});
  test('other keys and non-tab targets are ignored',()=>{const e=key(0,'a');assert.equal(e.prevented,false);ctx.tabKey({key:'End',target:{},preventDefault(){throw new Error('x')}})});
}
if(fails.length){console.error(`${fails.length} failed`);process.exit(1)}
