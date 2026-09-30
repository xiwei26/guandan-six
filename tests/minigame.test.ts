import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import {viewport,hitAt,handLayout,lobbySpread,seatBounds,seatSpots,stackLayout,tableEdge,STACK,HAND_BOTTOM,TOP_SEAT_CX,SIDE_SEAT_HALF} from '../game-src/layout';
import {createRoom,addPlayer,applyAction,getRoomView} from '../server/game';
import {createDeck,findHints} from '../shared/cards';
import {handRows,validReturnCards} from '../miniprogram/utils/presentation';
import type {GameAction,Session} from '../shared/types';

function harness(loggedIn=false,screen={windowWidth:960,windowHeight:540,pixelRatio:1} as {windowWidth:number;windowHeight:number;pixelRatio:number;safeArea?:{left:number;top:number;right:number;bottom:number}}){
  const events:Record<string,(value?:any)=>any>={};
  let texts:{s:string;x:number;y:number}[]=[];
  const storage=new Map<string,unknown>();
  storage.set('gd6.server','http://127.0.0.1:3001');
  const session:Session={token:'test',userId:'p1',nickname:'测试玩家',provider:'guest',avatarVersion:null,avatarMime:null};
  if(loggedIn)storage.set('gd6.http://127.0.0.1:3001.session',session);
  const state=createRoom('123456','p1','测试玩家');for(let i=2;i<=6;i++)addPlayer(state,`p${i}`,`玩家${i}`);
  const requests:{url:string;data:any}[]=[];
  const actions:GameAction[]=[];
  const sockets:{closed:boolean;message?:(e:{data:string})=>void}[]=[];
  const errors:string[]=[];
  let modal:any;
  const failures={leaveBefore:false,leaveAfter:false};
  const recovery={roomId:null as string|null,legacyConflict:false};
  const timers=new Set<unknown>();
  const avatar={defer:false,pending:[] as any[],requests:0,writes:0,choices:[] as {path:string;data:string}[],lastChoice:undefined as {path:string;data:string}|undefined};
  const toasts:string[]=[];
  let drawnImages:string[]=[];
  const ctx={font:'18px sans-serif',setTransform(){},save(){},restore(){},beginPath(){},closePath(){},clip(){},moveTo(){},lineTo(){},quadraticCurveTo(){},bezierCurveTo(){},fill(){},stroke(){},ellipse(){},arc(){},translate(){},rotate(){},scale(){},
    createLinearGradient(){return {addColorStop(){}};},createRadialGradient(){return {addColorStop(){}};},
    fillRect(x:number,y:number,w:number){if(x===0&&y===0&&w===960){texts=[];drawnImages=[];}},fillText(s:string,x:number,y:number){texts.push({s,x,y});},
    drawImage(image:{src?:string}){drawnImages.push(image.src??'');},
    measureText(s:string){const size=Number(this.font.match(/([\d.]+)px/)?.[1]??18);return {width:[...s].reduce((width,c)=>width+size*(c.charCodeAt(0)>255?1:.55),0)};}};
  const canvas={width:960,height:540,getContext:()=>ctx};
  const wx:any={createCanvas:()=>canvas,env:{USER_DATA_PATH:'test'},getSystemInfoSync:()=>screen,
    getStorageSync:(k:string)=>storage.get(k),setStorageSync:(k:string,v:unknown)=>storage.set(k,v),removeStorageSync:(k:string)=>storage.delete(k),
    getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),getLaunchOptionsSync:()=>({query:{room:'123456'}}),showShareMenu(){},
    shareAppMessage(o:any){events.shared?.(o);},showModal(o:any){modal=o;errors.push(o.content);},showToast(o:any){toasts.push(o.title);},hideKeyboard(){},showKeyboard(){},
    chooseImage(o:any){const choice=avatar.choices.shift();if(choice)o.success({tempFilePaths:[choice.path]});else o.fail();},
    createImage(){const image:any={onload:undefined,_src:''};Object.defineProperty(image,'src',{get(){return image._src;},set(value){image._src=value;image.onload?.();}});return image;},
    getFileSystemManager(){return {
      readFile(o:any){const choice=avatar.lastChoice;if(choice&&choice.path===o.filePath)o.success({data:choice.data});else o.fail();},
      writeFile(o:any){avatar.writes++;o.success();}
    };},
    request(o:any){requests.push(o);let data:unknown;
      if(o.url.endsWith('/api/session'))data=session;
      else if(o.url.endsWith('/api/profile')){session.nickname=o.data.nickname;if(o.data.avatar){session.avatarVersion='v2';session.avatarMime='image/png';}data=session;}
      else if(o.url.endsWith('/api/rooms/current'))data={roomId:recovery.roomId};
      else if(o.url.includes('/avatars/')){avatar.requests++;if(avatar.defer){avatar.pending.push(o);return;}data={version:'v1',mime:'image/png',data:'AA=='};}
      else if(recovery.legacyConflict&&(o.url.endsWith('/api/demo')||o.url.endsWith('/api/rooms'))){o.success({statusCode:409,data:{error:`你已在房间 ${state.roomId} 中，请先返回或退出该房间`}});return;}
      else if(o.url.endsWith('/hints'))data={hints:findHints(state.players[0].hand,state.lastPlay,state.currentLevel,state.rules)};
      else if(o.url.endsWith('/actions')){
        actions.push(o.data.action);
        if(o.data.action.type==='leave'&&failures.leaveBefore){failures.leaveBefore=false;o.fail({});return;}
        applyAction(state,'p1',o.data.action);
        if(o.data.action.type==='leave'&&failures.leaveAfter){failures.leaveAfter=false;o.fail({});return;}
        data={room:state.players.some(p=>p.userId==='p1')?getRoomView(state,'p1'):null};
      }
      else data={room:getRoomView(state,'p1')};
      o.success({statusCode:200,data});
    },
    connectSocket(){const socket:{closed:boolean;message?:(e:{data:string})=>void}={closed:false};sockets.push(socket);return {
      onOpen(){},onClose(){},onError(){},onMessage(fn:(e:{data:string})=>void){socket.message=fn;},send(){},close(){socket.closed=true;}
    };}
  };
  const nativeChooseImage=wx.chooseImage.bind(wx);wx.chooseImage=(o:any)=>{avatar.lastChoice=avatar.choices[0];nativeChooseImage(o);};
  for(const name of ['TouchStart','TouchMove','TouchEnd','TouchCancel','KeyboardConfirm','KeyboardComplete','Show','Hide','WindowResize','NetworkStatusChange','ShareAppMessage'])wx['on'+name]=(fn:()=>void)=>events[name]=fn;
  runInNewContext(readFileSync('minigame/game.js','utf8'),{wx,console,setInterval:(fn:unknown)=>{timers.add(fn);return fn;},clearInterval:(fn:unknown)=>timers.delete(fn),setTimeout,clearTimeout});
  const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};
  const click=(label:string)=>{const t=texts.find(t=>t.s===label);assert.ok(t,`missing button ${label}: ${texts.map(t=>t.s).join(',')}`);events.TouchStart({touches:[{clientX:t.x+3,clientY:t.y}]});events.TouchEnd();};
  const publish=()=>sockets.at(-1)?.message?.({data:JSON.stringify({type:'state',room:getRoomView(state,'p1')})});
  return {events,texts:()=>texts,drawnImages:()=>drawnImages,storage,state,actions,requests,sockets,errors,toasts,timers,avatar,flush,click,publish,modal:()=>modal,failures,recovery};
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
test('game sends the selected match length when creating a computer room',async()=>{
  for(const [change,expected] of [[false,'A'],[true,1]] as const){
    const h=harness(true);
    try{
      if(change)h.click('局数：打到 A');
      h.click('电脑局 · 1–6 位真人');await h.flush();
      const request=h.requests.find(item=>item.url.endsWith('/api/demo'));
      assert.ok(request);
      assert.equal(request.data.waitForPlayers,true);
      assert.equal(request.data.rules.rounds,expected);
    }finally{h.events.Hide();}
  }
});
test('game restores disabled room controls from server discovery or a legacy create conflict',async()=>{
  for(const source of ['discovery','legacy'] as const){
    const h=harness(true);
    try{
      await h.flush();assert.equal(h.storage.has('gd6.http://127.0.0.1:3001.room'),false);
      if(source==='discovery'){h.recovery.roomId=h.state.roomId;h.events.Show({});}
      else{h.recovery.legacyConflict=true;h.click('创建房间');}
      await h.flush();assert.equal(h.storage.get('gd6.http://127.0.0.1:3001.room'),h.state.roomId);
      if(source==='discovery'){
        h.click('返回上次房间');await h.flush();assert.ok(h.texts().some(t=>t.s==='等待六位牌友准备'));
      }else{
        assert.match(h.modal().content,/已恢复/);h.click('退出旧房');await h.flush();
        assert.equal(h.storage.has('gd6.http://127.0.0.1:3001.room'),false);assert.equal(h.actions.at(-1)?.type,'leave');
      }
    }finally{h.events.Hide();}
  }
});
test('game leaves a waiting room through HTTP before returning to the lobby',async()=>{
  for(const online of [false,true]){
    const h=harness(true);
    try{
      h.click('电脑局 · 1–6 位真人');await h.flush();if(online)h.publish();
      h.click('返回大厅');assert.equal(h.modal()?.content,'离开将让出座位。');h.modal()?.success({confirm:true});await h.flush();
      assert.equal(h.actions.at(-1)?.type,'leave');assert.equal(h.storage.has('gd6.http://127.0.0.1:3001.room'),false);
      assert.ok(h.texts().some(t=>t.s==='电脑局 · 1–6 位真人'));
    }finally{h.events.Hide();}
  }
});
test('game lobby can fully exit a saved computer game but keeps active friends membership',async()=>{
  for(const mode of ['computer','friends'] as const){
    const h=harness(true);
    try{
      await h.flush();h.recovery.roomId=h.state.roomId;
      h.state.mode=mode;for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});
      applyAction(h.state,'p1',{type:'start'});
      h.storage.set('gd6.http://127.0.0.1:3001.room',h.state.roomId);h.events.Show({});
      h.click('退出旧房');await h.flush();
      if(mode==='computer'){
        assert.equal(h.actions.at(-1)?.type,'leave');assert.equal(h.storage.has('gd6.http://127.0.0.1:3001.room'),false);
        assert.equal(h.state.players.length,6);assert.equal(h.state.players[0].bot,true);
      }else{
        assert.equal(h.actions.length,0);assert.match(h.modal().content,/好友牌局/);
        assert.equal(h.storage.get('gd6.http://127.0.0.1:3001.room'),h.state.roomId);
      }
    }finally{h.events.Hide();}
  }
});
test('game retries HTTP failure or a lost exit response without silently abandoning a waiting room',async()=>{
  for(const failure of ['leaveBefore','leaveAfter'] as const){
    const h=harness(true);
    try{
      h.click('电脑局 · 1–6 位真人');await h.flush();h.failures[failure]=true;
      h.click('返回大厅');h.modal().success({confirm:true});await h.flush();
      assert.equal(h.storage.get('gd6.http://127.0.0.1:3001.room'),h.state.roomId);
      assert.ok(h.texts().some(t=>t.s==='返回大厅'));
      h.click('返回大厅');h.modal().success({confirm:true});await h.flush();
      assert.equal(h.storage.has('gd6.http://127.0.0.1:3001.room'),false);
      assert.ok(h.texts().some(t=>t.s==='电脑局 · 1–6 位真人'));
    }finally{h.events.Hide();}
  }
});
test('game active leave explains computer replacement and preserves only friends resume entries',async()=>{
  for(const mode of ['computer','friends'] as const){
    const h=harness(true);
    try{
      h.state.mode=mode;
      h.click('电脑局 · 1–6 位真人');await h.flush();
      for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});
      applyAction(h.state,'p1',{type:'start'});h.publish();
      h.click('返回大厅');assert.match(h.modal().content,mode==='computer'?/电脑接替/:/保留/);
      h.modal().success({confirm:true});await h.flush();
      assert.equal(h.storage.has('gd6.http://127.0.0.1:3001.room'),mode==='friends');
      assert.ok(h.texts().some(t=>t.s==='电脑局 · 1–6 位真人'));
    }finally{h.events.Hide();}
  }
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
    const tapSeat=(seat:number)=>{
      const bounds=seatBounds((seat-host.seat+6)%6);
      h.events.TouchStart({touches:[{clientX:bounds.x+bounds.w/2,clientY:bounds.y+bounds.h/2}]});h.events.TouchEnd();
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
  h.click('提示');await h.flush();h.click('出牌');await h.flush();
  assert.equal(h.actions.at(-1)?.type,'play');assert.ok(h.state.players[0].hand.length<27);
  h.events.Hide();h.events.Show({});await h.flush();h.publish();assert.equal(h.sockets.length,2);assert.equal(h.timers.size,1);
  h.events.Hide();assert.equal(h.errors.length,0);
});
test('game auto arrangement and restore stay local without submitting a server action',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});h.publish();
  h.click('一键理牌');assert.ok(h.texts().some(t=>t.s==='组合'));assert.ok(h.texts().some(t=>t.s==='还原'));
  h.click('还原');assert.equal(h.actions.length,0);h.events.Hide();
});

