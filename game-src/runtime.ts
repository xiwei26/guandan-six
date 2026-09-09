import { MiniClient, ApiError, errorMessage } from '../miniprogram/services/client';
import { RoomConnection, type ConnectionState } from '../miniprogram/services/connection';
import { tableView, DEFAULT_OPTIONS } from '../miniprogram/utils/presentation';
import type { RoomView, GameAction, RuleConfig } from '../shared/types';
import { WIDTH, HEIGHT, viewport, hitAt, type Hit } from './layout';

type TouchEvent={touches:{clientX:number;clientY:number}[]};
type Launch={query?:Record<string,string>};
export type GamePlatform=Pick<typeof wx,'request'|'login'|'getStorageSync'|'setStorageSync'|'removeStorageSync'|'getAccountInfoSync'|'connectSocket'|'showModal'|'showToast'|'setClipboardData'|'onNetworkStatusChange'> & {
  createCanvas():HTMLCanvasElement;
  getSystemInfoSync():{windowWidth:number;windowHeight:number;pixelRatio:number;safeArea?:{left:number;top:number;right:number;bottom:number}};
  onTouchStart(fn:(e:TouchEvent)=>void):void;onTouchMove(fn:(e:TouchEvent)=>void):void;
  onTouchEnd(fn:()=>void):void;onTouchCancel(fn:()=>void):void;
  onShow(fn:(launch:Launch)=>void):void;onHide(fn:()=>void):void;
  onWindowResize(fn:()=>void):void;getLaunchOptionsSync():Launch;
  showShareMenu(options:{menus:string[]}):void;
  onShareAppMessage(fn:()=>{title:string;query:string}):void;
  shareAppMessage(options:{title:string;query:string}):void;
  showKeyboard(options:{defaultValue:string;maxLength:number;multiple:boolean;confirmHold:boolean;confirmType:string;fail:()=>void}):void;
  hideKeyboard(options:object):void;
  onKeyboardConfirm(fn:(e:{value:string})=>void):void;
  onKeyboardComplete(fn:(e:{value:string})=>void):void;
};

const C={bg:'#082d29',panel:'#12443c',line:'#326258',text:'#f5f0df',muted:'#afc7bb',gold:'#e9bd66',blue:'#8dc9ef',orange:'#f0a96e'};
const RULES=[
  '六人同桌，A / B 隔位组队；三副牌，每人 27 张。六人准备后由房主开始。',
  '大王 > 小王 > 级牌 > A 至 2。红桃级牌为逢人配，可以替普通牌，不能替王。',
  '支持单张、对子、三张、三带二、顺子、三连对、钢板、同花顺、4–12 张炸弹。',
  '炸弹先比张数，默认六炸 > 同花顺 > 五炸。首出不能不出，跟牌必须压过上一手。',
  '第五人出完结束，最后一人记末游。前三同队升 3 级，前二同队升 2 级，否则升 1 级。',
  '出完者最后一手无人压，由顺时针最近的未出完队友接风，无队友则由下一人首出。',
  '按升级数进 1 / 2 / 3 贡，进最大非逢人配牌；还 2–9 非级牌，没有时还最小非逢人配。',
  '单贡者有 2 张大王可抗贡；双/三贡败队合计 3 张大王可抗贡。抗贡由上局头游首出。',
  '打到 A 需在己方 A 级且当前打 A 时获胜。固定局数打满结束，展示等级与本局排名。'
];

