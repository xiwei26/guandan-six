import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createApplication } from '../server/index.ts';
import type { RoomView, Session, StatsSummary } from '../shared/types.ts';

async function launch(options:Parameters<typeof createApplication>[0]={persist:false,tick:false}) {
  const app=createApplication(options);
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const address=app.server.address();assert.ok(address && typeof address==='object');
  const base=`http://127.0.0.1:${address.port}`;
  async function api(path:string,token?:string,data?:unknown) {
    const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,data:await response.json() as Record<string,any>};
  }
  const login=async(name:string)=>(await api('/api/session',undefined,{nickname:name})).data as Session;
  return {...app,base,api,login};
}
function nextState(ws:WebSocket,condition:(room:RoomView)=>boolean=()=>true):Promise<RoomView> {
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{ws.off('message',listener);reject(new Error('WebSocket state timeout'));},3000);
    function listener(raw:Buffer) {
      const packet=JSON.parse(raw.toString());
      if(packet.type==='state' && condition(packet.room)) {clearTimeout(timeout);ws.off('message',listener);resolve(packet.room);}
    }
    ws.on('message',listener);
  });
}

test('six independent identities receive only their own hands; authorization, replay and reconnect',async()=>{
  const app=await launch();
  const sockets:WebSocket[]=[];
  try {
    assert.equal((await app.api('/api/rooms')).status,401);
    assert.equal((await app.api('/api/session',undefined,{nickname:''})).status,400);
    const players:Session[]=[];
    for(let i=1;i<=6;i++) players.push(await app.login(`玩家${i}`));
    const outsider=await app.login('外部玩家');
    const create=await app.api('/api/rooms',players[0].token,{rules:{rounds:2,turnSeconds:0}});
    assert.equal(create.status,201);
    const roomId=create.data.room.roomId;
    for(const player of players.slice(1)) assert.equal((await app.api(`/api/rooms/${roomId}/join`,player.token,{})).status,200);
    assert.equal((await app.api(`/api/rooms/${roomId}`,outsider.token)).status,403);
    assert.equal((await app.api(`/api/rooms/${roomId}/join`,outsider.token,{})).status,400);
    const action=(index:number,action:unknown,revision?:number)=>app.api(`/api/rooms/${roomId}/actions`,players[index].token,{action,revision});
    assert.equal((await action(1,{type:'start'})).status,400);
    for(let i=0;i<6;i++) await action(i,{type:'ready',ready:true});
    const started=await action(0,{type:'start'});assert.equal(started.status,200);
    const allIds=new Set<string>();
    for(let i=0;i<6;i++) {
      const {data}=await app.api(`/api/rooms/${roomId}`,players[i].token);
      const view=data.room as RoomView;
      assert.equal(view.hand.length,27);
      assert.equal(view.mySeat,i+1);
      assert.ok(view.players.every(p=>!('hand' in p)));
      view.hand.forEach(c=>allIds.add(c.id));
      const ws=new WebSocket(app.base.replace('http:','ws:')+'/ws');sockets.push(ws);
      await once(ws,'open');const packet=nextState(ws);
      ws.send(JSON.stringify({type:'auth',roomId,token:players[i].token}));
      const state=await packet;assert.deepEqual(state.hand.map(c=>c.id),view.hand.map(c=>c.id));
      assert.ok(state.players.every(p=>!('hand' in p)));
    }
    assert.equal(allIds.size,162);
    let view=(await app.api(`/api/rooms/${roomId}`,players[0].token)).data.room as RoomView;
    const current=view.currentTurnSeat-1;
    assert.equal((await action((current+1)%6,{type:'play',cardIds:[view.hand[0].id]})).status,400);
    const actingView=(await app.api(`/api/rooms/${roomId}`,players[current].token)).data.room as RoomView;
    const hints=await app.api(`/api/rooms/${roomId}/hints`,players[current].token,{});
    const chosen=hints.data.hints[0].cards.map((c:{id:string})=>c.id);
    const nextPackets=sockets.map(ws=>nextState(ws,room=>room.totalPlays===1));
    const played=await action(current,{type:'play',cardIds:chosen},actingView.revision);
    assert.equal(played.status,200);await Promise.all(nextPackets);
    assert.equal((await action(current,{type:'play',cardIds:chosen},actingView.revision)).status,409);
    const stateAfter=(await app.api(`/api/rooms/${roomId}`,players[current].token)).data.room as RoomView;
    assert.equal(stateAfter.hand.length,27-chosen.length);
    sockets[current].close();await once(sockets[current],'close');
    const reconnected=new WebSocket(app.base.replace('http:','ws:')+'/ws');sockets.push(reconnected);
    await once(reconnected,'open');const packet=nextState(reconnected);
    reconnected.send(JSON.stringify({type:'auth',roomId,token:players[current].token}));
    const restored=await packet;
    assert.deepEqual(restored.hand,stateAfter.hand);assert.equal(restored.totalPlays,1);
    assert.equal(restored.lastPlaySeat,current+1);
  } finally {sockets.forEach(ws=>ws.terminate());await app.close();}
});