test('arranged combinations leave every compact card header visible and on canvas',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  h.state.players[0].hand=createDeck().filter(card=>card.rank==='3');h.publish();
  h.click('一键理牌');
  const ranks=h.texts().filter(text=>text.s==='3'&&text.y>170).sort((a,b)=>a.y-b.y);
  const rows=[...new Set(ranks.map(rank=>rank.y))].sort((a,b)=>a-b);
  assert.equal(ranks.length,12);assert.ok(rows.length>1);assert.ok(rows.slice(1).every((row,index)=>row-rows[index]>=STACK.step),'stacked cards must expose each header with the wider spacing');
  assert.ok(Math.max(...ranks.map(rank=>rank.y))<HAND_BOTTOM,'large combinations must stay inside the hand area');
  assert.ok(h.texts().some(text=>text.s==='十二炸'),'groups above three cards carry a pattern tag');
  h.events.Hide();
});

test('arranged hand is centred, bombs lead and only groups above three cards are tagged',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  const deck=createDeck();
  h.state.players[0].hand=[...deck.filter(card=>card.rank==='9').slice(0,4),...deck.filter(card=>card.rank==='7').slice(0,3),...deck.filter(card=>card.rank==='5').slice(0,2),deck.find(card=>card.rank==='K')!];h.publish();
  h.click('一键理牌');
  const hand=h.texts().filter(text=>text.y>170&&text.y<HAND_BOTTOM&&['9','7','5','K'].includes(text.s));
  const left=Math.min(...hand.map(text=>text.x)),right=Math.max(...hand.map(text=>text.x));
  assert.equal(hand.find(text=>text.x===left)?.s,'9','the bomb sits on the far left');
  assert.ok(Math.abs((left+right+STACK.width)/2-480)<60,'the arranged hand is centred');
  assert.ok(h.texts().some(text=>text.s==='四炸'));assert.ok(h.texts().some(text=>text.s==='三带二'));
  assert.ok(!h.texts().some(text=>['对子','单张','三张'].includes(text.s)),'pairs, triples and singles stay untagged');
  h.events.Hide();
});