export class GuandanGame {
  readonly api:MiniClient;
  readonly canvas:HTMLCanvasElement;
  private ctx:CanvasRenderingContext2D;
  private view=viewport(WIDTH,HEIGHT);
  private hits:Hit[]=[];
  private room:RoomView|null=null;
  private connection?:RoomConnection;
  private state:ConnectionState='offline';
  private visible=true;
  private epoch=0;
  private busy=false;
  private selected:string[]=[];
  private sort:'rank'|'suit'='rank';
  private hintIndex=0;
  private drag?:{select:boolean;seen:Set<string>};
  private timer?:ReturnType<typeof setInterval>;
  private nickname='牌友';
  private invite='';
  private options:Partial<RuleConfig>={...DEFAULT_OPTIONS};
  private overlay?:{title:string;lines:string[];page:number};
  private configuring=false;
  private editing?:{title:string;done:(s:string)=>void};
  private swapSeat=0;
  private swapping=false;
  constructor(private platform:GamePlatform) {
    this.api=new MiniClient(platform);this.nickname=this.api.session()?.nickname||'牌友';
    this.canvas=platform.createCanvas();this.ctx=this.canvas.getContext('2d')!;
    this.resize();
    platform.onWindowResize(()=>this.resize());
    platform.onTouchStart(e=>this.touch(e,false));platform.onTouchMove(e=>this.touch(e,true));
    platform.onTouchEnd(()=>{this.drag=undefined;});platform.onTouchCancel(()=>{this.drag=undefined;});
    platform.onKeyboardConfirm(e=>this.finishInput(e.value));
    platform.onKeyboardComplete(()=>{this.editing=undefined;this.draw();});
    platform.onHide(()=>{this.visible=false;this.epoch++;this.connection?.stop();this.drag=undefined;this.stopClock();});
    platform.onShow(launch=>{this.visible=true;this.launch(launch);this.startClock();if(this.room)void this.restore(this.room.roomId);else this.draw();});
    platform.onNetworkStatusChange(e=>{if(e.isConnected&&this.visible&&this.room)void this.restore(this.room.roomId);});
    platform.showShareMenu({menus:['shareAppMessage']});platform.onShareAppMessage(()=>this.share());
    this.launch(platform.getLaunchOptionsSync());this.startClock();this.draw();
  }
  private startClock(){this.stopClock();this.timer=setInterval(()=>{if(this.room&&this.visible)this.draw();},500);}
  private stopClock(){if(this.timer)clearInterval(this.timer);this.timer=undefined;}
  private launch(launch:Launch){const id=launch.query?.room;if(id&&/^\d{6}$/.test(id))this.invite=id;}
  private share(){return {title:`六人掼蛋${this.room?' · 房间 '+this.room.roomId:''}`,query:this.room?`room=${this.room.roomId}`:''};}
  private resize(){const info=this.platform.getSystemInfoSync();const dpr=Math.min(info.pixelRatio||1,3);
    this.canvas.width=Math.round(info.windowWidth*dpr);this.canvas.height=Math.round(info.windowHeight*dpr);
    this.view=viewport(info.windowWidth,info.windowHeight,info.safeArea);
    this.ctx.setTransform(dpr*this.view.scale,0,0,dpr*this.view.scale,dpr*this.view.x,dpr*this.view.y);this.draw();}
  private text(s:string,x:number,y:number,size=18,color=C.text){this.ctx.fillStyle=color;this.ctx.font=`${size}px sans-serif`;this.ctx.textBaseline='middle';this.ctx.fillText(s,x,y);}
  private box(x:number,y:number,w:number,h:number,color:string){this.ctx.fillStyle=color;this.ctx.fillRect(x,y,w,h);}
  private button(label:string,x:number,y:number,w:number,run:()=>void,enabled=true,primary=false){
    this.box(x,y,w,40,enabled?(primary?C.gold:C.panel):'#203e38');this.text(label,x+12,y+20,17,enabled?(primary?C.bg:C.text):'#718a7f');
    if(enabled&&!this.busy)this.hits.push({x,y,w,h:40,run});
  }
  private touch(e:TouchEvent,moving:boolean){if(this.busy||this.editing)return;const t=e.touches[0];if(!t)return;
    const h=hitAt(this.hits,(t.clientX-this.view.x)/this.view.scale,(t.clientY-this.view.y)/this.view.scale);
    if(!moving){this.drag=undefined;if(h?.card)this.drag={select:!this.selected.includes(h.card),seen:new Set()};}
    if(h?.card&&this.drag){if(!this.drag.seen.has(h.card)){this.drag.seen.add(h.card);this.selected=this.drag.select?[...new Set([...this.selected,h.card])]:this.selected.filter(id=>id!==h.card);this.draw();}}
    else if(!moving)h?.run();
  }
  private input(title:string,value:string,done:(s:string)=>void,maxLength=80){this.editing={title,done};this.draw();
    this.platform.showKeyboard({defaultValue:value,maxLength,multiple:false,confirmHold:false,confirmType:'done',fail:()=>{this.editing=undefined;this.error(new Error('无法打开输入键盘，请重试'));}});}
  private finishInput(value:string){const editing=this.editing;this.editing=undefined;this.platform.hideKeyboard({});if(editing){try{editing.done(value.trim());}catch(e){this.error(e);}}this.draw();}
  private error(e:unknown){this.platform.showModal({title:'操作未完成',content:errorMessage(e),showCancel:false});}
  private async task(run:()=>Promise<void>){if(this.busy)return;this.busy=true;this.draw();try{await run();}catch(e){this.error(e);}finally{this.busy=false;this.draw();}}
  private async login(kind:'guest'|'wechat'){await this.task(async()=>{await this.api.login(kind,this.nickname);});}
  private enter(mode:'create'|'join'|'demo',id?:string){if(mode==='join'&&!/^\d{6}$/.test(id||'')){this.error(new Error('请输入六位房间号'));return;}
    void this.task(async()=>{const epoch=this.epoch;const room=await this.api.enter(mode,mode==='create'?this.options:id);if(!this.visible||epoch!==this.epoch)return;this.accept(room);this.connect();});}
  private accept(room:RoomView){if(this.room?.roomId===room.roomId&&room.revision<this.room.revision)return;
    if(this.room?.round!==room.round||this.room?.totalPlays!==room.totalPlays)this.hintIndex=0;
    if(this.room?.round!==room.round)this.selected=[];
    this.selected=this.selected.filter(id=>room.hand.some(c=>c.id===id));this.room=room;this.draw();}
  private connect(){this.connection?.stop();const session=this.api.session();if(!session||!this.room||!this.visible)return;
    const epoch=++this.epoch;this.connection=new RoomConnection(this.platform,this.api.server(),session,this.room.roomId,{
      room:r=>{if(epoch===this.epoch&&this.visible)this.accept(r);},state:s=>{if(epoch===this.epoch){this.state=s;this.draw();}},
      error:message=>{if(epoch===this.epoch)this.error(new Error(message));},left:()=>{if(epoch===this.epoch){this.api.remember('');this.home();}}
    });this.connection.start();}
  private async restore(id:string){const epoch=++this.epoch;this.connection?.stop();this.state='connecting';this.draw();
    try{const room=await this.api.room(id);if(epoch!==this.epoch||!this.visible)return;this.accept(room);this.connect();}
    catch(e){if(epoch!==this.epoch||!this.visible)return;this.state='offline';
      if(e instanceof ApiError&&[401,403,404].includes(e.status)){if(e.status!==401)this.api.remember('');this.home();}this.error(e);this.draw();}}
  private act(action:GameAction){if(!this.room||this.state!=='online')return;
    const room=this.room,epoch=this.epoch;void this.task(async()=>{try{const next=await this.api.action(room,action);if(epoch!==this.epoch||!this.visible)return;
      if(action.type==='leave'){this.home();return;}if(next)this.accept(next);if(action.type==='play')this.selected=[];
    }catch(e){if(epoch===this.epoch&&this.visible)await this.restore(room.roomId);throw e;}});}
  private home(){this.epoch++;this.connection?.stop();this.room=null;this.state='offline';this.selected=[];this.overlay=undefined;this.swapping=false;this.swapSeat=0;this.draw();}
  private leave(){this.platform.showModal({title:'返回大厅',content:this.room?.status==='waiting'?'离开将让出座位。':'进行中的牌局将保留座位，可从大厅返回。',success:r=>{if(r.confirm){if(this.state==='online')this.act({type:'leave'});else this.home();}}});}
  private hint(){if(!this.room)return;const room=this.room;void this.task(async()=>{const hints=await this.api.hints(room.roomId);if(this.room?.revision!==room.revision||this.room.roomId!==room.roomId)return;
    this.selected=hints.length?hints[this.hintIndex++%hints.length].cards.map(c=>c.id):[];if(!hints.length)this.platform.showToast({title:'没有能压过的牌',icon:'none'});});}
  private panel(title:string,lines:string[]){this.overlay={title,lines,page:0};this.draw();}
  private settings(){this.input('后端服务地址',this.api.server(),value=>{this.api.setServer(value);this.nickname=this.api.session()?.nickname||'牌友';this.panel('连接设置',['服务地址已保存：',this.api.server(),'身份和房间按服务地址隔离。','返回大厅后登录或体验一局即可检查连接。']);});}
  private history(){void this.task(async()=>{const [{history},{stats}]=await Promise.all([this.api.history(),this.api.stats()]);this.panel('我的战绩',[
    `${stats.rounds} 局 · ${stats.wins} 胜 · ${stats.firsts} 次头游 · 最大 ${stats.biggestBomb} 炸`,
    ...history.flatMap(h=>[`${new Date(h.at).toLocaleDateString()} · 房间 ${h.roomId} · 第 ${h.round} 局 · ${h.winner} 队胜`,h.order.map((p,i)=>`${i+1}. ${p.nickname}`).join(' / ')])
  ]);});}
  draw(){if(!this.ctx||!this.visible)return;this.hits=[];this.ctx.save();this.ctx.setTransform(1,0,0,1,0,0);this.ctx.fillStyle=C.bg;this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.ctx.restore();
    if(this.room)this.table();else this.lobby();
    if(this.overlay)this.drawPanel();
    if(this.configuring)this.drawOptions();
    if(this.editing){this.box(180,180,600,120,C.panel);this.text(this.editing.title,210,220,24);this.text('输入后点击键盘「完成」',210,265,18,C.muted);this.hits=[];}
    if(this.busy){this.box(380,235,200,60,C.panel);this.text('正在处理…',420,266,20);this.hits=[];}
  }
  private lobby(){this.text('六人掼蛋',64,112,58);this.text('三副牌 · 六人同桌 · 隔位组队',68,170,21,C.muted);
    this.text('A',80,275,58,C.blue);this.text('B',150,275,58,C.orange);this.text('A',220,275,58,C.blue);this.text('B',290,275,58,C.orange);this.text('A',360,275,58,C.blue);this.text('B',430,275,58,C.orange);
    this.text('27 张手牌，和队友一起打到 A。',68,345,22);
    this.button('规则',68,425,110,()=>this.panel('六人规则 · 6P_V1',RULES));this.button('连接设置',194,425,130,()=>this.settings());
    const session=this.api.session();this.button('我的战绩',340,425,130,()=>this.history(),!!session);
    this.text(session?`你好，${session.nickname}`:'选择身份进入牌桌',580,92,25);
    if(!session){this.button(`昵称：${this.nickname}`,580,132,300,()=>this.input('昵称',this.nickname,s=>{if(!s||s.length>20)throw new Error('昵称为 1–20 字');this.nickname=s;},20));
      this.button('微信登录',580,198,300,()=>void this.login('wechat'),true,true);this.button('游客体验',580,254,300,()=>void this.login('guest'));
      if(this.invite)this.text(`好友邀请：房间 ${this.invite}`,580,330,20,C.gold);
    }else{this.button('创建房间',580,132,300,()=>this.enter('create'),true,true);
      this.button(this.invite?`加入邀请 ${this.invite}`:'输入房间号加入',580,188,300,()=>this.invite?this.enter('join',this.invite):this.input('六位房间号','',s=>this.enter('join',s),6));
      this.button('体验一局 · 五位机器人',580,244,300,()=>this.enter('demo'));
      this.button('返回上次房间',580,300,300,()=>void this.restore(this.api.roomId()),!!this.api.roomId());
      this.button(`局数：${this.options.rounds==='A'?'打到 A':this.options.rounds}`,580,362,144,()=>{const list=[1,2,4,8,'A'] as const;this.options.rounds=list[(list.indexOf(this.options.rounds!)+1)%list.length];this.draw();});
      this.button(`计时：${this.options.turnSeconds||'不限'}${this.options.turnSeconds?'秒':''}`,736,362,144,()=>{const list=[0,15,30,60] as const;this.options.turnSeconds=list[(list.indexOf(this.options.turnSeconds!)+1)%list.length];this.draw();});
      this.button('更多房间设置',580,418,300,()=>this.roomOptions());
    }this.text('六人掼蛋 / 微信小游戏',68,510,14,C.muted);
  }
  private roomOptions(){this.configuring=true;this.draw();}
  private drawOptions(){this.hits=[];this.box(220,80,520,390,C.panel);this.text('房间设置',250,118,28,C.gold);
    const toggles=[['showRemaining','显示剩余牌数'],['allowAutoPlay','允许托管'],['allowCounter','记牌器'],['resistance','抗贡']] as const;
    toggles.forEach(([key,label],i)=>this.button(`${label}：${this.options[key]?'开':'关'}`,250,154+i*54,460,()=>{this.options[key]=!this.options[key];this.draw();}));
    this.button('完成',250,402,460,()=>{this.configuring=false;this.draw();},true,true);
  }
  private table(){const room=this.room!,vm=tableView(room,this.selected,this.sort),online=this.state==='online';
    this.text(`六人掼蛋  /  ${room.roomId}`,24,28,21);this.text(`第 ${room.round} 局 · 打 ${room.currentLevel}    A ${room.teamLevels.A} : B ${room.teamLevels.B}`,310,28,18,C.gold);
    // Keep the upper-right corner clear for the native WeChat capsule menu.
    this.button('邀请',658,52,80,()=>this.platform.shareAppMessage(this.share()));this.button('大厅',746,52,80,()=>this.leave());
    this.button(online?'已连接':'重连',834,52,100,()=>void this.restore(room.roomId),!online);
    const positions=[[420,308],[758,214],[758,100],[420,70],[28,100],[28,214]];
    vm.seats.forEach(s=>{const [x,y]=positions[s.relative];this.box(x,y,174,72,s.active?'#366454':C.panel);this.box(x,y,4,72,s.team==='A'?C.blue:C.orange);
      this.text(`${s.seat} · ${s.nickname.slice(0,9)}`,x+12,y+22,17,s.team==='A'?C.blue:C.orange);
      this.text(`${s.offline?'离线 · ':''}${s.pass?'不出':s.detail}`,x+12,y+49,15,C.muted);
      if(this.swapping)this.hits.push({x,y,w:174,h:72,run:()=>{if(!this.swapSeat){this.swapSeat=s.seat;this.draw();}else{this.act({type:'swap',seat:this.swapSeat,target:s.seat});this.swapping=false;this.swapSeat=0;}}});
    });
    if(vm.waiting){this.text('等待六位牌友准备',318,185,28);this.text(`${vm.readyCount} / 6 已准备 · ${vm.roundText} · 隔位组队`,318,224,18,C.muted);
      this.button(vm.me.ready?'取消准备':'准备',272,258,140,()=>this.act({type:'ready',ready:!vm.me.ready}),online,true);
      this.button('开始',426,258,110,()=>this.act({type:'start'}),online&&vm.host&&vm.allReady);
      this.button('随机组队',550,258,130,()=>this.act({type:'shuffleTeams'}),online&&vm.host&&vm.canShuffle);
      this.button(this.swapping?`换座 ${this.swapSeat||'选座'}`:'调整座位',28,410,165,()=>{this.swapping=!this.swapping;this.swapSeat=0;this.draw();},online&&vm.host);
      this.text('点击右上角邀请好友，或分享六位房间号。',245,453,20,C.muted);return;
    }
    this.text(vm.turnLabel,295,174,23,C.gold);
    const seconds=room.deadline===null?'不限时':`${Math.max(0,Math.ceil((room.deadline-Date.now())/1000))} 秒`;
    this.text(seconds,590,174,19,C.muted);
    if(vm.played.length){this.text(vm.lastLabel.slice(0,26),295,206,16,C.muted);vm.played.forEach((c,i)=>this.card(c,295+i*Math.min(30,350/Math.max(1,vm.played.length-1)),223,42,63));}
    else this.text(vm.tribute?'请完成贡还贡':'等待首出',338,244,24,C.muted);
    this.button(this.sort==='rank'?'按花色':'按点数',24,320,106,()=>{this.sort=this.sort==='rank'?'suit':'rank';this.draw();});
    this.button('清空',140,320,80,()=>{this.selected=[];this.draw();});
    this.button(vm.me.autoPlay?'取消托管':'托管',740,320,110,()=>this.act({type:'auto',enabled:!vm.me.autoPlay}),online&&room.rules.allowAutoPlay);
    this.button('记牌',860,320,76,()=>this.panel('记牌器 · 公开信息',vm.counter.map(c=>`${c.label}：${c.count}`).reduce<string[]>((rows,s,i)=>{if(i%5===0)rows.push(s);else rows[rows.length-1]+='      '+s;return rows;},[])),room.rules.allowCounter);
    if(vm.tribute){this.button(vm.tributeLabel,480,488,164,()=>this.act(room.tribute.some(t=>t.from===room.mySeat&&!t.given)?{type:'tribute'}:{type:'tribute',cardId:this.selected[0]}),online&&vm.canTribute,true);
      this.button('交换进度',660,488,130,()=>this.panel('贡还贡',vm.exchanges.map(e=>`${e.fromName} → ${e.toName}：${e.label}`)));
    }else{this.button('提示',490,488,100,()=>this.hint(),online&&vm.mine);this.button('不出',602,488,100,()=>this.act({type:'pass'}),online&&vm.canPass);
      this.button('出牌',714,488,130,()=>this.act({type:'play',cardIds:[...this.selected]}),online&&vm.canPlay,true);}
    this.text(vm.selectionText.slice(0,27),24,510,16,C.muted);
    vm.rows.forEach((row,r)=>row.cards.forEach((c,i)=>{const x=24+i*61,y=390+r*45-(c.selected?12:0);this.card(c,x,y,58,44);this.hits.push({x,y,w:58,h:44,card:c.id,run:()=>{}});}));
    if(vm.ended){this.hits=[];this.box(215,102,530,364,C.panel);this.text(`${room.settlement?.winner} 队获胜 · 升 ${room.settlement?.upgrade} 级`,245,139,28,C.gold);
      vm.ranking.forEach((r,i)=>this.text(`${r.place}   ${r.name.slice(0,12)}   ${r.team} 队`,250,184+i*32,18));
      this.button(room.status==='finished'?'整场结束':'下一局',245,408,220,()=>this.act({type:'next'}),online&&vm.host&&room.status==='settlement',true);
      this.button('返回大厅',487,408,220,()=>this.leave());}
  }
  private card(c:{label:string;symbol:string;red:boolean;wild:boolean;selected?:boolean},x:number,y:number,w:number,h:number){this.box(x,y,w,h,c.selected?'#ffe1a0':'#fff9eb');this.text(c.label+c.symbol,x+4,y+15,19,c.red?'#bc3434':'#163f39');if(c.wild)this.text('配',x+4,y+h-9,11,'#9b630c');}
  private drawPanel(){const p=this.overlay!;this.hits=[];this.box(105,64,750,430,C.panel);this.text(p.title,132,99,27,C.gold);
    const lines:string[]=[];for(const line of p.lines){let part='';for(const ch of line){this.ctx.font='18px sans-serif';if(this.ctx.measureText(part+ch).width>685){lines.push(part);part=ch;}else part+=ch;}lines.push(part);}
    const pages=Math.max(1,Math.ceil(lines.length/8));p.page=Math.min(p.page,pages-1);lines.slice(p.page*8,p.page*8+8).forEach((line,i)=>this.text(line,132,147+i*32,18));
    this.button('上一页',132,434,110,()=>{p.page--;this.draw();},p.page>0);this.text(`${p.page+1} / ${pages}`,270,454,18,C.muted);
    this.button('下一页',370,434,110,()=>{p.page++;this.draw();},p.page<pages-1);this.button('关闭',707,434,120,()=>{this.overlay=undefined;this.draw();});}
}
