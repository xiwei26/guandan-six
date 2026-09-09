import type { RoomView, Session } from '../shared/types';
export type ConnectionState='connecting'|'online'|'offline';
type SocketPlatform=Pick<typeof wx,'connectSocket'>;
interface Handlers {room:(room:RoomView)=>void;state:(state:ConnectionState)=>void;error:(message:string)=>void;left:()=>void}

/** One connection per visible room. A generation invalidates late events after backgrounding. */
export class RoomConnection {
  private socket:WechatMiniprogram.SocketTask|undefined;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private generation=0;
  private retry=0;
  private stopped=true;
  constructor(private platform:SocketPlatform,private base:string,private session:Session,private roomId:string,private handlers:Handlers) {}
  start() {if(!this.stopped)return;this.stopped=false;this.retry=0;this.connect();}
  stop() {
    this.stopped=true;this.generation++;if(this.timer)clearTimeout(this.timer);this.timer=undefined;
    const socket=this.socket;this.socket=undefined;socket?.close({code:1000,reason:'Page hidden'});
  }
  private connect() {
    if(this.stopped)return;
    this.socket?.close({code:1000,reason:'Reconnecting'});this.socket=undefined;
    const generation=++this.generation;const current=()=>!this.stopped&&this.generation===generation;
    this.handlers.state('connecting');let scheduled=false;
    const disconnected=()=>{
      if(!current()||scheduled)return;scheduled=true;this.handlers.state('offline');
      this.timer=setTimeout(()=>this.connect(),Math.min(500*2**this.retry++,2000));
    };
    const socket=this.platform.connectSocket({url:this.base.replace(/^http/,'ws')+'/ws',success:()=>{},fail:disconnected});
    this.socket=socket;
    socket.onOpen(()=>{if(!current()){socket.close({});return;}socket.send({data:JSON.stringify({type:'auth',token:this.session.token,roomId:this.roomId}),fail:disconnected});});
    socket.onMessage(event=>{
      if(!current()||typeof event.data!=='string')return;
      let packet:{type:string;room?:RoomView;error?:string};
      try{packet=JSON.parse(event.data);}catch{this.handlers.error('收到无效的牌局消息');return;}
      if(packet.type==='state'&&packet.room){this.retry=0;this.handlers.state('online');this.handlers.room(packet.room);}
      if(packet.type==='left'){this.stop();this.handlers.left();}
      if(packet.type==='error'){this.handlers.error(packet.error||'连接认证失败');this.stop();this.handlers.state('offline');}
    });
    socket.onClose(disconnected);socket.onError(()=>{socket.close({});disconnected();});
  }
}
