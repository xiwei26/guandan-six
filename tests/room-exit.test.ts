import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { createApplication } from '../server/index.ts';
import type { RoomView,Session } from '../shared/types.ts';

const bundles=new Map<string,Promise<string>>();
async function harness(entry:'room'|'home'='room') {
  const app=createApplication({persist:false,tick:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const address=app.server.address();assert.ok(address&&typeof address==='object');
  const base=`http://127.0.0.1:${address.port}`;
  async function api(path:string,token?:string,data?:unknown) {
    const response=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data===undefined?undefined:JSON.stringify(data)});
    return {status:response.status,data:await response.json() as any};
  }
  const session=(await api('/api/session',undefined,{nickname:'退出测试'})).data as Session;
  const room=(await api('/api/rooms',session.token,{})).data.room as RoomView;
  const roomKey=`gd6.${base}.room`;
  const storage=new Map<string,unknown>([['gd6.server',base],[`gd6.${base}.session`,session],[roomKey,room.roomId]]);
  const control={holdSnapshot:false,dropLeaveReply:false,failLeave:false,legacy:false};
  const requests:{path:string;data:any}[]=[];
  const pending=new Set<Promise<void>>();
  const held:(()=>void)[]=[];
  let page:any,navigations=0,sockets=0,modal:any;
  const wx:any={
    getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:unknown)=>storage.set(key,value),removeStorageSync:(key:string)=>storage.delete(key),
    getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}}),onNetworkStatusChange(){},offNetworkStatusChange(){},showShareMenu(){},
    showModal:(options:any)=>{modal=options;},navigateBack:()=>navigations++,reLaunch:()=>navigations++,
    navigateTo:(options:any)=>{navigations++;options.success?.();},
    connectSocket(){sockets++;return {onOpen(){},onClose(){},onError(){},onMessage(){},close(){}};},
    request(options:any){
      const path=options.url.slice(base.length);requests.push({path,data:options.data});
      if(control.legacy&&path==='/api/rooms/current'){options.success({statusCode:404,data:{error:'接口不存在'}});return;}
      const leave=options.data?.action?.type==='leave';
      if(leave&&control.failLeave){options.fail({});return;}
      const request=api(path,session.token,options.data).then(result=>{
        if(control.legacy)delete result.data.roomId;
        if(leave&&control.dropLeaveReply){control.dropLeaveReply=false;options.fail({});return;}
        const deliver=()=>options.success({statusCode:result.status,data:result.data});
        if(control.holdSnapshot&&options.method==='GET')held.push(deliver);else deliver();
      }).finally(()=>pending.delete(request));
      pending.add(request);
    }
  };
  if(!bundles.has(entry))bundles.set(entry,build({entryPoints:[`miniprogram/pages/${entry}/index.ts`],bundle:true,platform:'neutral',format:'iife',write:false}).then(result=>result.outputFiles[0].text));
  runInNewContext(await bundles.get(entry)!,{wx,Page:(value:any)=>page=value,getCurrentPages:()=>[{},{}],console,setTimeout,clearTimeout,setInterval,clearInterval});
  page.setData=(data:any,callback?:()=>void)=>{Object.assign(page.data,data);callback?.();};
  if(entry==='room'){page.measureCards=()=>{};page.onLoad({id:room.roomId});page._visible=true;}
  else page.refreshSession();
  return {app,api,session,room,page,control,requests,storage,roomKey,held,modal:()=>modal,navigations:()=>navigations,sockets:()=>sockets,
    flush:async()=>{while(pending.size)await Promise.all([...pending]);},close:async()=>{page.suspend?.();await app.close();}};
}

test('mini exits during initial loading and ignores the late room snapshot',async()=>{
  const h=await harness();
  try{
    h.control.holdSnapshot=true;
    const loading=h.page.refresh();await h.flush();assert.equal(h.held.length,1);
    assert.equal(h.page._room,null);
    await h.page.leave();
    assert.equal(h.navigations(),1);assert.equal(h.storage.has(h.roomKey),false);
    h.held[0]();await loading;
    assert.equal(h.storage.has(h.roomKey),false,'late GET must not restore the exited room');
    assert.equal(h.sockets(),0,'late GET must not reopen the room connection');
    assert.equal((await h.api('/api/demo',h.session.token,{waitForPlayers:true})).status,201);
  }finally{await h.close();}
});

test('mini lobby discovers a server room after its local resume record is lost',async()=>{
  const h=await harness('home');
  try{
    h.storage.delete(h.roomKey);h.page.refreshSession();assert.equal(h.page.data.resumeId,'');
    h.page.onShow();await h.flush();
    assert.equal(h.page.data.resumeId,h.room.roomId);
    await h.page.leaveSavedRoom();assert.equal(h.page.data.resumeId,'');
    await h.page.enter({currentTarget:{dataset:{mode:'demo'}}});
    assert.equal(h.page.data.error,'');assert.equal(h.navigations(),1);
    assert.notEqual(h.storage.get(h.roomKey),h.room.roomId);
  }finally{await h.close();}
});