test('stack layout keeps up to six cards in one column and splits larger groups into two columns overlapping by 30%',()=>{
  const six=stackLayout([{count:6,single:false,ranks:['8','8','7','7','6','6']}]).cards[0];
  assert.equal(new Set(six.map(card=>card.x)).size,1,'a six-card group stays in one column');
  assert.equal(six[1].y-six[0].y,STACK.step);assert.equal(six[5].y+STACK.height,HAND_BOTTOM);
  const eight=stackLayout([{count:8,single:false}]).cards[0],columns=[...new Set(eight.map(card=>card.x))];
  assert.equal(columns.length,2);assert.ok(Math.abs(columns[1]-columns[0]-STACK.width*(1-STACK.pairOverlap))<.01,'split columns overlap by 30%');
  // A typical wide arrangement tightens the gaps but never overlaps neighbouring groups.
  const tight=stackLayout([...Array.from({length:9},()=>({count:3,single:false})),{count:4,single:true}]).cards;
  for(let i=1;i<9;i++)assert.ok(tight[i][0].x-tight[i-1][0].x>=STACK.width,'groups keep clear of each other');
  assert.ok(tight[9][0].x-tight[8][0].x>=STACK.width);
  // Only a tall end column has to keep clear of the lower side seats; a short singles fan may pass beneath them.
  const side={x:87,y:270},hand=[{count:6,single:false},...Array.from({length:6},()=>({count:3,single:false})),{count:5,single:true}];
  const shifted=stackLayout(hand,side).cards;
  assert.ok(shifted[0][0].x>=side.x,'a tall first column stays right of the seat');
  assert.ok(Math.max(...shifted.at(-1)!.map(card=>card.x))+STACK.width>960-side.x,'the short right end may use the space under the seat');
  for(let i=1;i<hand.length;i++)assert.ok(shifted[i][0].x-Math.max(...shifted[i-1].map(card=>card.x))>=STACK.width-.01,'shifting avoids overlap');
  const wide=stackLayout([...Array.from({length:12},()=>({count:2,single:false})),{count:3,single:true}]);
  const xs=wide.cards.flat().map(card=>card.x);
  assert.ok(Math.min(...xs)>=23.99&&Math.max(...xs)+STACK.width<=936.01,'extreme hands still stay on the canvas');
});

