import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameAction, RoomView, RuleConfig, Session } from '../shared/types';
import { ApiError, loadSession, request, roomKey } from './api';

export function useGame() {
  const [session,setSession]=useState<Session|null>(loadSession);
  const [room,setRoom]=useState<RoomView|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [connection,setConnection]=useState<'connecting'|'online'|'offline'>('offline');
  const [resumeId,setResumeId]=useState(()=>localStorage.getItem(roomKey)??'');
  const pending=useRef(false);
  const roomId=room?.roomId;
  const accept=useCallback((next:RoomView|null)=>{
    setRoom(old=>next && old?.roomId===next.roomId && old.revision>next.revision?old:next);
    if(next){localStorage.setItem(roomKey,next.roomId);setResumeId(next.roomId);}
  },[]);
  const report=useCallback((cause:unknown)=>{
    if(cause instanceof ApiError && cause.status===401){localStorage.removeItem('guandan.session');setSession(null);setRoom(null);}
    setError(cause instanceof Error?cause.message:'网络连接失败，请稍后重试');
  },[]);
  async function run<T>(job:()=>Promise<T>):Promise<T|undefined> {
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');
    try{return await job();}catch(cause){report(cause);return undefined;}finally{pending.current=false;setBusy(false);}
  }
  async function identity(nickname:string) {
    if(session)return session;
    const created=await request<Session>('/api/session',null,{nickname});
    localStorage.setItem('guandan.session',JSON.stringify(created));setSession(created);return created;
  }
  async function enter(nickname:string,mode:'create'|'join'|'demo',value?:Partial<RuleConfig>|string) {
    return run(async()=>{
      const user=await identity(nickname);
      const url=mode==='create'?'/api/rooms':mode==='demo'?'/api/demo':`/api/rooms/${value}/join`;
      const result=await request<{room:RoomView}>(url,user,mode==='create'?{rules:value}:{});
      accept(result.room);
      const clean=new URL(location.href);clean.searchParams.delete('room');history.replaceState(null,'',clean);
      return true;
    });
  }
  async function action(action:GameAction) {
    if(!room || !session)return;
    return run(async()=>{
      const result=await request<{room:RoomView|null}>(`/api/rooms/${room.roomId}/actions`,session,{action,revision:room.revision});
      if(action.type==='leave') {
        if(!result.room){localStorage.removeItem(roomKey);setResumeId('');}
        setRoom(null);
      } else accept(result.room);
      return true;
    });
  }
  const resume=()=>run(async()=>{
    const result=await request<{room:RoomView}>(`/api/rooms/${resumeId}`,session);
    accept(result.room);return true;
  });
  useEffect(()=>{
    if(!session || !resumeId)return;
    let active=true;
    request<{room:RoomView}>(`/api/rooms/${resumeId}`,session).then(result=>{if(active)accept(result.room);}).catch(cause=>{
      if(!active)return;
      if(cause instanceof ApiError && [403,404].includes(cause.status)){localStorage.removeItem(roomKey);setResumeId('');}
      else report(cause);
    });
    return()=>{active=false;};
    // Restore only when identity changes, not when temporarily leaving an active table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session?.token,accept,report]);
  useEffect(()=>{
    if(!roomId || !session)return;
    let disposed=false;let ws:WebSocket|undefined;let retry:ReturnType<typeof setTimeout>;let attempts=0;
    const connect=()=>{
      setConnection('connecting');
      ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);
      ws.onopen=()=>{ws?.send(JSON.stringify({type:'auth',roomId,token:session.token}));};
      ws.onmessage=event=>{
        if(disposed)return;
        const data=JSON.parse(event.data);
        if(data.type==='state'){attempts=0;setConnection('online');accept(data.room);}
        if(data.type==='error'){setError(data.error);}
        if(data.type==='left'){setRoom(null);localStorage.removeItem(roomKey);setResumeId('');}
      };
      ws.onclose=()=>{if(disposed)return;setConnection('offline');retry=setTimeout(connect,Math.min(500*2**attempts++,2000));};
      ws.onerror=()=>ws?.close();
    };
    connect();
    return()=>{disposed=true;clearTimeout(retry);if(ws){ws.onclose=null;ws.onmessage=null;if(ws.readyState===WebSocket.CONNECTING)ws.onopen=()=>ws?.close();else ws.close();}setConnection('offline');};
  },[roomId,session?.token,accept]);
  return {session,room,error,setError,busy,connection,enter,action,accept,report,resume,resumeId};
}
