import { MiniClient, ApiError, errorMessage } from '../miniprogram/services/client';
import { RoomConnection, type ConnectionState } from '../miniprogram/services/connection';
import { tableView, DEFAULT_OPTIONS, cardView } from '../miniprogram/utils/presentation';
import {arrangeHand,reconcileGroups,manualGroup,groupCards,type HandGroup} from './arrangement';
import type { RoomView, GameAction, RuleConfig } from '../shared/types';
import { WIDTH, HEIGHT, viewport, hitAt, handLayout, lobbySpread, type Hit } from './layout';
import { Painter, COLORS as C } from './paint';

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

const RULES=[
  '六人同桌，A / B 隔位组队；三副牌，每人 27 张。六人准备后由房主开始。',
  '大王 > 小王 > 级牌 > A 至 2。红桃级牌为逢人配，可以替普通牌，不能替王。',
  '支持单张、对子、三张、三带二、顺子、三连对、钢板、同花顺、4–12 张炸弹。',
  '天王炸 > 12–7 炸 > 三大王 > 三小王 > 6 炸 > 同花顺 > 5 炸 > 4 炸。王炸不许配牌。',
  '头游队获胜。末尾连续 3 / 2 / 1 名对手，升 4 / 3 / 2 级；末游同队只升 1 级。',
  '出完者最后一手无人压，由顺时针最近的未出完队友接风，无队友则由下一人首出。',
  '按升级数进贡，最多三贡；进最大非逢人配牌；还 2–9 非级牌，没有时还最小非逢人配。',
  '单贡者有 2 张大王可抗贡；双/三贡败队合计 3 张大王可抗贡。抗贡由上局头游首出。',
  '打到 A 需在己方 A 级且当前打 A 时获胜。固定局数打满结束，展示等级与本局排名。'
];