test('side seats move one avatar toward wide screen edges, the lower pair one avatar down',()=>{
  const phone=tableEdge(844,390,{left:44,top:0,right:800,bottom:369});
  assert.ok(phone>23);assert.equal(tableEdge(960,540),0);
  const wide=seatSpots(phone),narrow=seatSpots(0);
  assert.equal(wide[4].cx,64-42);assert.equal(wide[2].cx,896+42);
  assert.ok(narrow[4].cx-SIDE_SEAT_HALF>=8,'16:9 screens keep the side seat block on the canvas');
  assert.equal(wide[5].y-wide[4].y,128);assert.equal(wide[1].y,wide[5].y);
});

test('other players played combinations expose every card header',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const player of h.state.players)applyAction(h.state,player.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  const cards=[...createDeck().filter(card=>card.rank==='6'&&card.suit==='spade').slice(0,3),...createDeck().filter(card=>card.rank==='7'&&card.suit==='club').slice(0,2)];
  h.state.players[1].hand=cards;h.state.currentTurnSeat=h.state.players[1].seat;
  applyAction(h.state,'p2',{type:'play',cardIds:cards.map(card=>card.id)});h.publish();
  const headers=h.texts().filter(text=>(text.s==='6'||text.s==='7')&&text.y>130&&text.y<240).sort((a,b)=>a.x-b.x);
  assert.equal(headers.length,5);assert.ok(headers.slice(1).every((header,index)=>header.x-headers[index].x>=44),'played cards must leave every card face readable');
  h.events.Hide();
});

