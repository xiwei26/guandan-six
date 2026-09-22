import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {viewport,hitAt,handLayout,lobbySpread} from '../game-src/layout';
import {createRoom,addPlayer,applyAction,getRoomView} from '../server/game';
import {findHints} from '../shared/cards';
import {handRows,validReturnCards} from '../miniprogram/utils/presentation';
import type {GameAction} from '../shared/types';

function harness(loggedIn=false,screen={windowWidth:960,windowHeight:540,pixelRatio:1} as {windowWidth:number;windowHeight:number;pixelRatio:number;safeArea?:{left:number;top:number;right:number;bottom:number}}){
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
  let modal:any;
  const timers=new Set<unknown>();
  const ctx={font:'18px sans-serif',setTransform(){},save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},bezierCurveTo(){},fill(){},stroke(){},ellipse(){},arc(){},translate(){},rotate(){},scale(){},
    createLinearGradient(){return {addColorStop(){}};},
    fillRect(x:number,y:number,w:number){if(x===0&&y===0&&w===960)texts=[];},fillText(s:string,x:number,y:number){texts.push({s,x,y});},
    measureText(s:string){const size=Number(this.font.match(/([\d.]+)px/)?.[1]??18);return {width:[...s].reduce((width,c)=>width+size*(c.charCodeAt(0)>255?1:.55),0)};}};
  const canvas={width:960,height:540,getContext:()=>ctx};
  const wx:any={createCanvas:()=>canvas,getSystemInfoSync:()=>screen,
    getStorageSync:(k:string)=>storage.get(k),setStorageSync:(k:string,v:unknown)=>storage.set(k,v),removeStorageSync:(k:string)=>storage.delete(k),
    getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),getLaunchOptionsSync:()=>({query:{room:'123456'}}),showShareMenu(){},
    shareAppMessage(o:any){events.shared?.(o);},showModal(o:any){modal=o;errors.push(o.content);},showToast(){},hideKeyboard(){},showKeyboard(){},
    request(o:any){requests.push(o);let data:unknown;
      if(o.url.endsWith('/api/session'))data=session;
      else if(o.url.endsWith('/hints'))data={hints:findHints(state.players[0].hand,state.lastPlay,state.currentLevel,state.rules)};
      else if(o.url.endsWith('/actions')){actions.push(o.data.action);applyAction(state,'p1',o.data.action);data=o.data.action.type==='leave'?{room:null}:{room:getRoomView(state,'p1')};}
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
  return {events,texts:()=>texts,storage,state,actions,requests,sockets,errors,timers,flush,click,publish,modal:()=>modal};
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
test('game leaves a waiting room through HTTP before returning to the lobby',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();h.publish();
  h.click('大厅');assert.equal(h.modal()?.content,'离开将让出座位。');h.modal()?.success({confirm:true});await h.flush();
  assert.equal(h.actions.at(-1)?.type,'leave');assert.equal(h.storage.has('gd6.http://127.0.0.1:3001.room'),false);
  assert.ok(h.texts().some(t=>t.s==='电脑局 · 1–6 位真人'));h.events.Hide();
});
test('computer room can shuffle, seat friends together and fill only vacant seats on start',async()=>{
  const h=harness(true);
  h.state.mode='computer';h.state.players=h.state.players.slice(0,2);
  applyAction(h.state,'p1',{type:'ready',ready:true});
  try {
    h.click('电脑局 · 1–6 位真人');await h.flush();h.publish();
    h.click('随机组队');await h.flush();assert.equal(h.actions.length,0,'ready host must block shuffling');
    h.click('取消准备');await h.flush();
    h.click('随机组队');await h.flush();assert.equal(h.actions.at(-1)?.type,'shuffleTeams');

    const host=h.state.players.find(p=>p.userId==='p1')!;
    const friend=h.state.players.find(p=>p.userId==='p2')!;
    const target=[1,2,3,4,5,6].find(seat=>seat%2===host.seat%2&&!h.state.players.some(p=>p.seat===seat))!;
    const positions=[[424,300],[758,216],[758,106],[397,72],[28,106],[28,216]];
    const tapSeat=(seat:number)=>{
      const [x,y]=positions[(seat-host.seat+6)%6];
      h.events.TouchStart({touches:[{clientX:x+10,clientY:y+10}]});h.events.TouchEnd();
    };
    h.click('调整座位');tapSeat(friend.seat);tapSeat(target);await h.flush();
    assert.equal(h.actions.at(-1)?.type,'swap');
    assert.equal(h.state.players.find(p=>p.userId==='p2')?.team,host.team);
    const chosenSeats=h.state.players.map(p=>({userId:p.userId,seat:p.seat,team:p.team}));
    h.click('准备');await h.flush();
    applyAction(h.state,'p2',{type:'ready',ready:true});h.publish();
    h.click('开始');await h.flush();
    assert.equal(h.state.status,'playing');
    assert.deepEqual(h.state.players.filter(p=>!p.bot).map(p=>({userId:p.userId,seat:p.seat,team:p.team})),chosenSeats);
    assert.equal(h.state.players.filter(p=>p.bot).length,4);
    assert.equal(new Set(h.state.players.map(p=>p.seat)).size,6);
    assert.ok(h.state.players.every(p=>p.hand.length===27));
    assert.equal(new Set(h.state.players.flatMap(p=>p.hand.map(c=>c.id))).size,162);
    assert.equal(h.errors.length,0);
  } finally {h.events.Hide();}
});

test('game selects cards, submits server hints and recovers foreground snapshot',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
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
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
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

test('wide lobby stays inside the safe area and translated buttons remain clickable',async()=>{
  assert.equal(lobbySpread(960,540),0);
  for(const width of [844,932,1200]) {
    const screen={windowWidth:width,windowHeight:390,pixelRatio:2,safeArea:{left:44,top:0,right:width-44,bottom:369}};
    const v=viewport(width,390,screen.safeArea),spread=lobbySpread(width,390,screen.safeArea);
    assert.ok(spread>0&&spread<=65);
    assert.ok(v.x+(56-spread)*v.scale>=44);
    assert.ok(v.x+(904+spread)*v.scale<=width-44);
    const h=harness(true,screen);
    h.events.TouchStart({touches:[{clientX:v.x+(600+spread)*v.scale,clientY:v.y+166*v.scale}]});h.events.TouchEnd();await h.flush();
    assert.ok(h.requests.some(r=>r.url.endsWith('/api/rooms')&&r.data.rules),'wide create button must submit room configuration');
    h.events.Hide();
  }
});

test('game requires a valid return card and can continue from settlement',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
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
