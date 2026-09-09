import { ApiError,client,errorMessage } from '../../services/client';
import { RoomConnection,type ConnectionState } from '../../services/connection';
import type { GameAction,RoomView,Tribute,PublicPlayer } from '../../shared/types';
import { tableView } from '../../utils/presentation';

type Rect={id:string;left:number;right:number;top:number;bottom:number};
Page({
  data:{vm:null as ReturnType<typeof tableView>|null,roomId:'',busy:false,error:'',connection:'connecting' as ConnectionState,connectionText:'连接中',seconds:'',sortLabel:'按点数',swapping:false,swapSeat:0,counterOpen:false,loading:true},
  _room:null as RoomView|null,_connection:undefined as RoomConnection|undefined,_timer:undefined as ReturnType<typeof setInterval>|undefined,
  _selected:[] as string[],_sort:'rank' as 'rank'|'suit',_hintIndex:0,_visible:false,_epoch:0,_pending:false,
  _rects:[] as Rect[],_drag:null as {select:boolean;seen:Set<string>}|null,
  _network:undefined as ((result:WechatMiniprogram.OnNetworkStatusChangeListenerResult)=>void)|undefined,
  onLoad(query:Record<string,string|undefined>) {
    const id=query.id||client().roomId();this.setData({roomId:/^\d{6}$/.test(id)?id:'',error:/^\d{6}$/.test(id)?'':'房间号无效，请返回大厅重新加入'});
    this._network=(result:WechatMiniprogram.OnNetworkStatusChangeListenerResult)=>{if(this._visible&&result.isConnected){this._connection?.stop();this._connection?.start();}};
    wx.onNetworkStatusChange(this._network);wx.showShareMenu({menus:['shareAppMessage']});
  },
  onShow() {this._visible=true;void this.refresh();this._timer=setInterval(()=>this.updateClock(),500);},
  onHide() {this.suspend();},
  onUnload() {this.suspend();if(this._network)wx.offNetworkStatusChange(this._network);},
  suspend() {this._visible=false;this._epoch++;this._connection?.stop();this._connection=undefined;if(this._timer)clearInterval(this._timer);this._timer=undefined;this._drag=null;},
  async refresh() {
    if(!this.data.roomId){this.setData({loading:false});return;}
    const epoch=++this._epoch;this._connection?.stop();this.setData({error:'',connection:'connecting',connectionText:'连接中'});
    try{
      const room=await client().room(this.data.roomId);if(!this._visible||epoch!==this._epoch)return;
      this.accept(room);const session=client().session();if(!session)throw new ApiError(401,'登录已失效');
      this._connection=new RoomConnection(wx,client().server(),session,room.roomId,{
        room:next=>{if(this._visible)this.accept(next);},
        state:state=>{if(this._visible)this.setData({connection:state,connectionText:state==='online'?'已连接':state==='connecting'?'重连中':'已断线'});},
        error:message=>{if(this._visible)this.setData({error:message});},
        left:()=>{client().remember('');this.goHome();}
      });this._connection.start();
    }catch(e){if(!this._visible||epoch!==this._epoch)return;
      this.setData({error:errorMessage(e),connection:'offline',connectionText:'连接失败'});
      if(e instanceof ApiError&&[403,404].includes(e.status))client().remember('');
      if(e instanceof ApiError&&e.status===401)wx.reLaunch({url:`/pages/home/index?room=${this.data.roomId}`});
    }finally{if(this._visible&&epoch===this._epoch)this.setData({loading:false});}
  },
  accept(room:RoomView) {
    if(this._room&&room.roomId===this._room.roomId&&room.revision<this._room.revision)return;
    if(!this._room||room.totalPlays!==this._room.totalPlays||room.round!==this._room.round)this._hintIndex=0;
    if(!this._room||room.round!==this._room.round)this._selected=[];
    this._selected=this._selected.filter((id:string)=>room.hand.some(c=>c.id===id));this._room=room;
    this.setData({vm:tableView(room,this._selected,this._sort),loading:false},()=>this.measureCards());this.updateClock();
  },
  updateClock(){if(!this._visible||!this._room)return;const deadline=this._room.deadline;const value=deadline===null?'不限时':`${Math.max(0,Math.ceil((deadline-Date.now())/1000))} 秒`;if(value!==this.data.seconds)this.setData({seconds:value});},
  measureCards(){if(!this._visible)return;this.createSelectorQuery().selectAll('.hand-card').fields({id:true,dataset:true,rect:true},(result:unknown)=>{
    this._rects=(result as {dataset:{id:string};left:number;right:number;top:number;bottom:number}[]).map(r=>({...r,id:r.dataset.id}));
  }).exec();},
  renderSelection(){if(this._room)this.setData({vm:tableView(this._room,this._selected,this._sort)},()=>this.measureCards());},
  touchStart(event:WechatMiniprogram.TouchEvent) {const id=event.currentTarget.dataset.id as string;if(!id)return;this._drag={select:!this._selected.includes(id),seen:new Set()};this.visitCard(id);},
  visitCard(id:string){const drag=this._drag;if(!drag||drag.seen.has(id))return;drag.seen.add(id);this._selected=drag.select?[...new Set([...this._selected,id])]:this._selected.filter((c:string)=>c!==id);this.renderSelection();},
  touchMove(event:WechatMiniprogram.TouchEvent){const touch=event.touches[0];if(!touch||!this._drag)return;
    // Cards overlap: the last matching rectangle is visually on top.
    const card=[...this._rects].reverse().find(r=>touch.clientX>=r.left&&touch.clientX<=r.right&&touch.clientY>=r.top&&touch.clientY<=r.bottom);if(card)this.visitCard(card.id);
  },
  touchEnd(){this._drag=null;},
  sort(){this._sort=this._sort==='rank'?'suit':'rank';this.setData({sortLabel:this._sort==='rank'?'按点数':'按花色'});this.renderSelection();},
  clear(){this._selected=[];this.renderSelection();},
  async act(action:GameAction):Promise<boolean> {
    if(!this._room||this._pending||this.data.connection!=='online')return false;
    this._pending=true;this.setData({busy:true,error:''});
    try{
      const next=await client().action(this._room,action);
      if(action.type==='leave'){this.goHome();return true;}
      if(next&&this._visible)this.accept(next);return true;
    }catch(e){if(this._visible){this.setData({error:errorMessage(e)});if(e instanceof ApiError&&(e.status===409||e.status===401))void this.refresh();}return false;}
    finally{this._pending=false;if(this._visible)this.setData({busy:false});}
  },
  ready(){if(this.data.vm)void this.act({type:'ready',ready:!this.data.vm.me.ready});},
  start(){void this.act({type:'start'});},next(){void this.act({type:'next'});},pass(){void this.act({type:'pass'});},
  async play(){if(this.data.vm?.canPlay&&await this.act({type:'play',cardIds:[...this._selected]}))this.clear();},
  auto(){if(this.data.vm)void this.act({type:'auto',enabled:!this.data.vm.me.autoPlay});},
  async hint(){if(!this._room||this._pending||!this.data.vm?.mine)return;this._pending=true;this.setData({busy:true,error:''});
    const revision=this._room.revision;
    try{const hints=await client().hints(this._room.roomId);if(!this._visible||this._room.revision!==revision)return;
      if(!hints.length){this.setData({error:'没有能压过的牌，可以选择不出'});this.clear();}
      else{this._selected=hints[this._hintIndex++%hints.length].cards.map(c=>c.id);this.renderSelection();}
    }catch(e){if(this._visible)this.setData({error:errorMessage(e)});}finally{this._pending=false;if(this._visible)this.setData({busy:false});}
  },
  exchange(){if(!this._room||!this.data.vm?.canTribute)return;const donor=this._room.tribute.some((t:Tribute)=>t.from===this._room!.mySeat&&!t.given);void this.act(donor?{type:'tribute'}:{type:'tribute',cardId:this._selected[0]});},
  shuffle(){void this.act({type:'shuffleTeams'});},
  toggleSwap(){this.setData({swapping:!this.data.swapping,swapSeat:0});},
  async seatTap(event:WechatMiniprogram.TouchEvent){if(!this.data.swapping||!this._room)return;const seat=Number(event.currentTarget.dataset.seat),p=this._room.players.find((p:PublicPlayer)=>p.seat===seat);
    if(p?.ready){this.setData({error:'换座前请先取消准备'});return;}
    if(!this.data.swapSeat){if(p)this.setData({swapSeat:seat,error:''});return;}
    if(this.data.swapSeat===seat){this.setData({swapSeat:0});return;}
    if(await this.act({type:'swap',seat:this.data.swapSeat,target:seat}))this.setData({swapping:false,swapSeat:0});
  },
  toggleCounter(){this.setData({counterOpen:!this.data.counterOpen});},
  copy(){wx.setClipboardData({data:this.data.roomId,success:()=>wx.showToast({title:'房间号已复制',icon:'none'})});},
  async leave(){if(!this._room){this.goHome();return;}const finished=this._room.status==='finished';
    if(finished){await this.act({type:'leave'});return;}
    wx.showModal({title:'返回大厅？',content:this._room.status==='waiting'?'你将让出当前座位。':'牌局继续，座位会保留。下次可从大厅返回本房间。',confirmText:'返回大厅',success:r=>{if(r.confirm){if(this.data.connection==='online')void this.act({type:'leave'});else this.goHome();}}});
  },
  goHome(){this.suspend();if(getCurrentPages().length>1)wx.navigateBack();else wx.reLaunch({url:'/pages/home/index'});},
  stopTap(){},
  onShareAppMessage(){return {title:`六人掼蛋 · 房间 ${this.data.roomId}，等你入座`,path:`/pages/home/index?room=${this.data.roomId}`};}
});