test('top player sits under the round label and plays just right of its name',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const player of h.state.players)applyAction(h.state,player.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  const cards=[...createDeck().filter(card=>card.rank==='6'&&card.suit==='spade').slice(0,3),...createDeck().filter(card=>card.rank==='7'&&card.suit==='club').slice(0,2)];
  h.state.players[3].hand=cards;h.state.currentTurnSeat=h.state.players[3].seat;
  applyAction(h.state,'p4',{type:'play',cardIds:cards.map(card=>card.id)});h.publish();
  // The harness measures CJK glyphs at 1 em and other characters at 0.55 em.
  const width=(s:string,size:number)=>[...s].reduce((sum,c)=>sum+size*(c.charCodeAt(0)>255?1:.55),0);
  const round=h.texts().find(text=>text.s.startsWith('第 1 局'))!;
  assert.ok(Math.abs(round.x+width('第 1 ',16)+8-TOP_SEAT_CX)<1,'"局" sits above the top avatar');
  const name=h.texts().find(text=>text.s==='玩家4')!,headers=h.texts().filter(text=>(text.s==='6'||text.s==='7')&&text.y<130);
  assert.equal(headers.length,5);
  assert.ok(headers.every(header=>header.x>name.x+width('玩家4',13)),'cards start right of the name');
  assert.ok(headers.every(header=>header.y-12>=36),'cards stay below the header row');
  h.events.Hide();
});