test('server restart restores game and hashed credentials; invalid tokens cannot resume',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'guandan-six-test-'));
  let app=await launch({dataDir:directory,tick:false});
  try {
    const player=await app.login('存档玩家');
    const {data}=await app.api('/api/demo',player.token,{});
    const view=data.room as RoomView;
    await app.close();
    const disk=await readFile(join(directory,'state.json'),'utf8');
    assert.ok(!disk.includes(player.token),'raw bearer token must never be persisted');
    app=await launch({dataDir:directory,tick:false});
    const restored=await app.api(`/api/rooms/${view.roomId}`,player.token);
    assert.equal(restored.status,200);
    assert.deepEqual(restored.data.room.hand,view.hand);
    assert.equal((await app.api('/api/rooms',player.token,{})).status,409,'restart must not release an occupied seat');
    assert.equal((await app.api(`/api/rooms/${view.roomId}`,'0'.repeat(64))).status,401);
  } finally {await app.close();await rm(directory,{recursive:true,force:true});}
});

test('computer room accepts additional real players and fills the remaining seats at start',async()=>{
  const app=await launch();
  try {
    const host=await app.login('电脑局房主');
    const friend=await app.login('电脑局牌友');
    const created=await app.api('/api/demo',host.token,{waitForPlayers:true});
    assert.equal(created.status,201);
    const roomId=(created.data.room as RoomView).roomId;
    assert.equal((created.data.room as RoomView).mode,'computer');
    assert.equal((created.data.room as RoomView).status,'waiting');
    assert.equal((await app.api(`/api/rooms/${roomId}/join`,friend.token,{})).status,200);
    assert.equal((await app.api(`/api/rooms/${roomId}/actions`,friend.token,{action:{type:'ready',ready:true}})).status,200);
    const started=await app.api(`/api/rooms/${roomId}/actions`,host.token,{action:{type:'start'}});
    assert.equal(started.status,200);
    const view=started.data.room as RoomView;
    assert.equal(view.status,'playing');
    assert.equal(view.players.filter(player=>!player.bot).length,2);
    assert.equal(view.players.filter(player=>player.bot).length,4);
  } finally {await app.close();}
});

test('computer room allows players to leave completely during game',async()=>{
  const app=await launch();
  try {
    const player=await app.login('电脑局玩家');
    const created=await app.api('/api/demo',player.token,{waitForPlayers:false});
    assert.equal(created.status,201);
    const roomId=(created.data.room as RoomView).roomId;
    const roomView = created.data.room as RoomView;
    assert.equal(roomView.mode,'computer');
    // waitForPlayers:false 时，电脑局直接开始游戏
    assert.ok(['playing', 'tribute'].includes(roomView.status));
    // 游戏中离开电脑局应该完全退出，而不是保留座位
    const left=await app.api(`/api/rooms/${roomId}/actions`,player.token,{action:{type:'leave'}});
    assert.equal(left.status,200, `Leave failed: ${JSON.stringify(left.data)}`);
    assert.equal(left.data.room,null);
    assert.equal(app.rooms.has(roomId),false,'no-human computer rooms must be removed');
    assert.equal((await app.api(`/api/rooms/${roomId}/actions`,player.token,{action:{type:'leave'}})).status,200);
    // 离开后应该可以立即创建新房间
    const newRoom=await app.api('/api/rooms',player.token,{rules:{rounds:1}});
    assert.equal(newRoom.status,201);
  } finally {await app.close();}
});

test('leaving a waiting room releases the identity for a new computer room',async()=>{
  const app=await launch();
  try {
    const player=await app.login('退出测试');
    const created=await app.api('/api/rooms',player.token,{rules:{rounds:1}});
    const roomId=(created.data.room as RoomView).roomId;
    const left=await app.api(`/api/rooms/${roomId}/actions`,player.token,{action:{type:'leave'},revision:(created.data.room as RoomView).revision});
    assert.equal(left.status,200);assert.equal(left.data.room,null);
    assert.equal((await app.api('/api/demo',player.token,{waitForPlayers:true})).status,201);
  } finally {await app.close();}
});

