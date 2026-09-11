import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {viewport,hitAt,handLayout} from '../game-src/layout';
import {createRoom,addPlayer,applyAction,getRoomView} from '../server/game';
import {findHints} from '../shared/cards';
import {handRows,validReturnCards} from '../miniprogram/utils/presentation';
import type {GameAction} from '../shared/types';

function harness(loggedIn=false){
  const events:Record<string,(value?:any)=>any>={};
  let texts:{s:string;x:number;y:number}[]=[];
  const storage=new Map<string,unknown>();
  storage.set('gd6.server','http://127.0.0.1:3001');
  const session={token:'test',userId:'p1',nickname:'测试玩家',provider:'guest'};
  if(loggedIn)storage.set('gd6.http://127.0.0.1:3001.session',session);
  const state=createRoom('123456','p1','测试玩家');for(let i=2;i<=6;i++)addPlayer(state,`p${i}`,`玩家${i}`);
  const requests:{url:string;data:any}[]=[];
  const actions:GameAction[]=[];
  const sockets:{closed:boolean;message?:(e:{data:string})=>void}[]=[];
  const errors:string[]=[];
  const timers=new Set<unknown>();
  const ctx={setTransform(){},save(){},restore(){},fillRect(x:number,y:number,w:number){if(x===0&&y===0&&w===960)texts=[];},fillText(s:string,x:number,y:number){texts.push({s,x,y});},measureText(s:string){return {width:s.length*18};}};
  const canvas={width:960,height:540,getContext:()=>ctx};
  const wx:any={createCanvas:()=>canvas,getSystemInfoSync:()=>({windowWidth:960,windowHeight:540,pixelRatio:1}),
    getStorageSync:(k:string)=>storage.get(k),setStorageSync:(k:string,v:unknown)=>storage.set(k,v),removeStorageSync:(k:string)=>storage.delete(k),
    getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),getLaunchOptionsSync:()=>({query:{room:'123456'}}),showShareMenu(){},
    shareAppMessage(o:any){events.shared?.(o);},showModal(o:any){errors.push(o.content);},showToast(){},hideKeyboard(){},showKeyboard(){},
    request(o:any){requests.push(o);let data:unknown;
      if(o.url.endsWith('/api/session'))data=session;
      else if(o.url.endsWith('/hints'))data={hints:findHints(state.players[0].hand,state.lastPlay,state.currentLevel,state.rules)};
      else if(o.url.endsWith('/actions')){actions.push(o.data.action);applyAction(state,'p1',o.data.action);data={room:getRoomView(state,'p1')};}
      else data={room:getRoomView(state,'p1')};
      o.success({statusCode:200,data});
    },
    connectSocket(){const socket:{closed:boolean;message?:(e:{data:string})=>void}={closed:false};sockets.push(socket);return {
      onOpen(){},onClose(){},onError(){},onMessage(fn:(e:{data:string})=>void){socket.message=fn;},send(){},close(){socket.closed=true;}
    };}
  };
  for(const name of ['TouchStart','TouchMove','TouchEnd','TouchCancel','KeyboardConfirm','KeyboardComplete','Show','Hide','WindowResize','NetworkStatusChange','ShareAppMessage'])wx['on'+name]=(fn:()=>void)=>events[name]=fn;
  runInNewContext(readFileSync('minigame/game.js','utf8'),{wx,console,setInterval:(fn:unknown)=>{timers.add(fn);return fn;},clearInterval:(fn:unknown)=>timers.delete(fn),setTimeout,clearTimeout});
  const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};
  const click=(label:string)=>{const t=texts.find(t=>t.s===label);assert.ok(t,`missing button ${label}: ${texts.map(t=>t.s).join(',')}`);events.TouchStart({touches:[{clientX:t.x+3,clientY:t.y}]});events.TouchEnd();};
  const publish=()=>sockets.at(-1)?.message?.({data:JSON.stringify({type:'state',room:getRoomView(state,'p1')})});
  return {events,texts:()=>texts,storage,state,actions,requests,sockets,errors,timers,flush,click,publish};
}