test('turn buttons and the countdown clock appear only on the viewer turn',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const player of h.state.players)applyAction(h.state,player.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  h.state.currentTurnSeat=2;h.state.deadline=Date.now()+20_000;h.publish();
  for(const label of ['提示','不出','出牌'])assert.ok(!h.texts().some(text=>text.s===label),`${label} stays hidden on another player's turn`);
  h.state.currentTurnSeat=1;h.publish();
  for(const label of ['提示','不出','出牌'])assert.ok(h.texts().some(text=>text.s===label),`${label} shows on the viewer's turn`);
  assert.ok(h.texts().some(text=>/^(19|20)$/.test(text.s)),'the countdown is drawn inside the clock');
  assert.ok(!h.texts().some(text=>['轮到你','托管中'].includes(text.s)||text.s.endsWith(' 秒')),'only the four turn controls remain');
  h.events.Hide();
});

test('choosing a straight-flush suit selects its cards without undoing the arrangement',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const player of h.state.players)applyAction(h.state,player.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  const deck=createDeck();
  h.state.players[0].hand=[...['3','4','5','6','7'].map(rank=>deck.find(card=>card.rank===rank&&card.suit==='spade')!),...deck.filter(card=>card.rank==='9').slice(0,4)];h.publish();
  h.click('一键理牌');assert.ok(h.texts().some(text=>text.s==='四炸'));
  h.events.TouchStart({touches:[{clientX:816,clientY:520}]});h.events.TouchEnd();
  assert.ok(h.texts().some(text=>text.s.startsWith('已选 5 张')),'the straight flush is selected');
  assert.ok(h.texts().some(text=>text.s==='四炸'),'the arranged groups stay in place');
  assert.equal(h.actions.length,0);
  h.events.Hide();
});

test('long opponent bombs wrap into two readable rows',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const player of h.state.players)applyAction(h.state,player.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  const cards=createDeck().filter(card=>card.rank==='6');
  h.state.players[1].hand=cards;h.state.currentTurnSeat=h.state.players[1].seat;
  applyAction(h.state,'p2',{type:'play',cardIds:cards.map(card=>card.id)});h.publish();
  const headers=h.texts().filter(text=>text.s==='6'&&text.y>130&&text.y<240);
  const rows=[...new Set(headers.map(header=>header.y))].sort((a,b)=>a-b);
  assert.equal(headers.length,12);assert.deepEqual(rows.map(y=>headers.filter(header=>header.y===y).length),[6,6]);
  for(const y of rows){
    const row=headers.filter(header=>header.y===y).sort((a,b)=>a.x-b.x);
    assert.ok(row.slice(1).every((header,index)=>header.x-row[index].x>=44),'wrapped cards must keep every face readable');
  }
  h.events.Hide();
});