test('new and legacy server conflicts enable missing room recovery controls',async()=>{
  for(const legacy of [false,true]){
    const h=await harness('home');
    try{
      h.control.legacy=legacy;h.storage.delete(h.roomKey);h.page.refreshSession();
      if(legacy){await h.page.syncRoom();assert.equal(h.page.data.resumeId,'');}
      await h.page.enter({currentTarget:{dataset:{mode:'demo'}}});
      assert.match(h.page.data.error,/已恢复/);assert.equal(h.page.data.resumeId,h.room.roomId);
      await h.page.resume();assert.equal(h.navigations(),1);
      await h.page.leaveSavedRoom();assert.equal(h.page.data.resumeId,'');
      await h.page.enter({currentTarget:{dataset:{mode:'demo'}}});
      assert.equal(h.page.data.error,'');assert.equal(h.navigations(),2);
    }finally{await h.close();}
  }
});

test('late room discovery cannot overwrite a room created after leaving the old one',async()=>{
  const h=await harness('home');
  try{
    h.control.holdSnapshot=true;const discovery=h.page.syncRoom();await h.flush();
    assert.equal(h.held.length,1);h.control.holdSnapshot=false;
    await h.page.leaveSavedRoom();
    await h.page.enter({currentTarget:{dataset:{mode:'demo'}}});
    const newRoom=h.storage.get(h.roomKey);assert.ok(newRoom);assert.notEqual(newRoom,h.room.roomId);
    h.held[0]();await discovery;
    assert.equal(h.storage.get(h.roomKey),newRoom);assert.equal(h.page.data.resumeId,newRoom);
  }finally{await h.close();}
});

test('mini retries a lost leave response and navigates home exactly once',async()=>{
  const h=await harness();
  try{
    const friend=(await h.api('/api/session',undefined,{nickname:'留在房间'})).data as Session;
    await h.api(`/api/rooms/${h.room.roomId}/join`,friend.token,{});
    h.page._room=h.room;h.control.dropLeaveReply=true;
    assert.equal(await h.page.act({type:'leave'}),false);
    assert.equal(h.navigations(),0);assert.equal(h.storage.get(h.roomKey),h.room.roomId);
    assert.equal(await h.page.act({type:'leave'}),true);
    assert.equal(h.navigations(),1);assert.equal(h.storage.has(h.roomKey),false);
    h.page.goHome();assert.equal(h.navigations(),1);
    assert.equal((await h.api('/api/demo',h.session.token,{waitForPlayers:true})).status,201);
  }finally{await h.close();}
});

test('mini keeps the room when HTTP leave fails and allows a later retry',async()=>{
  const h=await harness();
  try{
    h.control.failLeave=true;await h.page.leave();
    assert.equal(h.navigations(),0);assert.equal(h.storage.get(h.roomKey),h.room.roomId);
    assert.equal(h.app.rooms.get(h.room.roomId)?.players.length,1);
    assert.equal((await h.api('/api/demo',h.session.token,{waitForPlayers:true})).status,409);
    h.control.failLeave=false;await h.page.leave();
    assert.equal(h.navigations(),1);assert.equal(h.storage.has(h.roomKey),false);
  }finally{await h.close();}
});

test('mini lobby exits a saved active computer room and removes the empty room',async()=>{
  const h=await harness('home');
  try{
    await h.api(`/api/rooms/${h.room.roomId}/actions`,h.session.token,{action:{type:'leave'}});
    const computer=(await h.api('/api/demo',h.session.token,{})).data.room as RoomView;
    h.storage.set(h.roomKey,computer.roomId);h.page.refreshSession();
    await h.page.leaveSavedRoom();
    assert.equal(h.page.data.error,'');assert.equal(h.page.data.resumeId,'');
    assert.equal(h.storage.has(h.roomKey),false);assert.equal(h.app.rooms.has(computer.roomId),false);
    assert.equal((await h.api('/api/demo',h.session.token,{waitForPlayers:true})).status,201);
  }finally{await h.close();}
});

test('mini active friends exit retains its resume entry and blocks opening another room',async()=>{
  const h=await harness();
  try{
    const path=`/api/rooms/${h.room.roomId}/actions`;
    for(let i=0;i<5;i++){
      const friend=(await h.api('/api/session',undefined,{nickname:`好友${i}`})).data as Session;
      await h.api(`/api/rooms/${h.room.roomId}/join`,friend.token,{});
      await h.api(path,friend.token,{action:{type:'ready',ready:true}});
    }
    await h.api(path,h.session.token,{action:{type:'ready',ready:true}});
    h.page._room=(await h.api(path,h.session.token,{action:{type:'start'}})).data.room;
    await h.page.leave();assert.match(h.modal().content,/保留/);
    h.modal().success({confirm:true});await h.flush();
    assert.equal(h.navigations(),1);assert.equal(h.storage.get(h.roomKey),h.room.roomId);
    assert.equal((await h.api('/api/demo',h.session.token,{waitForPlayers:true})).status,409);
  }finally{await h.close();}
});