export class GuandanGame {
  readonly api:MiniClient;
  readonly canvas:HTMLCanvasElement;
  private ctx:CanvasRenderingContext2D;
  private paint:Painter;
  private paper=false;
  private view=viewport(WIDTH,HEIGHT);
  private background={x:0,y:0,w:WIDTH,h:HEIGHT};
  private spread=0;
  private hitOffset=0;
  private hits:Hit[]=[];
  private room:RoomView|null=null;
  private connection?:RoomConnection;
  private state:ConnectionState='offline';
  private visible=true;
  private epoch=0;
  private busy=false;
  private selected:string[]=[];
  private sort:'rank'|'suit'='rank';
  private groups:HandGroup[]|null=null;
  private arranging=false;
  private groupPage=0;
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
    this.canvas=platform.createCanvas();this.ctx=this.canvas.getContext('2d')!;this.paint=new Painter(this.ctx);
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
    this.spread=lobbySpread(info.windowWidth,info.windowHeight,info.safeArea);
    this.background={x:-this.view.x/this.view.scale,y:-this.view.y/this.view.scale,w:info.windowWidth/this.view.scale,h:info.windowHeight/this.view.scale};
    this.ctx.setTransform(dpr*this.view.scale,0,0,dpr*this.view.scale,dpr*this.view.x,dpr*this.view.y);this.draw();}
  private text(s:string,x:number,y:number,size=18,color:string=this.paper?C.ink:C.text){this.paint.text(s,x,y,size,color);}
  private box(x:number,y:number,w:number,h:number,color:string){this.paint.rect(x,y,w,h,color,Math.min(12,h/3));}
  private button(label:string,x:number,y:number,w:number,run:()=>void,enabled=true,primary=false){
    const fill=primary?C.gold:this.paper?C.soft:C.panel;
    this.paint.rect(x,y,w,40,enabled?fill:this.paper?'#eeebe1':'#203e38',8,primary?'#f0d7a3':this.paper?'#d9decf':C.line);
    this.paint.text(label,x+12,y+20,16,enabled?(primary||this.paper?C.ink:C.text):this.paper?'#8a9383':'#80968b',primary?600:400,'sans-serif',w-24);
    if(enabled&&!this.busy)this.hits.push({x:x+this.hitOffset,y,w,h:40,run});
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
    if(this.room?.round!==room.round||this.room?.roomId!==room.roomId){this.selected=[];this.groups=null;this.arranging=false;}
    if(this.groups)this.groups=reconcileGroups(this.groups,room.hand,room.currentLevel,room.rules);
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
    this.paper=false;this.hitOffset=0;const b=this.background;this.paint.backdrop(b.x,b.y,b.w,b.h);
    if(this.room)this.table();else this.lobby();
    if(this.arranging&&this.room&&!['settlement','finished','waiting'].includes(this.room.status))this.drawArrangement();
    if(this.overlay)this.drawPanel();
    if(this.configuring)this.drawOptions();
    if(this.editing){this.paint.scrim();this.paint.paperPanel(180,180,600,120);this.text(this.editing.title,210,220,24,C.ink);this.text('输入后点击键盘「完成」',210,265,18,C.paperMuted);this.hits=[];}
    if(this.busy){this.paint.scrim();this.paint.paperPanel(380,235,200,60);this.text('正在处理…',420,266,20,C.ink);this.hits=[];}
  }
  private lobby(){
    this.ctx.save();this.ctx.translate(-this.spread,0);this.hitOffset=-this.spread;
    this.paint.suit('♣',56,34,25,C.gold);this.text('好友相聚，开一局',94,48,14,C.muted);
    this.paint.text('六人掼蛋',56,128,54,C.text,600,'"Songti SC", SimSun, serif');
    this.text('三副牌 · 六人同桌 · 隔位组队',60,180,18,C.muted);
    this.paint.lobbyArt();this.text('27 张手牌，和队友一起打到 A。',108,410,17,C.muted);
    this.button('规则',56,454,106,()=>this.panel('六人规则 · 6P_V2',RULES));
    this.button('连接设置',176,454,132,()=>this.settings());
    const session=this.api.session();this.button('我的战绩',322,454,132,()=>this.history(),!!session);
    this.text('六人掼蛋 / 微信小游戏',56,519,12,C.muted);
    this.ctx.restore();this.ctx.save();this.ctx.translate(this.spread,0);this.hitOffset=this.spread;
    this.paint.paperPanel(560,76,344,418);this.paper=true;
    this.paint.text(session?`你好，${session.nickname}`:'好搭档，就等你了',584,112,23,C.ink,600,'sans-serif',296);
    if(!session){
      this.text('选一个名字，坐上你的牌桌。',584,149,14,C.paperMuted);
      this.button(`昵称：${this.nickname}`,584,183,296,()=>this.input('昵称',this.nickname,s=>{if(!s||s.length>20)throw new Error('昵称为 1–20 字');this.nickname=s;},20));
      this.button('微信登录',584,248,296,()=>void this.login('wechat'),true,true);this.paint.arrow(855,268);
      this.button('游客体验',584,304,296,()=>void this.login('guest'));
      this.paint.line(584,371,880,371,'#d9dece');
      this.text(this.invite?`好友邀请：房间 ${this.invite}`:'六人入座，三人同心。',584,402,16,C.paperMuted);
      this.text('三人一队，每个人都有好搭档。',584,433,14,C.paperMuted);
    }else{
      this.button('创建房间',584,146,296,()=>this.enter('create'),true,true);this.paint.arrow(855,166);
      this.button(this.invite?`加入邀请 ${this.invite}`:'输入房间号加入',584,199,296,()=>this.invite?this.enter('join',this.invite):this.input('六位房间号','',s=>this.enter('join',s),6));
      this.button('体验一局 · 五位机器人',584,252,296,()=>this.enter('demo'));
      this.button('返回上次房间',584,305,296,()=>void this.restore(this.api.roomId()),!!this.api.roomId());
      this.button(`局数：${this.options.rounds==='A'?'打到 A':this.options.rounds}`,584,358,142,()=>{const list=[1,2,4,8,'A'] as const;this.options.rounds=list[(list.indexOf(this.options.rounds!)+1)%list.length];this.draw();});
      this.button(`计时：${this.options.turnSeconds||'不限'}${this.options.turnSeconds?'秒':''}`,738,358,142,()=>{const list=[0,15,30,60] as const;this.options.turnSeconds=list[(list.indexOf(this.options.turnSeconds!)+1)%list.length];this.draw();});
      this.button('更多房间设置',584,425,296,()=>this.roomOptions());
    }
    this.paper=false;
    this.text('三人一队 · 六人开掼',745,519,12,C.muted);
    this.ctx.restore();this.hitOffset=0;
  }
  private roomOptions(){this.configuring=true;this.draw();}
  private drawOptions(){this.hits=[];this.paint.scrim();this.paint.paperPanel(220,80,520,390);this.paper=true;this.text('房间设置',250,118,28,C.ink);
    const toggles=[['showRemaining','显示剩余牌数'],['allowAutoPlay','允许托管'],['allowCounter','记牌器'],['resistance','抗贡']] as const;
    toggles.forEach(([key,label],i)=>this.button(`${label}：${this.options[key]?'开':'关'}`,250,154+i*54,460,()=>{this.options[key]=!this.options[key];this.draw();}));
    this.button('完成',250,402,460,()=>{this.configuring=false;this.draw();},true,true);
  }
  private table(){const room=this.room!,vm=tableView(room,this.selected,this.sort),online=this.state==='online';
    this.paint.suit('♣',24,16,24,C.gold);this.paint.text('六人掼蛋',58,29,22,C.text,600,'serif');
    this.text(`好友房 ${room.roomId}`,181,29,16,C.muted);
    this.text(`规则 ${room.rules.ruleVersion}${room.rules.ruleVersion==='6P_V1'?' · 旧版房间':''}`,24,68,13,C.muted);
    this.paint.line(24,48,628,48);
    this.text(`第 ${room.round} 局 · 打 ${room.currentLevel}`,354,28,17,C.gold);
    this.text(`A ${room.teamLevels.A}`,529,28,18,C.blue);this.text(' / ',577,28,16,C.muted);this.text(`B ${room.teamLevels.B}`,602,28,18,C.orange);
    this.paint.table();
    // Keep the upper-right corner clear for the native WeChat capsule menu.
    this.button('邀请',658,52,80,()=>this.platform.shareAppMessage(this.share()));this.button('大厅',746,52,80,()=>this.leave());
    this.button(online?'已连接':'重连',834,52,100,()=>void this.restore(room.roomId),!online);
    const positions=[[424,300],[758,216],[758,106],[397,72],[28,106],[28,216]];
    vm.seats.forEach(s=>{const [x,y]=positions[s.relative],own=s.relative===0,team=s.team==='A'?C.blue:C.orange,w=own?302:174,h=own?52:72;
      this.paint.rect(x,y,w,h,s.active?'#2c5947':'#123d34',12,s.active||this.swapSeat===s.seat?C.gold:'#426759');
      this.paint.rect(x+9,y+10,own?32:40,own?32:40,s.occupied?(s.team==='A'?'#294f53':'#574d39'):'#234a3d',10,team);
      this.paint.text(s.initial,x+18,y+(own?26:30),own?18:23,team,500,'serif');
      const labelX=x+(own?51:59);
      this.paint.text(s.nickname,labelX,y+20,14,C.text,500,'sans-serif',own?112:105);
      this.paint.text(`${s.offline?'离线 · ':''}${s.pass?'不出':s.detail}`,labelX,y+41,12,s.low?C.gold:C.muted,400,'sans-serif',own?112:107);
      if(own)this.text(`${s.team} 队 · 你的座位`,x+181,y+26,13,team);
      else {this.text(`${s.team}队`,x+13,y+61,10,team);if(s.host)this.text('房主',x+125,y+61,10,C.gold);}
      if(this.swapping)this.hits.push({x,y,w,h,run:()=>{if(!this.swapSeat){this.swapSeat=s.seat;this.draw();}else{this.act({type:'swap',seat:this.swapSeat,target:s.seat});this.swapping=false;this.swapSeat=0;}}});
    });
    if(vm.waiting){this.text('等待六位牌友准备',318,185,28);this.text(`${vm.readyCount} / 6 已准备 · ${vm.roundText} · 隔位组队`,318,224,18,C.muted);
      this.button(vm.me.ready?'取消准备':'准备',272,258,140,()=>this.act({type:'ready',ready:!vm.me.ready}),online,true);
      this.button('开始',426,258,110,()=>this.act({type:'start'}),online&&vm.host&&vm.allReady);
      this.button('随机组队',550,258,130,()=>this.act({type:'shuffleTeams'}),online&&vm.host&&vm.canShuffle);
      this.button(this.swapping?`换座 ${this.swapSeat||'选座'}`:'调整座位',28,410,165,()=>{this.swapping=!this.swapping;this.swapSeat=0;this.draw();},online&&vm.host);
      this.text('点击右上角邀请好友，或分享六位房间号。',245,453,20,C.muted);return;
    }
    this.paint.rect(289,151,382,38,'#0d372d',19,'#517660');this.paint.text(vm.turnLabel,306,170,20,C.gold,500,'sans-serif',250);
    const seconds=room.deadline===null?'不限时':`${Math.max(0,Math.ceil((room.deadline-Date.now())/1000))} 秒`;
    this.text(seconds,601,170,16,C.muted);
    if(vm.played.length){this.text(vm.lastLabel.slice(0,26),295,206,16,C.muted);vm.played.forEach((c,i)=>this.card(c,295+i*Math.min(30,350/Math.max(1,vm.played.length-1)),223,42,63));}
    else this.text(vm.tribute?'请完成贡还贡':'等待首出',338,244,24,C.muted);
    this.button(this.sort==='rank'?'按花色':'按点数',24,320,106,()=>{this.sort=this.sort==='rank'?'suit':'rank';this.groups=null;this.arranging=false;this.draw();});
    this.button('清空',140,320,80,()=>{this.selected=[];this.draw();});
    this.button('一键理牌',230,320,104,()=>{this.groups=arrangeHand(room.hand,room.currentLevel,room.rules);this.selected=[];this.groupPage=0;this.arranging=true;this.draw();},room.hand.length>0);
    this.button('调整',344,320,70,()=>{this.groups??=reconcileGroups([],room.hand,room.currentLevel,room.rules);this.arranging=true;this.draw();},room.hand.length>0);
    this.button(vm.me.autoPlay?'取消托管':'托管',740,320,110,()=>this.act({type:'auto',enabled:!vm.me.autoPlay}),online&&room.rules.allowAutoPlay);
    this.button('记牌',860,320,76,()=>this.panel('记牌器 · 公开信息',vm.counter.map(c=>`${c.label}：${c.count}`).reduce<string[]>((rows,s,i)=>{if(i%5===0)rows.push(s);else rows[rows.length-1]+='      '+s;return rows;},[])),room.rules.allowCounter);
    if(vm.tribute){this.button(vm.tributeLabel,480,488,164,()=>this.act(room.tribute.some(t=>t.from===room.mySeat&&!t.given)?{type:'tribute'}:{type:'tribute',cardId:this.selected[0]}),online&&vm.canTribute,true);
      this.button('交换进度',660,488,130,()=>this.panel('贡还贡',vm.exchanges.map(e=>`${e.fromName} → ${e.toName}：${e.label}`)));
    }else{this.button('提示',490,488,100,()=>this.hint(),online&&vm.mine);this.button('不出',602,488,100,()=>this.act({type:'pass'}),online&&vm.canPass);
      this.button('出牌',714,488,130,()=>this.act({type:'play',cardIds:[...this.selected]}),online&&vm.canPlay,true);}
    this.paint.line(24,366,936,366);this.paint.text(vm.selectionText,24,510,15,C.muted,400,'sans-serif',450);
    const ordered=this.groups?this.groups.flatMap(g=>g.ids).map(id=>room.hand.find(c=>c.id===id)!).filter(Boolean).map(c=>cardView(c,room.currentLevel,this.selected)):null;
    const cards=ordered??vm.rows.flatMap(r=>r.cards),layout=handLayout(cards.length);
    cards.forEach((c,i)=>{const x=layout.left+i*layout.step,y=layout.top-(c.selected?12:0);this.card(c,x,y,layout.width,layout.height);
      if(this.groups){const n=this.groups.findIndex(g=>g.ids.includes(c.id));this.box(x+1,y+layout.height-4,layout.width-2,3,n%2?C.blue:C.gold);this.text(String(n+1),x+5,y+layout.height-13,11,C.bg);}
      this.hits.push({x,y,w:layout.width,h:layout.height,card:c.id,run:()=>{}});});
    if(vm.ended){this.hits=[];this.paint.scrim();this.paint.paperPanel(215,102,530,364);this.paper=true;this.text(`${room.settlement?.winner} 队获胜 · 升 ${room.settlement?.upgrade} 级`,245,139,28,C.ink);
      vm.ranking.forEach((r,i)=>this.text(`${r.place}   ${r.name.slice(0,12)}   ${r.team} 队`,250,184+i*32,18));
      this.button(room.status==='finished'?'整场结束':'下一局',245,408,220,()=>this.act({type:'next'}),online&&vm.host&&room.status==='settlement',true);
      this.button('返回大厅',487,408,220,()=>this.leave());}
  }
  private card(c:{label:string;symbol:string;red:boolean;wild:boolean;selected?:boolean},x:number,y:number,w:number,h:number){
    this.paint.card(c,x,y,w,h);
  }
  private drawArrangement(){const room=this.room!,groups=this.groups!;this.hits=this.hits.filter(h=>h.card);
    // The hand remains visible and interactive while the table is covered.
    this.paint.paperPanel(210,94,530,216);this.paper=true;const pages=Math.max(1,Math.ceil(groups.length/3));this.groupPage=Math.min(this.groupPage,pages-1);
    this.text(`手牌分组 ${this.groupPage+1}/${pages}`,225,119,22,C.ink);
    this.button('上页',566,98,76,()=>{this.groupPage--;this.draw();},this.groupPage>0);this.button('下页',650,98,76,()=>{this.groupPage++;this.draw();},this.groupPage<pages-1);
    groups.slice(this.groupPage*3,this.groupPage*3+3).forEach((g,i)=>{const index=this.groupPage*3+i,y=144+i*41;
      this.button(`${index+1}. ${g.label} · ${g.ids.length}张`,224,y,222,()=>{this.selected=[...g.ids];this.draw();});
      this.button('前移',454,y,76,()=>{[groups[index-1],groups[index]]=[groups[index],groups[index-1]];this.draw();},index>0);
      this.button('后移',538,y,76,()=>{[groups[index+1],groups[index]]=[groups[index],groups[index+1]];this.draw();},index<groups.length-1);
      this.button('拆组',622,y,104,()=>{groups.splice(index,1,...g.ids.map(id=>groupCards([room.hand.find(c=>c.id===id)!],room.currentLevel,room.rules)));this.draw();},g.ids.length>1);
    });
    this.button('选牌成组',224,268,146,()=>{try{this.groups=manualGroup(groups,room.hand,this.selected,room.currentLevel,room.rules);this.groupPage=0;this.selected=[];this.draw();}catch(e){this.error(e);}},this.selected.length>0);
    this.button('重新自动理牌',378,268,174,()=>{this.groups=arrangeHand(room.hand,room.currentLevel,room.rules);this.selected=[];this.groupPage=0;this.draw();});
    this.button('完成',622,268,104,()=>{this.arranging=false;this.draw();},true,true);
  }
  private drawPanel(){const p=this.overlay!;this.hits=[];this.paint.scrim();this.paint.paperPanel(105,64,750,430);this.paper=true;this.text(p.title,132,99,27,C.ink);
    const lines:string[]=[];for(const line of p.lines){let part='';for(const ch of line){this.ctx.font='18px sans-serif';if(this.ctx.measureText(part+ch).width>685){lines.push(part);part=ch;}else part+=ch;}lines.push(part);}
    const pages=Math.max(1,Math.ceil(lines.length/8));p.page=Math.min(p.page,pages-1);lines.slice(p.page*8,p.page*8+8).forEach((line,i)=>this.text(line,132,147+i*32,18));
    this.button('上一页',132,434,110,()=>{p.page--;this.draw();},p.page>0);this.text(`${p.page+1} / ${pages}`,270,454,18,C.paperMuted);
    this.button('下一页',370,434,110,()=>{p.page++;this.draw();},p.page<pages-1);this.button('关闭',707,434,120,()=>{this.overlay=undefined;this.draw();});}
}