test('game artifact is current and project opens a real game entry',async()=>{
  const config=JSON.parse(readFileSync('project.config.json','utf8'));assert.equal(config.compileType,'game');assert.equal(config.miniprogramRoot,'minigame/');
  assert.equal(JSON.parse(readFileSync('minigame/game.json','utf8')).deviceOrientation,'landscape');
  const output=await build({entryPoints:['game-src/main.ts'],bundle:true,platform:'neutral',format:'iife',target:'es2020',minify:true,legalComments:'none',write:false});
  assert.equal(output.outputFiles[0].text,readFileSync('minigame/game.js','utf8'));
});
test('game boots without DOM, Page or App and guest can accept a shared invitation',async()=>{
  const h=harness();assert.ok(h.texts().some(t=>t.s==='六人掼蛋'));h.click('游客体验');await h.flush();h.click('加入邀请 123456');await h.flush();h.publish();
  assert.ok(h.texts().some(t=>t.s==='等待六位牌友准备'));h.click('准备');await h.flush();assert.deepEqual(JSON.parse(JSON.stringify(h.actions)),[{type:'ready',ready:true}]);
  assert.equal(h.events.ShareAppMessage()?.query,'room=123456');h.events.Hide();assert.equal(h.timers.size,0);assert.equal(h.sockets[0].closed,true);
});
test('game selects cards, submits server hints and recovers foreground snapshot',async()=>{
  const h=harness(true);h.click('体验一局 · 五位机器人');await h.flush();
  for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});h.state.currentTurnSeat=1;h.publish();
  const layout=handLayout(27);
  h.events.TouchStart({touches:[{clientX:layout.left+5,clientY:410}]});h.events.TouchMove({touches:[{clientX:layout.left+layout.step+5,clientY:410}]});h.events.TouchEnd();
  assert.ok(h.texts().some(t=>t.s.includes('已选 2 张')||t.s.includes('所选牌型无效')));
  h.click('清空');h.click('提示');await h.flush();h.click('出牌');await h.flush();
  assert.equal(h.actions.at(-1)?.type,'play');assert.ok(h.state.players[0].hand.length<27);
  h.events.Hide();h.events.Show({});await h.flush();h.publish();assert.equal(h.sockets.length,2);assert.equal(h.timers.size,1);
  h.events.Hide();assert.equal(h.errors.length,0);
});
test('game auto arrangement opens editable groups without submitting a server action',async()=>{
  const h=harness(true);h.click('体验一局 · 五位机器人');await h.flush();
  for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});h.publish();
  h.click('一键理牌');assert.ok(h.texts().some(t=>t.s.startsWith('手牌分组')));
  const label=h.texts().find(t=>/^1\. /.test(t.s))!.s;h.click(label);h.click('选牌成组');h.click('完成');h.click('调整');
  assert.ok(h.texts().some(t=>t.s.startsWith('手牌分组')));assert.equal(h.actions.length,0);h.events.Hide();
});

test('game maps safe-area touch coordinates and chooses the topmost card',()=>{
  const v=viewport(844,390,{left:44,top:0,right:800,bottom:369});assert.ok(v.x>=44);assert.ok(v.x+960*v.scale<=800);
  const hits=[{x:0,y:0,w:58,h:44,card:'a',run(){}},{x:0,y:30,w:58,h:44,card:'b',run(){}}];
  assert.equal(hitAt(hits,12,35)?.card,'b');assert.equal(hitAt(hits,-1,35),undefined);
});

test('game requires a valid return card and can continue from settlement',async()=>{
  const h=harness(true);h.click('体验一局 · 五位机器人');await h.flush();
  for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  h.state.status='tribute';h.state.tribute=[{from:2,to:1,given:true,returned:false}];h.state.deadline=null;h.publish();
  h.click('确认还贡');await h.flush();assert.equal(h.actions.length,0);
  const valid=validReturnCards(h.state.players[0].hand,h.state.currentLevel)[0];
  const rows=handRows(h.state.players[0].hand,h.state.currentLevel,[],'rank');
  const row=rows.findIndex(r=>r.cards.some(c=>c.id===valid.id)),column=rows[row].cards.findIndex(c=>c.id===valid.id);
  const layout=handLayout(h.state.players[0].hand.length);
  h.events.TouchStart({touches:[{clientX:layout.left+(row*14+column)*layout.step+5,clientY:410}]});h.events.TouchEnd();
  h.click('确认还贡');await h.flush();assert.equal(h.actions.at(-1)?.type,'tribute');assert.equal(h.state.tribute[0].returned,true);
  h.state.status='settlement';h.state.settlement={order:[1,3,5,2,4,6],winner:'A',upgrade:3,fromLevel:'2',toLevel:'5',sweep:true,matchOver:false,reason:'test',biggestBomb:0};h.state.revision++;h.publish();
  assert.ok(h.texts().some(t=>t.s.includes('A 队获胜')));h.click('下一局');await h.flush();assert.equal(h.actions.at(-1)?.type,'next');assert.equal(h.state.round,2);
  assert.equal(h.errors.length,0);h.events.Hide();
});

test('game room configuration uses touch controls and reaches the create request',async()=>{
  const h=harness(true);h.click('更多房间设置');h.click('记牌器：开');h.click('完成');h.click('创建房间');await h.flush();
  assert.equal(h.requests.at(-1)?.data.rules.allowCounter,false);h.events.Hide();
});
