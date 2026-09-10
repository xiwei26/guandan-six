import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { addPlayer, applyAction, createMatchStats, createRoom, getRoomView, setConnected, tickGame } from './game.ts';
import { findHints } from '../shared/cards.ts';
import { DEFAULT_RULES, type GameAction, type GameState, type HistoryEntry, type Session, type StatsSummary } from '../shared/types.ts';

interface StoredSession { userId: string; nickname: string; createdAt: number; provider?: Session['provider'] }
interface StoredHistory extends HistoryEntry {userIds: string[]}
interface SavedData { version: 1; rooms: GameState[]; sessions: [string,StoredSession][]; history: StoredHistory[] }
interface Options { dataDir?: string; persist?: boolean; demo?: boolean; tick?: boolean; wechat?: {appId?:string;secret?:string;api?:string} }
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败';
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

export function createApplication(options: Options = {}) {
  const rooms = new Map<string,GameState>();
  const sessions = new Map<string,StoredSession>();
  const connections = new Map<WebSocket,{userId:string;roomId:string}>();
  let history: StoredHistory[] = [];
  const file = resolve(options.dataDir ?? 'data', 'state.json');
  const persist = options.persist !== false;
  const wechat = { appId: options.wechat?.appId ?? process.env.WECHAT_APPID ?? '', secret: options.wechat?.secret ?? process.env.WECHAT_SECRET ?? '', api: options.wechat?.api ?? process.env.WECHAT_API ?? 'https://api.weixin.qq.com' };
  if (persist && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file,'utf8')) as SavedData;
    if (saved.version !== 1) throw new Error('不支持的本地存档版本');
    saved.rooms.forEach(room => {
      room.players.forEach(player => { player.connected = player.bot; });
      if (room.deadline !== null) room.deadline = Date.now() + 30_000;
      if (!room.matchStats) room.matchStats = {...createMatchStats(),rounds:['settlement','finished'].includes(room.status)?room.round:Math.max(0,room.round-1),totalPlays:room.totalPlays,biggestBomb:room.biggestBomb};
      room.rules = {...DEFAULT_RULES,...room.rules};
      if (typeof room.roundBomb !== 'number') room.roundBomb = 0;
      if (!room.playedCounts) room.playedCounts = {};
      rooms.set(room.roomId,room);
    });
    saved.sessions.forEach(([tokenHash,session]) => sessions.set(tokenHash,session));
    history = saved.history.map(entry => ({...entry,biggestBomb: Number(entry.biggestBomb) || 0,
      order: entry.order.map(seat => ({...seat,userId: typeof seat.userId === 'string' ? seat.userId : ''}))}));
  }
  function save() {
    if (!persist) return;
    mkdirSync(dirname(file),{recursive:true});
    const snapshot: SavedData = {version:1,rooms:[...rooms.values()],sessions:[...sessions],history};
    writeFileSync(file+'.tmp',JSON.stringify(snapshot),{mode:0o600});
    renameSync(file+'.tmp',file);
  }
  function record(room: GameState) {
    if (room.settlement && !history.some(h=>h.roomId===room.roomId && h.round===room.round)) {
      history.unshift({roomId:room.roomId,round:room.round,at:Date.now(),winner:room.settlement.winner,upgrade:room.settlement.upgrade,biggestBomb:room.settlement.biggestBomb,userIds:room.players.map(p=>p.userId),
        order:room.settlement.order.map(seat=>{const p=room.players.find(p=>p.seat===seat)!;return {nickname:p.nickname,userId:p.userId,seat,team:p.team};})});
      history=history.slice(0,2000);
    }
  }
  function summarize(userId:string):StatsSummary {
    const mine=history.filter(entry=>entry.userIds.includes(userId));
    let wins=0,firsts=0,sweeps=0,biggestBomb=0;
    for(const entry of mine) {
      const me=entry.order.find(seat=>seat.userId===userId);
      if(me && me.team===entry.winner) wins++;
      if(entry.order[0]?.userId===userId) firsts++;
      if(me && me.team===entry.winner && entry.order.slice(0,3).every(seat=>seat.team===entry.winner)) sweeps++;
      biggestBomb=Math.max(biggestBomb,entry.biggestBomb);
    }
    const rate=(value:number)=>mine.length?Number((value/mine.length*100).toFixed(1)):0;
    return {rounds:mine.length,wins,winRate:rate(wins),firsts,firstRate:rate(firsts),sweeps,biggestBomb,rooms:new Set(mine.map(entry=>entry.roomId)).size};
  }
  async function wechatLogin(code:string,nickname:string):Promise<Session> {
    // Identity is derived from openid inside one appid; the raw openid is never stored or returned.
    if(!wechat.appId || !wechat.secret) throw new HttpError(501,'服务端未配置微信登录（WECHAT_APPID / WECHAT_SECRET），请先用游客身份进入');
    const url=new URL('/sns/jscode2session',wechat.api);
    url.searchParams.set('appid',wechat.appId);url.searchParams.set('secret',wechat.secret);
    url.searchParams.set('js_code',code);url.searchParams.set('grant_type','authorization_code');
    let payload:Record<string,unknown>;
    try {const response=await fetch(url,{signal:AbortSignal.timeout(6000)});payload=await response.json() as Record<string,unknown>;}
    catch {throw new HttpError(502,'暂时无法连接微信登录服务，请稍后重试');}
    const openid=typeof payload.openid==='string'?payload.openid:'';
    if(!openid || typeof payload.errcode==='number' && payload.errcode!==0)
      throw new HttpError(401,`微信登录失败：${typeof payload.errmsg==='string'&&payload.errmsg?payload.errmsg:'登录凭证无效'}`);
    const userId=`wx-${createHash('sha256').update(`${wechat.appId}:${openid}`).digest('hex').slice(0,24)}`;
    const name=nickname||`牌友${userId.slice(3,7)}`;
    const token=randomBytes(32).toString('hex');
    sessions.set(hash(token),{userId,nickname:name,createdAt:Date.now(),provider:'wechat'});save();
    return {token,userId,nickname:name,provider:'wechat'};
  }
  function broadcast(room: GameState) {
    record(room);
    for (const [ws,identity] of connections) {
      if (identity.roomId===room.roomId && ws.readyState===WebSocket.OPEN) {
        if (room.players.some(p=>p.userId===identity.userId)) ws.send(JSON.stringify({type:'state',room:getRoomView(room,identity.userId)}));
        else { ws.send(JSON.stringify({type:'left'})); connections.delete(ws); ws.close(1000,'Left room'); }
      }
    }
    save();
  }
  function authenticate(token: unknown): StoredSession {
    if (typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401,'身份已失效，请重新输入昵称进入');
    const session=sessions.get(hash(token));
    if (!session) throw new HttpError(401,'身份已失效，请重新输入昵称进入');
    return session;
  }
  function roomFor(roomId:string,userId?:string) {
    const room=rooms.get(roomId);
    if (!room) throw new HttpError(404,'房间不存在，请检查六位房间号');
    if (userId && !room.players.some(p=>p.userId===userId)) throw new HttpError(403,'你不在这个房间中');
    return room;
  }
  function vacant(userId:string) {
    const existing=[...rooms.values()].find(r=>r.players.some(p=>p.userId===userId) && r.status!=='finished');
    if (existing) throw new HttpError(409,`你已在房间 ${existing.roomId} 中，请先返回或退出该房间`);
  }
  function allocate(session:StoredSession,rules:Parameters<typeof createRoom>[3]) {
    vacant(session.userId);
    // Expired completed/waiting rooms are removed only when nobody is connected.
    for (const [id,room] of rooms) if (Date.now()-room.createdAt>24*3600_000 && ['waiting','finished'].includes(room.status)
      && ![...connections.values()].some(c=>c.roomId===id)) rooms.delete(id);
    if (rooms.size>=100) throw new HttpError(503,'开发服务器房间已满，请稍后再试');
    let roomId:string;
    do {roomId=String(randomInt(100000,1000000));} while(rooms.has(roomId));
    const room=createRoom(roomId,session.userId,session.nickname,rules);
    rooms.set(roomId,room);
    return room;
  }
  function act(room:GameState,session:StoredSession,payload:Record<string,unknown>) {
    const action=payload.action as GameAction;
    if (!action || typeof action!=='object' || typeof action.type!=='string') throw new HttpError(400,'操作格式错误');
    if (['play','pass','tribute'].includes(action.type) && payload.revision!==undefined && payload.revision!==room.revision)
      throw new HttpError(409,'牌局已更新，请根据当前牌面重新操作');
    applyAction(room,session.userId,action);
    broadcast(room);
    if (!room.players.length) {rooms.delete(room.roomId);save();}
    return {room:room.players.some(p=>p.userId===session.userId)?getRoomView(room,session.userId):null};
  }
  const rate = new Map<string,{count:number;until:number}>();
  function limit(key:string,max:number) {
    const now=Date.now(); let bucket=rate.get(key);
    if (!bucket || bucket.until<now) {bucket={count:0,until:now+60_000};rate.set(key,bucket);}
    if (++bucket.count>max) throw new HttpError(429,'操作太频繁，请稍后重试');
  }
  function json(res:ServerResponse,status:number,data:unknown) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(data));
  }
  async function body(req:IncomingMessage):Promise<Record<string,unknown>> {
    let data='';
    for await(const chunk of req) {
      data+=chunk.toString();
      if (Buffer.byteLength(data)>16384) throw new HttpError(413,'请求内容过大');
    }
    if (!data) return {};
    try {const parsed=JSON.parse(data);if (!parsed || typeof parsed!=='object'||Array.isArray(parsed)) throw new Error();return parsed;}
    catch {throw new HttpError(400,'请求必须是 JSON 对象');}
  }
  const publicDir=resolve('dist');
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url??'/',`http://${req.headers.host??'localhost'}`);
      const path=url.pathname;
      if (path==='/api/health') return json(res,200,{ok:true,version:'0.1.0',ruleVersion:'6P_V2'});
      if (!path.startsWith('/api/')) {
        if (req.method!=='GET' && req.method!=='HEAD') throw new HttpError(405,'不支持的请求方式');
        const requested=resolve(publicDir,'.'+decodeURIComponent(path));
        if (requested!==publicDir && !requested.startsWith(publicDir+sep)) throw new HttpError(403,'无法访问该路径');
        const target=existsSync(requested) && extname(requested) ? requested : resolve(publicDir,'index.html');
        if (!existsSync(target)) throw new HttpError(404,'前端未构建，请运行 npm run dev 或 npm run build');
        const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon'};
        res.writeHead(200,{'Content-Type':mime[extname(target)]??'application/octet-stream','X-Content-Type-Options':'nosniff'});
        res.end(req.method==='HEAD'?undefined:readFileSync(target)); return;
      }
      const address=req.socket.remoteAddress??'local';
      limit(address,600);
      if (path==='/api/session' && req.method==='POST') {
        limit('session:'+address,60);
        const data=await body(req);
        const nickname=typeof data.nickname==='string'?data.nickname.trim():'';
        if (!nickname || nickname.length>20) throw new HttpError(400,'昵称需要 1–20 个字符');
        const token=randomBytes(32).toString('hex');
        const session={userId:randomBytes(12).toString('hex'),nickname,createdAt:Date.now()};
        sessions.set(hash(token),session);save();
        const result:Session={token,userId:session.userId,nickname,provider:'guest'};
        return json(res,201,result);
      }
      if (path==='/api/wechat/login' && req.method==='POST') {
        limit('wechat:'+address,30);
        const data=await body(req);
        const code=typeof data.code==='string'?data.code.trim():'';
        if(!/^[A-Za-z0-9_-]{4,128}$/.test(code)) throw new HttpError(400,'微信登录凭证无效，请重新进入');
        const nickname=typeof data.nickname==='string'?data.nickname.trim().slice(0,20):'';
        if(nickname.length>20) throw new HttpError(400,'昵称需要 1–20 个字符');
        return json(res,200,await wechatLogin(code,nickname));
      }
      const session=authenticate(req.headers.authorization?.replace(/^Bearer /,''));
      if (path==='/api/history' && req.method==='GET') {
        return json(res,200,{history:history.filter(h=>h.userIds.includes(session.userId)).slice(0,50).map(({userIds:_,...entry})=>entry)});
      }
      if (path==='/api/stats' && req.method==='GET') return json(res,200,{stats:summarize(session.userId)});
      if ((path==='/api/rooms'||path==='/api/demo') && req.method==='POST') {
        const data=await body(req);
        if (path==='/api/demo' && options.demo===false) throw new HttpError(403,'当前环境未开放体验桌');
        const room=allocate(session,path==='/api/demo'?{rounds:1,turnSeconds:30}:data.rules as Parameters<typeof createRoom>[3]);
        if (path==='/api/demo') {
          ['青竹','橘子','远山','麦穗','清风'].forEach((name,index)=>addPlayer(room,`bot-${room.roomId}-${index}`,name,true));
          applyAction(room,session.userId,{type:'ready',ready:true});
          applyAction(room,session.userId,{type:'start'});
        }
        broadcast(room);return json(res,201,{room:getRoomView(room,session.userId)});
      }
      const route=path.match(/^\/api\/rooms\/(\d{6})(?:\/(join|actions|hints))?$/);
      if (!route) throw new HttpError(404,'接口不存在');
      const [,roomId,operation]=route;
      const room=roomFor(roomId,operation==='join'?undefined:session.userId);
      if (!operation && req.method==='GET') return json(res,200,{room:getRoomView(room,session.userId)});
      if (req.method!=='POST') throw new HttpError(405,'不支持的请求方式');
      const data=await body(req);
      if (operation==='join') {
        if (!room.players.some(p=>p.userId===session.userId)) {vacant(session.userId);addPlayer(room,session.userId,session.nickname);}
        broadcast(room);return json(res,200,{room:getRoomView(room,session.userId)});
      }
      if (operation==='actions') return json(res,200,act(room,session,data));
      if (operation==='hints') {
        const player=room.players.find(p=>p.userId===session.userId)!;
        if (room.status!=='playing'||room.currentTurnSeat!==player.seat) throw new HttpError(400,'请等待轮到你出牌');
        return json(res,200,{hints:findHints(player.hand,room.lastPlay,room.currentLevel,room.rules)});
      }
      throw new HttpError(404,'接口不存在');
    } catch(error) {json(res,error instanceof HttpError?error.status:400,{error:message(error)});}
  });
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:16384});
  wss.on('connection',ws=>{
    let alive=true;
    const authTimeout=setTimeout(()=>{if(!connections.has(ws)) ws.close(1008,'Authentication required');},5000);
    ws.on('pong',()=>{alive=true;});
    const ping=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},20_000);
    ws.on('message',raw=>{
      try {
        const data=JSON.parse(raw.toString()) as Record<string,unknown>;
        if (!data || typeof data!=='object') throw new Error('消息格式错误');
        if (data.type==='auth') {
          if (connections.has(ws)) throw new Error('此连接已认证');
          const session=authenticate(data.token);
          const room=roomFor(String(data.roomId),session.userId);
          connections.set(ws,{userId:session.userId,roomId:room.roomId});clearTimeout(authTimeout);
          setConnected(room,session.userId,true);broadcast(room);
        } else {
          const identity=connections.get(ws);
          if (!identity) throw new Error('请先认证');
          limit('ws:'+identity.userId,180);
          if (data.type!=='action') throw new Error('不支持的消息类型');
          const room=roomFor(identity.roomId,identity.userId);
          const player=room.players.find(p=>p.userId===identity.userId)!;
          const result=act(room,{userId:player.userId,nickname:player.nickname,createdAt:0},data);
          ws.send(JSON.stringify({type:'ack',id:data.id,...result}));
        }
      } catch(error) {ws.send(JSON.stringify({type:'error',error:message(error)}));}
    });
    ws.on('close',()=>{
      clearTimeout(authTimeout);clearInterval(ping);
      const identity=connections.get(ws);connections.delete(ws);
      if (!identity) return;
      const other=[...connections.values()].some(c=>c.userId===identity.userId && c.roomId===identity.roomId);
      const room=rooms.get(identity.roomId);
      if (!other && room?.players.some(p=>p.userId===identity.userId)) {setConnected(room,identity.userId,false);broadcast(room);}
    });
    ws.on('error',()=>ws.close());
  });
  const timer=options.tick===false?null:setInterval(()=>{
    for (const room of rooms.values()) {
      try {if(tickGame(room)) broadcast(room);} catch(error) {console.error('Room tick error:',room.roomId,message(error));}
    }
    for(const [key,bucket] of rate) if(bucket.until<Date.now()) rate.delete(key);
  },250);
  async function close() {
    if(timer) clearInterval(timer);
    for(const ws of wss.clients) ws.terminate();
    await new Promise<void>(r=>wss.close(()=>r()));
    save();
    if(server.listening) await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));
  }
  return {server,rooms,sessions,close};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createApplication({demo:process.env.ENABLE_DEMO!=='false',dataDir:process.env.DATA_DIR});
  const port=Number(process.env.PORT??3001);
  app.server.listen(port,'0.0.0.0',()=>console.log(`六人掼蛋服务已启动 http://localhost:${port}`));
  for(const signal of ['SIGTERM','SIGINT'] as const) process.on(signal,()=>{void app.close().then(()=>process.exit(0));});
}