test('personal statistics are private and wechat login needs a configured appid',async()=>{
  const app=await launch({persist:false,tick:false});
  try {
    const player=await app.login('统计玩家');
    assert.equal((await app.api('/api/stats')).status,401);
    const {data}=await app.api('/api/stats',player.token);
    const stats=data.stats as StatsSummary;
    assert.equal(stats.rounds,0);
    assert.equal(stats.winRate,0);
    assert.equal(stats.rooms,0);
    assert.equal((await app.api('/api/wechat/login',undefined,{code:'abc'})).status,400);
    assert.equal((await app.api('/api/wechat/login',undefined,{code:'0123456789abcdef'})).status,501);
  } finally {await app.close();}
});

test('wechat login exchanges a code for a stable identity through jscode2session',async()=>{
  const provider=createServer((req,res)=>{
    const url=new URL(req.url??'/','http://127.0.0.1');
    res.setHeader('Content-Type','application/json');
    if(url.pathname!=='/sns/jscode2session') {res.statusCode=404;res.end('{}');return;}
    if(url.searchParams.get('js_code')==='bad-code') {res.end(JSON.stringify({errcode:40029,errmsg:'invalid code'}));return;}
    res.end(JSON.stringify({openid:'openid-demo',session_key:'session'}));
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  const address=provider.address();assert.ok(address && typeof address==='object');
  const app=await launch({persist:false,tick:false,wechat:{appId:'wxtest',secret:'secret',api:`http://127.0.0.1:${address.port}`}});
  try {
    assert.equal((await app.api('/api/wechat/login',undefined,{code:'bad-code'})).status,401);
    const first=(await app.api('/api/wechat/login',undefined,{code:'valid-code-1234',nickname:'微信牌友'})).data as Session;
    assert.equal(first.provider,'wechat');
    assert.equal(first.nickname,'微信牌友');
    const again=(await app.api('/api/wechat/login',undefined,{code:'valid-code-1234'})).data as Session;
    assert.equal(again.userId,first.userId);
    assert.notEqual(again.token,first.token);
    assert.equal((await app.api('/api/rooms',first.token,{rules:{rounds:1}})).status,201);
    assert.equal((await app.api('/api/rooms',again.token,{rules:{rounds:1}})).status,409);
  } finally {await app.close();provider.close();}
});

test('repeated leave succeeds without exposing or mutating another player room',async()=>{
  const app=await launch();
  try{
    const host=await app.login('甲'),friend=await app.login('乙'),outsider=await app.login('外部玩家');
    const roomId=(await app.api('/api/rooms',host.token,{})).data.room.roomId;
    await app.api(`/api/rooms/${roomId}/join`,friend.token,{});
    const path=`/api/rooms/${roomId}/actions`;
    assert.equal((await app.api(path,host.token,{action:{type:'leave'}})).data.room,null);
    const before=structuredClone(app.rooms.get(roomId));
    for(const token of [host.token,outsider.token]){
      const repeat=await app.api(path,token,{action:{type:'leave'}});
      assert.equal(repeat.status,200);assert.equal(repeat.data.room,null);
      assert.equal((await app.api(`/api/rooms/${roomId}`,token)).status,403);
      assert.equal((await app.api(path,token,{action:{type:'ready',ready:true}})).status,403);
    }
    assert.deepEqual(app.rooms.get(roomId),before);
    assert.equal((await app.api(path,undefined,{action:{type:'leave'}})).status,401);
    assert.equal((await app.api('/api/rooms',host.token,{})).status,201);
  }finally{await app.close();}
});

test('mixed computer leave releases only the departing identity and cleans up after the last human',async()=>{
  const app=await launch();
  try{
    const host=await app.login('甲'),friend=await app.login('乙');
    const roomId=(await app.api('/api/demo',host.token,{waitForPlayers:true})).data.room.roomId;
    await app.api(`/api/rooms/${roomId}/join`,friend.token,{});
    const path=`/api/rooms/${roomId}/actions`;
    await app.api(path,friend.token,{action:{type:'ready',ready:true}});
    await app.api(path,host.token,{action:{type:'start'}});
    assert.equal((await app.api(path,host.token,{action:{type:'leave'}})).data.room,null);
    const view=(await app.api(`/api/rooms/${roomId}`,friend.token)).data.room as RoomView;
    assert.equal(view.players.length,6);assert.equal(view.players.filter(p=>p.bot).length,5);
    assert.equal(view.hostId,friend.userId);
    assert.equal((await app.api(`/api/rooms/${roomId}`,host.token)).status,403);
    assert.equal((await app.api('/api/rooms',host.token,{})).status,201);
    assert.equal((await app.api('/api/rooms',friend.token,{})).status,409);
    assert.equal((await app.api(path,friend.token,{action:{type:'leave'}})).data.room,null);
    assert.equal(app.rooms.has(roomId),false);
  }finally{await app.close();}
});

test('disconnection keeps the original membership until an explicit waiting-room leave',async()=>{
  const app=await launch();const sockets:WebSocket[]=[];
  try{
    const player=await app.login('甲'),friend=await app.login('乙'),other=await app.login('丙');
    const roomId=(await app.api('/api/rooms',player.token,{})).data.room.roomId;
    await app.api(`/api/rooms/${roomId}/join`,friend.token,{});
    const otherRoom=(await app.api('/api/rooms',other.token,{})).data.room.roomId;
    for(const session of [player,friend]){
      const ws=new WebSocket(app.base.replace('http:','ws:')+'/ws');sockets.push(ws);
      await once(ws,'open');const state=nextState(ws);
      ws.send(JSON.stringify({type:'auth',roomId,token:session.token}));await state;
    }
    const disconnected=nextState(sockets[1],r=>!r.players.find(p=>p.userId===player.userId)!.connected);
    sockets[0].close();await disconnected;
    assert.equal((await app.api('/api/demo',player.token,{waitForPlayers:true})).status,409);
    assert.equal((await app.api(`/api/rooms/${otherRoom}/join`,player.token,{})).status,409);
    assert.equal((await app.api(`/api/rooms/${roomId}`,player.token)).status,200);
    assert.equal((await app.api(`/api/rooms/${roomId}/actions`,player.token,{action:{type:'leave'}})).data.room,null);
    assert.equal((await app.api('/api/demo',player.token,{waitForPlayers:true})).status,201);
    assert.equal((await app.api(`/api/rooms/${roomId}`,player.token)).status,403);
  }finally{sockets.forEach(ws=>ws.terminate());await app.close();}
});

test('active friends leave keeps the seat and blocks a second room',async()=>{
  const app=await launch();
  try{
    const players:Session[]=[];for(let i=0;i<6;i++)players.push(await app.login(`玩家${i}`));
    const roomId=(await app.api('/api/rooms',players[0].token,{})).data.room.roomId;
    const path=`/api/rooms/${roomId}/actions`;
    for(const player of players){
      if(player!==players[0])await app.api(`/api/rooms/${roomId}/join`,player.token,{});
      await app.api(path,player.token,{action:{type:'ready',ready:true}});
    }
    await app.api(path,players[0].token,{action:{type:'start'}});
    const before=(await app.api(`/api/rooms/${roomId}`,players[0].token)).data.room as RoomView;
    const left=(await app.api(path,players[0].token,{action:{type:'leave'}})).data.room as RoomView;
    assert.deepEqual(left.hand,before.hand);assert.equal(left.players.length,6);
    assert.equal(left.players.find(p=>p.userId===players[0].userId)?.connected,false);
    assert.equal((await app.api('/api/demo',players[0].token,{waitForPlayers:true})).status,409);
    assert.equal((await app.api(`/api/rooms/${roomId}`,players[0].token)).status,200);
  }finally{await app.close();}
});

test('disconnected players can create new rooms after leaving',async()=>{
  const app=await launch({persist:false,tick:false});
  try {
    const player=await app.login('测试玩家');
    const room1Response=await app.api('/api/rooms',player.token,{rules:{rounds:1}});
    assert.equal(room1Response.status,201);
    const room1=(room1Response.data as {room:RoomView}).room;
    assert.equal((await app.api('/api/rooms',player.token,{rules:{rounds:1}})).status,409);
    const leaveResponse=await app.api(`/api/rooms/${room1.roomId}/actions`,player.token,{action:{type:'leave'}});
    assert.equal(leaveResponse.status,200);
    const room2Response=await app.api('/api/rooms',player.token,{rules:{rounds:1}});
    assert.equal(room2Response.status,201);
  } finally {await app.close();}
});

test('development demo can be disabled and rule constraints stay server authoritative',async()=>{
  const app=await launch({persist:false,tick:false,demo:false});
  try {
    const player=await app.login('规则玩家');
    assert.equal((await app.api('/api/demo',player.token,{})).status,403);
    assert.equal((await app.api('/api/rooms',player.token,{rules:{deckCount:1}})).status,400);
    assert.equal((await app.api('/api/rooms',player.token,{rules:{turnSeconds:3}})).status,400);
    assert.equal((await app.api('/api/rooms',player.token,{rules:{rounds:1,turnSeconds:15}})).status,201);
  } finally {await app.close();}
});
