import { API_BASE_URL } from '../config';
import type { Combination, GameAction, HistoryEntry, RoomView, RuleConfig, Session, StatsSummary } from '../shared/types';

type Platform = Pick<typeof wx,'request'|'login'|'getStorageSync'|'setStorageSync'|'removeStorageSync'|'getAccountInfoSync'>;
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function normalizeServer(value: string, development: boolean): string {
  const url=value.trim().replace(/\/+$/,'');
  const match=url.match(/^(https?):\/\/([a-z0-9.-]+)(?::(\d{1,5}))?$/i);
  if(!match || (match[3] && (+match[3]<1 || +match[3]>65535))) throw new Error('填写完整服务地址，例如 https://game.example.com，不含路径');
  const local=/^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i.test(match[2]);
  if(match[1].toLowerCase()==='http' && !(development&&local)) throw new Error('请使用 HTTPS 地址；HTTP 仅用于开发版的本机或局域网联调');
  return url;
}
export class MiniClient {
  constructor(private platform: Platform) {}
  server(): string { return this.platform.getStorageSync('gd6.server') || API_BASE_URL; }
  private key(kind:string) { return `gd6.${this.server()}.${kind}`; }
  setServer(value:string) {
    const development=this.platform.getAccountInfoSync().miniProgram.envVersion==='develop';
    const result=normalizeServer(value,development);
    this.platform.setStorageSync('gd6.server',result);
  }
  session(): Session|null { const s=this.platform.getStorageSync(this.key('session'));return s&&typeof s.token==='string'&&typeof s.userId==='string'?s:null; }
  roomId(): string { return this.platform.getStorageSync(this.key('room'))||''; }
  remember(roomId:string) { if(roomId)this.platform.setStorageSync(this.key('room'),roomId);else this.platform.removeStorageSync(this.key('room')); }
  async request<T>(path:string,data?:unknown,anonymous=false):Promise<T> {
    const base=this.server();
    normalizeServer(base,this.platform.getAccountInfoSync().miniProgram.envVersion==='develop');
    const session=this.session();
    if(!anonymous&&!session)throw new ApiError(401,'请先登录或以游客身份进入');
    return new Promise<T>((resolve,reject)=>{
      this.platform.request({url:base+path,method:data===undefined?'GET':'POST',data:data as WechatMiniprogram.RequestOption['data'],timeout:10000,
        header:{'Content-Type':'application/json',...(!anonymous&&session?{Authorization:`Bearer ${session.token}`}:{})},
        success:result=>{
          if(result.statusCode>=200&&result.statusCode<300){resolve(result.data as T);return;}
          if(result.statusCode===401&&!anonymous)this.platform.removeStorageSync(`gd6.${base}.session`);
          const error=result.data as {error?:string};reject(new ApiError(result.statusCode,error?.error||'请求失败，请重试'));
        },
        fail:()=>reject(new ApiError(0,'连接失败，请检查服务是否启动、连接设置及微信合法域名配置'))
      });
    });
  }
  async login(kind:'guest'|'wechat',nickname:string):Promise<Session> {
    const base=this.server();
    const name=nickname.trim();if(!name||name.length>20)throw new Error('请输入 1–20 字的昵称');
    let session:Session;
    if(kind==='wechat') {
      const code=await new Promise<string>((resolve,reject)=>this.platform.login({timeout:10000,success:r=>r.code?resolve(r.code):reject(new Error('微信未返回登录凭证，请重试')),fail:()=>reject(new Error('微信登录暂不可用，可以选择游客进入'))}));
      session=await this.request<Session>('/api/wechat/login',{code,nickname:name},true);
    } else session=await this.request<Session>('/api/session',{nickname:name},true);
    if(this.server()!==base)throw new Error('服务地址已变更，请重新登录');
    this.platform.setStorageSync(`gd6.${base}.session`,session);return session;
  }
  async enter(mode:'create'|'join'|'demo',value?:Partial<RuleConfig>|string):Promise<RoomView> {
    const path=mode==='create'?'/api/rooms':mode==='demo'?'/api/demo':`/api/rooms/${value}/join`;
    const result=await this.request<{room:RoomView}>(path,mode==='create'?{rules:value}:{});
    this.remember(result.room.roomId);return result.room;
  }
  async room(id:string):Promise<RoomView> { const result=await this.request<{room:RoomView}>(`/api/rooms/${id}`);this.remember(id);return result.room; }
  async action(room:RoomView,action:GameAction):Promise<RoomView|null> {
    const result=await this.request<{room:RoomView|null}>(`/api/rooms/${room.roomId}/actions`,{action,revision:room.revision});
    if(action.type==='leave')this.remember(result.room?.roomId||'');return result.room;
  }
  async hints(id:string):Promise<Combination[]> { return (await this.request<{hints:Combination[]}>(`/api/rooms/${id}/hints`,{})).hints; }
  async history() {return this.request<{history:HistoryEntry[]}>('/api/history');}
  async stats() {return this.request<{stats:StatsSummary}>('/api/stats');}
}
let singleton:MiniClient|undefined;
export function client():MiniClient { return singleton??(singleton=new MiniClient(wx)); }
export const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'操作失败，请重试';