test('avatar loading retries after a stale response completes outside the room',async()=>{
  const h=harness(true);h.avatar.defer=true;h.state.players[1].avatarVersion='v1';h.state.players[1].avatarMime='image/png';
  h.click('电脑局 · 1–6 位真人');await h.flush();assert.equal(h.avatar.requests,1);
  h.sockets.at(-1)?.message?.({data:JSON.stringify({type:'left'})});await h.flush();
  h.avatar.pending.shift().success({statusCode:200,data:{version:'v1',mime:'image/png',data:'AA=='}});await h.flush();
  h.click('电脑局 · 1–6 位真人');await h.flush();
  h.avatar.pending.shift()?.success({statusCode:200,data:{version:'v1',mime:'image/png',data:'AA=='}});await h.flush();
  assert.equal(h.avatar.writes,1);assert.match(h.drawnImages().at(-1)??'',/gd6-avatar-p2-v1\.png$/);
  h.events.Hide();
});

test('oversized avatar selection keeps the last valid preview and upload',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  const own=seatBounds(0);h.events.TouchStart({touches:[{clientX:own.x+20,clientY:own.y+own.h/2}]});h.events.TouchEnd();
  const valid='aGVsbG8=';h.avatar.choices.push({path:'valid.png',data:valid});h.click('选择头像');
  assert.equal(h.drawnImages().at(-1),'valid.png');
  h.avatar.choices.push({path:'oversized.png',data:'A'.repeat(350_001)});h.click('选择头像');
  assert.equal(h.drawnImages().at(-1),'valid.png');assert.equal(h.toasts.at(-1),'图片太大，请选一张较小的头像');
  h.click('保存资料');await h.flush();
  assert.equal(h.requests.find(request=>request.url.endsWith('/api/profile'))?.data.avatar,valid);
  h.events.Hide();
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
  assert.ok(h.texts().some(t=>t.s.includes('A 队获胜')));h.click('下一局 · 打 5');await h.flush();assert.equal(h.actions.at(-1)?.type,'next');assert.equal(h.state.round,2);
  assert.equal(h.errors.length,0);h.events.Hide();
});

test('game room configuration uses touch controls and reaches the create request',async()=>{
  const h=harness(true);h.click('更多房间设置');
  assert.ok(!h.texts().some(t=>t.s.startsWith('记牌器')),'the card counter is hidden until it becomes a paid feature');
  h.click('允许托管：开');h.click('完成');h.click('创建房间');await h.flush();
  assert.equal(h.requests.at(-1)?.data.rules.allowAutoPlay,false);h.events.Hide();
});

test('table header drops invite and connection status once play starts and hides the card counter',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();h.publish();
  for(const label of ['邀请','已连接','返回大厅'])assert.ok(h.texts().some(t=>t.s===label),`waiting room shows ${label}`);
  for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});h.publish();
  assert.ok(h.texts().some(t=>t.s==='返回大厅'));
  for(const label of ['邀请','已连接','大厅','记牌'])assert.ok(!h.texts().some(t=>t.s===label),`${label} is hidden during play`);
  h.events.Hide();
});

test('opponent card counts appear only at ten cards or fewer',async()=>{
  const h=harness(true);h.click('电脑局 · 1–6 位真人');await h.flush();
  for(const p of h.state.players)applyAction(h.state,p.userId,{type:'ready',ready:true});applyAction(h.state,'p1',{type:'start'});
  h.state.players[1].hand=h.state.players[1].hand.slice(0,11);h.state.players[2].hand=h.state.players[2].hand.slice(0,10);h.publish();
  assert.ok(!h.texts().some(t=>/\b(11|27) 张/.test(t.s)),'counts above ten stay hidden');
  assert.ok(h.texts().some(t=>t.s.includes('10 张')));
  h.events.Hide();
});

test('table colour choice applies immediately and is remembered',async()=>{
  const h=harness(true);h.click('深蓝');assert.equal(h.storage.get('gd6.ui.theme'),'blue');
  h.click('藏青');assert.equal(h.storage.get('gd6.ui.theme'),'navy');h.events.Hide();
});
