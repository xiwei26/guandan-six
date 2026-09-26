import { MiniClient, ApiError, errorMessage } from '../miniprogram/services/client';
import { RoomConnection, type ConnectionState } from '../miniprogram/services/connection';
import { tableView, DEFAULT_OPTIONS, cardView } from '../miniprogram/utils/presentation';
import { canLeaveCompletely, leaveMessage } from '../miniprogram/utils/room-exit';
import {arrangeHand,reconcileGroups,manualGroup,type HandGroup} from './arrangement';
import { findHints } from '../shared/cards';
import type { RoomView, GameAction, RuleConfig } from '../shared/types';
import { WIDTH, HEIGHT, viewport, hitAt, handLayout, lobbySpread, type Hit } from './layout';
import { Painter, COLORS as C } from './paint';

type TouchEvent={touches:{clientX:number;clientY:number}[]};
type Launch={query?:Record<string,string>};
export type GamePlatform=Pick<typeof wx,'request'|'login'|'getStorageSync'|'setStorageSync'|'removeStorageSync'|'getAccountInfoSync'|'connectSocket'|'showModal'|'showToast'|'setClipboardData'|'onNetworkStatusChange'> & {
  env:{USER_DATA_PATH:string};
  chooseImage(options:{count:number;sizeType:string[];sourceType:string[];success:(result:{tempFilePaths:string[]})=>void;fail:()=>void}):void;
  getFileSystemManager():{
    readFile(options:{filePath:string;encoding:'base64';success:(result:{data:string})=>void;fail:()=>void}):void;
    writeFile(options:{filePath:string;data:string;encoding:'base64';success:()=>void;fail:()=>void}):void;
  };
  createCanvas():HTMLCanvasElement;
  createImage?():HTMLImageElement;
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
  private leaving=false;
  private selected:string[]=[];
  private groups:HandGroup[]|null=null;
  private hintIndex=0;
  private drag?:{select:boolean;seen:Set<string>};
  private actionBar={x:244,y:146};
  private actionBarDrag?:{dx:number;dy:number};
  private avatarImages=new Map<string,{version:string;image?:HTMLImageElement;loading:boolean}>();
  private profileOpen=false;
  private profileNickname='';
  private profileAvatar?:string;
  private profilePreview?:HTMLImageElement;
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
    const saved=platform.getStorageSync('gd6.ui.actionBar') as {x?:number;y?:number}|undefined;
    if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))this.actionBar={x:saved.x!,y:saved.y!};
    this.clampActionBar();
    this.canvas=platform.createCanvas();this.ctx=this.canvas.getContext('2d')!;this.paint=new Painter(this.ctx);
    this.resize();
    platform.onWindowResize(()=>this.resize());
    platform.onTouchStart(e=>this.touch(e,false));platform.onTouchMove(e=>this.touch(e,true));
    platform.onTouchEnd(()=>{this.drag=undefined;this.finishActionBarDrag();});platform.onTouchCancel(()=>{this.drag=undefined;this.finishActionBarDrag();});
    platform.onKeyboardConfirm(e=>this.finishInput(e.value));
    platform.onKeyboardComplete(()=>{this.editing=undefined;this.draw();});
    platform.onHide(()=>{this.visible=false;this.epoch++;this.connection?.stop();this.drag=undefined;this.finishActionBarDrag();this.stopClock();});
    platform.onShow(launch=>{this.visible=true;this.launch(launch);this.startClock();if(this.room)void this.restore(this.room.roomId);else{this.draw();void this.syncLobbyRoom();}});
    platform.onNetworkStatusChange(e=>{if(e.isConnected&&this.visible){if(this.room)void this.restore(this.room.roomId);else void this.syncLobbyRoom();}});
    platform.showShareMenu({menus:['shareAppMessage']});platform.onShareAppMessage(()=>this.share());
    this.launch(platform.getLaunchOptionsSync());this.startClock();this.draw();void this.syncLobbyRoom();
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
  private centeredText(s:string,x:number,y:number,size:number,color:string,maxWidth:number){
    const c=this.ctx;c.save();c.font=`400 ${size}px sans-serif`;c.textAlign='center';c.textBaseline='middle';let label=s;
    while(label.length&&c.measureText(label+'…').width>maxWidth)label=label.slice(0,-1);if(label!==s)label+='…';
    c.fillStyle=color;c.fillText(label,x,y,maxWidth);c.restore();
  }
  private box(x:number,y:number,w:number,h:number,color:string){this.paint.rect(x,y,w,h,color,Math.min(12,h/3));}
  private button(label:string,x:number,y:number,w:number,run:()=>void,enabled=true,primary=false,height=40,fontSize=16){
    const fill=primary?C.gold:this.paper?C.soft:C.panel;
    this.paint.rect(x,y,w,height,enabled?fill:this.paper?'#eeebe1':'#203e38',8,primary?'#f0d7a3':this.paper?'#d9decf':C.line);
    this.paint.text(label,x+12,y+height/2,fontSize,enabled?(primary||this.paper?C.ink:C.text):this.paper?'#8a9383':'#80968b',primary?600:400,'sans-serif',w-24);
    if(enabled&&!this.busy)this.hits.push({x:x+this.hitOffset,y,w,h:height,run});
  }
  private clampActionBar(){this.actionBar.x=Math.max(18,Math.min(WIDTH-474-18,this.actionBar.x));this.actionBar.y=Math.max(122,Math.min(262,this.actionBar.y));}
  private finishActionBarDrag(){if(!this.actionBarDrag)return;this.actionBarDrag=undefined;this.platform.setStorageSync('gd6.ui.actionBar',this.actionBar);this.draw();}
  private touch(e:TouchEvent,moving:boolean){if(this.busy||this.editing)return;const t=e.touches[0];if(!t)return;
    const x=(t.clientX-this.view.x)/this.view.scale,y=(t.clientY-this.view.y)/this.view.scale;
    if(this.actionBarDrag&&moving){this.actionBar.x=x-this.actionBarDrag.dx;this.actionBar.y=y-this.actionBarDrag.dy;this.clampActionBar();this.draw();return;}
    if(!moving){this.drag=undefined;if(this.room&&this.room.status!=='waiting'&&x>=this.actionBar.x&&x<=this.actionBar.x+25&&y>=this.actionBar.y&&y<=this.actionBar.y+44){this.actionBarDrag={dx:x-this.actionBar.x,dy:y-this.actionBar.y};return;}}
    const h=hitAt(this.hits,x,y);
    if(!moving){if(h?.card)this.drag={select:!this.selected.includes(h.card),seen:new Set()};}
    if(h?.card&&this.drag){if(!this.drag.seen.has(h.card)){this.drag.seen.add(h.card);this.selected=this.drag.select?[...new Set([...this.selected,h.card])]:this.selected.filter(id=>id!==h.card);this.draw();}}
    else if(!moving)h?.run();
  }
  private input(title:string,value:string,done:(s:string)=>void,maxLength=80){this.editing={title,done};this.draw();
    this.platform.showKeyboard({defaultValue:value,maxLength,multiple:false,confirmHold:false,confirmType:'done',fail:()=>{this.editing=undefined;this.error(new Error('无法打开输入键盘，请重试'));}});}
  private finishInput(value:string){const editing=this.editing;this.editing=undefined;this.platform.hideKeyboard({});if(editing){try{editing.done(value.trim());}catch(e){this.error(e);}}this.draw();}
  private error(e:unknown){this.platform.showModal({title:'操作未完成',content:errorMessage(e),showCancel:false});}
  private async task(run:()=>Promise<void>){if(this.busy)return;this.busy=true;this.draw();try{await run();}catch(e){this.error(e);}finally{this.busy=false;this.draw();}}
  private async syncLobbyRoom(){if(this.room||!this.api.session()||this.busy||this.leaving)return;try{await this.api.recoverRoom();}catch{/* Keep cached controls usable when the server cannot be reached. */}finally{this.draw();}}
  private async login(kind:'guest'|'wechat'){await this.task(async()=>{await this.api.login(kind,this.nickname);});await this.syncLobbyRoom();}
  private enter(mode:'create'|'join'|'demo',id?:string){if(mode==='join'&&!/^\d{6}$/.test(id||'')){this.error(new Error('请输入六位房间号'));return;}
    void this.task(async()=>{const epoch=this.epoch;const room=await this.api.enter(mode,mode==='create'?this.options:mode==='demo'?{waitForPlayers:true}:id);if(!this.visible||epoch!==this.epoch)return;this.accept(room);this.connect();});}
  private accept(room:RoomView){if(this.room?.roomId===room.roomId&&room.revision<this.room.revision)return;
    if(this.room?.round!==room.round||this.room?.totalPlays!==room.totalPlays)this.hintIndex=0;
    if(this.room?.round!==room.round||this.room?.roomId!==room.roomId){this.selected=[];this.groups=null;}
    if(this.groups)this.groups=reconcileGroups(this.groups,room.hand,room.currentLevel,room.rules);
    this.selected=this.selected.filter(id=>room.hand.some(c=>c.id===id));this.room=room;this.loadRoomAvatars(room);this.draw();}
  private connect(){this.connection?.stop();const session=this.api.session();if(!session||!this.room||!this.visible)return;
    const epoch=++this.epoch;this.connection=new RoomConnection(this.platform,this.api.server(),session,this.room.roomId,{
      room:r=>{if(epoch===this.epoch&&this.visible)this.accept(r);},state:s=>{if(epoch===this.epoch){this.state=s;this.draw();}},
      error:message=>{if(epoch===this.epoch)this.error(new Error(message));},left:()=>{if(epoch===this.epoch){this.api.remember('');this.home();}}
    });this.connection.start();}
  private async restore(id:string){if(this.leaving)return;const epoch=++this.epoch;this.connection?.stop();this.state='connecting';this.draw();
    try{const room=await this.api.room(id);if(epoch!==this.epoch||!this.visible)return;this.accept(room);this.connect();}
    catch(e){if(epoch!==this.epoch||!this.visible)return;this.state='offline';
      if(e instanceof ApiError&&[401,403,404].includes(e.status)){if(e.status!==401)this.api.remember('');this.home();}this.error(e);this.draw();}}
  private act(action:GameAction){if(!this.room||(this.state!=='online'&&action.type!=='leave'))return;
    if(action.type==='leave'){this.exitRoom();return;}
    const room=this.room,epoch=this.epoch;void this.task(async()=>{try{const next=await this.api.action(room,action);if(epoch!==this.epoch||!this.visible)return;
      if(next)this.accept(next);if(action.type==='play')this.selected=[];
    }catch(e){if(epoch===this.epoch&&this.visible)await this.restore(room.roomId);throw e;}});}
  private exitRoom(){const id=this.room?.roomId;if(!id)return;void this.task(async()=>{
    this.leaving=true;this.epoch++;this.connection?.stop();this.state='offline';
    try{await this.api.leave(id);if(this.room?.roomId===id)this.home();}
    finally{this.leaving=false;}
  });}
  private home(){this.epoch++;this.connection?.stop();this.room=null;this.state='offline';this.selected=[];this.overlay=undefined;this.swapping=false;this.swapSeat=0;this.draw();}
  private leaveSavedRoom(){const id=this.api.roomId();if(!id)return;void this.task(async()=>{try{const room=await this.api.room(id);if(!canLeaveCompletely(room))throw new Error('好友牌局仍在进行，请返回原房间；本场结束后才能完全退出。');const left=await this.api.leave(id);if(left)throw new Error('好友牌局已开始，座位已保留，请返回原房间。');this.draw();}catch(e){if(e instanceof ApiError&&[403,404].includes(e.status)){this.api.remember('');this.draw();return;}throw e;}});}
  private leave(){const id=this.room?.roomId;this.platform.showModal({title:'返回大厅',content:leaveMessage(this.room),success:r=>{if(r.confirm&&this.room?.roomId===id)this.act({type:'leave'});}});}
  private hint(){if(!this.room)return;const room=this.room;void this.task(async()=>{const hints=await this.api.hints(room.roomId);if(this.room?.revision!==room.revision||this.room.roomId!==room.roomId)return;
    this.selected=hints.length?hints[this.hintIndex++%hints.length].cards.map(c=>c.id):[];if(!hints.length)this.platform.showToast({title:'没有能压过的牌',icon:'none'});});}
  private panel(title:string,lines:string[]){this.overlay={title,lines,page:0};this.draw();}
  private settings(){this.input('后端服务地址',this.api.server(),value=>{this.api.setServer(value);this.nickname=this.api.session()?.nickname||'牌友';this.panel('连接设置',['服务地址已保存：',this.api.server(),'身份和房间按服务地址隔离。','返回大厅后登录或体验一局即可检查连接。']);void this.syncLobbyRoom();});}
  private history(){void this.task(async()=>{const [{history},{stats}]=await Promise.all([this.api.history(),this.api.stats()]);this.panel('我的战绩',[
    `${stats.rounds} 局 · ${stats.wins} 胜 · ${stats.firsts} 次头游 · 最大 ${stats.biggestBomb} 炸`,
    ...history.flatMap(h=>[`${new Date(h.at).toLocaleDateString()} · 房间 ${h.roomId} · 第 ${h.round} 局 · ${h.winner} 队胜`,h.order.map((p,i)=>`${i+1}. ${p.nickname}`).join(' / ')])
  ]);});}
  private openProfile(){const session=this.api.session();if(!session){this.error(new Error('请先登录后设置头像和昵称'));return;}
    this.profileNickname=session.nickname;this.profileAvatar=undefined;this.profilePreview=undefined;this.profileOpen=true;this.draw();}
  private chooseProfileAvatar(){
    this.platform.chooseImage({count:1,sizeType:['compressed'],sourceType:['album','camera'],success:result=>{
      const path=result.tempFilePaths[0];if(!path)return;
      const image=this.makeImage(path);if(image){image.onload=()=>{this.profilePreview=image;this.draw();};image.src=path;}
      this.platform.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:result=>{
        if(result.data.length>350_000){this.platform.showToast({title:'图片太大，请选一张较小的头像',icon:'none'});return;}
        this.profileAvatar=result.data;
        this.draw();
      },fail:()=>this.error(new Error('无法读取所选图片，请重新选择'))});
    },fail:()=>this.platform.showToast({title:'未能选择图片',icon:'none'})});
  }
  private async saveProfile(){const name=this.profileNickname.trim();if(!name||name.length>20)throw new Error('昵称需要 1–20 个字符');
    const session=await this.api.updateProfile(name,this.profileAvatar);this.nickname=session.nickname;this.avatarImages.delete(session.userId);
    if(this.room)this.accept({...this.room,players:this.room.players.map(player=>player.userId===session.userId?{...player,nickname:session.nickname,avatarVersion:session.avatarVersion??null,avatarMime:session.avatarMime??null}:player)});
    this.profileOpen=false;this.profileAvatar=undefined;this.profilePreview=undefined;this.draw();
  }
  private loadRoomAvatars(room:RoomView){
    for(const player of room.players){const version=player.avatarVersion;if(player.bot||!version)continue;
      const cached=this.avatarImages.get(player.userId);if(cached?.version===version)continue;
      const entry:{version:string;image?:HTMLImageElement;loading:boolean}={version,loading:true};this.avatarImages.set(player.userId,entry);
      void this.api.roomAvatar(room.roomId,player.userId,version).then(payload=>{
        if(this.room?.roomId!==room.roomId||this.avatarImages.get(player.userId)!==entry)return;
        const extension=payload.mime==='image/jpeg'?'jpg':payload.mime==='image/png'?'png':'webp';
        const path=`${this.platform.env.USER_DATA_PATH}/gd6-avatar-${player.userId.replace(/[^A-Za-z0-9_-]/g,'_')}-${version}.${extension}`;
        this.platform.getFileSystemManager().writeFile({filePath:path,data:payload.data,encoding:'base64',success:()=>{
          if(this.avatarImages.get(player.userId)!==entry)return;
          const image=this.makeImage(path);entry.loading=false;entry.image=image;
          if(image){image.onload=()=>{if(this.room?.roomId===room.roomId)this.draw();};image.src=path;}
          this.draw();
        },fail:()=>{entry.loading=false;this.avatarImages.delete(player.userId);this.draw();}});
      }).catch(()=>{if(this.avatarImages.get(player.userId)===entry)this.avatarImages.delete(player.userId);});
    }
  }
  private makeImage(path:string){
    const canvas=this.canvas as HTMLCanvasElement&{createImage?:()=>HTMLImageElement};
    return canvas.createImage?.()??this.platform.createImage?.();
  }
  private drawProfile(){const session=this.api.session();if(!session)return;
    this.hits=[];this.paint.scrim();this.paint.paperPanel(304,124,352,286);this.paper=true;
    this.text('个人资料',336,158,24,C.ink);
    this.paint.avatar(this.profileNickname.slice(0,1)||'牌',480,174,64,'A',this.profilePreview??this.avatarImages.get(session.userId)?.image);
    this.paint.text(this.profileNickname||'牌友',436,253,17,C.ink,500,'sans-serif',160);
    this.button('选择头像',336,278,128,()=>this.chooseProfileAvatar());
    this.button('设置昵称',480,278,140,()=>this.input('设置昵称',this.profileNickname,value=>{if(!value||value.length>20)throw new Error('昵称需要 1–20 个字符');this.profileNickname=value;},20));
    this.button('取消',336,344,128,()=>{this.profileOpen=false;this.profileAvatar=undefined;this.profilePreview=undefined;this.draw();});
    this.button('保存资料',480,344,140,()=>void this.task(()=>this.saveProfile()),true,true);
    this.paper=false;
  }
  draw(){if(!this.ctx||!this.visible)return;this.hits=[];this.ctx.save();this.ctx.setTransform(1,0,0,1,0,0);this.ctx.fillStyle=C.bg;this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.ctx.restore();
    this.paper=false;this.hitOffset=0;const b=this.background;this.paint.backdrop(b.x,b.y,b.w,b.h);
    if(this.room)this.table();else this.lobby();
    if(this.overlay)this.drawPanel();
    if(this.configuring)this.drawOptions();
    if(this.profileOpen)this.drawProfile();
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
      this.button('电脑局 · 1–6 位真人',584,252,296,()=>this.enter('demo'));
      this.text('支持 1–6 位真人，不足六人时自动由电脑补位',584,305,12,C.paperMuted);
      this.button('返回上次房间',584,329,190,()=>void this.restore(this.api.roomId()),!!this.api.roomId());this.button('退出旧房',784,329,96,()=>this.leaveSavedRoom(),!!this.api.roomId());
      this.button(`局数：${this.options.rounds==='A'?'打到 A':this.options.rounds}`,584,382,142,()=>{const list=[1,2,4,8,'A'] as const;this.options.rounds=list[(list.indexOf(this.options.rounds!)+1)%list.length];this.draw();});
      this.button(`计时：${this.options.turnSeconds||'不限'}${this.options.turnSeconds?'秒':''}`,738,382,142,()=>{const list=[0,15,30,60] as const;this.options.turnSeconds=list[(list.indexOf(this.options.turnSeconds!)+1)%list.length];this.draw();});
      this.button('更多房间设置',584,449,296,()=>this.roomOptions());
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
  private table(){this.polishedTable();}
  private polishedTable(){
    const room=this.room!,vm=tableView(room,this.selected,'rank'),online=this.state==='online';
    const seats=[{cx:68,y:282},{cx:870,y:190},{cx:870,y:100},{cx:480,y:50},{cx:68,y:100},{cx:68,y:190}];
    this.paint.suit('♣',24,16,24,C.gold);this.paint.text('六人掼蛋',58,29,22,C.text,600,'serif');
    this.text((room.mode==='computer'?'电脑局':'好友房')+' '+room.roomId,181,29,16,C.muted);
    this.text('规则 '+room.rules.ruleVersion+(room.rules.ruleVersion==='6P_V1'?' · 旧版房间':''),24,68,13,C.muted);
    this.paint.line(24,48,628,48);this.text('第 '+room.round+' 局 · 打 '+room.currentLevel,354,28,17,C.gold);
    this.text('A '+room.teamLevels.A,529,28,18,C.blue);this.text(' / ',577,28,16,C.muted);this.text('B '+room.teamLevels.B,602,28,18,C.orange);
    this.paint.table(vm.waiting);
    this.button('邀请',658,52,80,()=>this.platform.shareAppMessage(this.share()));this.button('大厅',746,52,80,()=>this.leave());
    this.button(online?'已连接':'重连',834,52,100,()=>void this.restore(room.roomId),!online);
    vm.seats.forEach(seat=>{
      const {cx,y}=seats[seat.relative],own=seat.relative===0,size=own?48:44,teamColor=seat.team==='A'?C.blue:C.orange;
      const player=room.players.find(item=>item.seat===seat.seat),avatar=player?this.avatarImages.get(player.userId)?.image:undefined;
      if(seat.active)this.paint.ellipse(cx,y+size/2,size/2+5,size/2+5,'transparent',C.gold);
      if(this.swapSeat===seat.seat)this.paint.ellipse(cx,y+size/2,size/2+7,size/2+7,'transparent',C.gold);
      this.paint.avatar(seat.initial,cx,y,size,seat.team as 'A'|'B',avatar);
      this.centeredText(own?seat.nickname.replace(/ · 你$/,''):seat.nickname,cx,y+size+12,own?12:13,C.text,148);
      const secondary=vm.waiting?seat.team+'队 · '+(seat.ready?'已准备':'未准备')
        :own?(room.hand.length<=10?'仅剩 '+room.hand.length+' 张':'')
        :seat.team+'队 · '+(seat.offline?'离线':seat.pass?'不出':seat.detail);
      if(secondary)this.centeredText(secondary,cx,y+size+29,11,seat.low?C.gold:teamColor,154);
      if(own)this.hits.push({x:cx-size/2,y,w:size,h:size,run:()=>this.openProfile()});
      if(this.swapping)this.hits.push({x:cx-42,y:y-3,w:84,h:size+35,run:()=>{
        if(!this.swapSeat){this.swapSeat=seat.seat;this.draw();}
        else{this.act({type:'swap',seat:this.swapSeat,target:seat.seat});this.swapping=false;this.swapSeat=0;}
      }});
    });
    if(vm.waiting){
      const realCount=room.players.filter(player=>!player.bot).length;
      this.centeredText(room.mode==='computer'?'真人不满六人，空位电脑补位':'等待六位牌友准备',480,252,26,C.text,590);
      this.centeredText(room.mode==='computer'?'当前 '+realCount+' 位真人 · '+vm.readyCount+' 位已准备 · '+vm.roundText:vm.readyCount+' / 6 已准备 · '+vm.roundText,480,293,19,C.muted,620);
      this.centeredText(this.swapping?(this.swapSeat?'再点目标座位完成换座':'先选未准备玩家，再选目标座位'):'分享房间号，邀请好友入座',480,334,16,C.muted,620);
      this.button(this.swapping?'换座 '+(this.swapSeat||'选座'):'调整座位',28,480,196,()=>{this.swapping=!this.swapping;this.swapSeat=0;this.draw();},online&&vm.host,false,48,19);
      this.button('随机组队',236,480,196,()=>this.act({type:'shuffleTeams'}),online&&vm.host&&vm.canShuffle,false,48,19);
      this.button(vm.me.ready?'取消准备':'准备',460,480,206,()=>this.act({type:'ready',ready:!vm.me.ready}),online,!vm.me.ready,48,19);
      this.button('开始',678,480,254,()=>this.act({type:'start'}),online&&vm.host&&vm.allReady,true,48,19);return;
    }
    if(room.lastPlay&&room.lastPlaySeat!==null&&vm.played.length){
      const relative=(room.lastPlaySeat-room.mySeat+6)%6,myPlay=relative===0,total=myPlay?42+(vm.played.length-1)*24:22+(vm.played.length-1)*15;
      const anchor=relative===3?{x:503,y:99}:relative===1?{x:610,y:247}:relative===2?{x:610,y:193}:relative===4?{x:150,y:193}:{x:150,y:247};
      const cardWidth=myPlay?42:22,cardHeight=myPlay?63:38,gap=myPlay?24:15,start=myPlay?480-total/2:anchor.x;
      this.centeredText(vm.lastLabel.slice(0,24),myPlay?480:start+Math.min(total/2,105),myPlay?198:anchor.y-9,12,C.muted,210);
      vm.played.forEach((card,index)=>this.card(card,start+index*gap,anchor.y,cardWidth,cardHeight));
    }else if(!vm.tribute)this.centeredText('等待首出',480,224,22,C.muted,240);
    if(vm.tribute)this.centeredText('贡还贡 · 按提示选择牌',480,220,19,C.gold,300);
    const seconds=room.deadline===null?'不限时':Math.max(0,Math.ceil((room.deadline-Date.now())/1000))+' 秒';
    this.drawActionBar(vm,online,seconds);
    this.button('一键理牌',520,310,104,()=>{this.groups=arrangeHand(room.hand,room.currentLevel,room.rules);this.selected=[];this.draw();},room.hand.length>0,true,30,13);
    this.button('组合',632,310,72,()=>{try{this.groups=manualGroup(this.groups??[],room.hand,this.selected,room.currentLevel,room.rules);this.selected=[];this.draw();}catch(error){this.error(error);}},this.selected.length>0,false,30,13);
    this.button('还原',712,310,72,()=>{this.groups=null;this.selected=[];this.draw();},room.hand.length>0,false,30,13);
    this.button(vm.tribute?'交换进度':vm.me.autoPlay?'取消托管':'托管',792,310,76,()=>vm.tribute?this.panel('贡还贡',vm.exchanges.map(exchange=>exchange.fromName+' → '+exchange.toName+'：'+exchange.label)):this.act({type:'auto',enabled:!vm.me.autoPlay}),vm.tribute||online&&room.rules.allowAutoPlay,false,30,12);
    this.button('记牌',876,310,60,()=>this.panel('记牌器 · 公开信息',vm.counter.map(item=>item.label+'：'+item.count).reduce<string[]>((rows,label,index)=>{if(index%5===0)rows.push(label);else rows[rows.length-1]+='      '+label;return rows;},[])),room.rules.allowCounter,false,30,12);
    const straightFlushes=new Map<string,{rank:number;ids:string[]}>();
    for(const play of findHints(room.hand,null,room.currentLevel,room.rules).filter(item=>item.type==='straightFlush')){
      const naturals=play.cards.filter(card=>!(card.suit==='heart'&&card.rank===room.currentLevel)),suit=naturals[0]?.suit;
      if(!suit||suit==='joker'||naturals.some(card=>card.suit!==suit))continue;
      const previous=straightFlushes.get(suit);if(!previous||play.rank>previous.rank)straightFlushes.set(suit,{rank:play.rank,ids:play.cards.map(card=>card.id)});
    }
    this.centeredText('同花顺',700,360,11,C.muted,52);
    ([
      ['spade','♠'],['heart','♥'],['club','♣'],['diamond','♦']
    ] as const).forEach(([suit,symbol],index)=>{
      const x=758+index*44,available=straightFlushes.has(suit),red=suit==='heart'||suit==='diamond';
      this.paint.rect(x,346,38,28,available?'#ead9b2':'#203e38',7,available?(red?C.red:C.ink):C.line);
      this.paint.suit(symbol,x+10,351,17,available?(red?C.red:C.ink):'#71877b');
      if(available)this.hits.push({x,y:346,w:38,h:28,run:()=>{this.groups=null;this.selected=[...straightFlushes.get(suit)!.ids];this.draw();}});
    });
    this.paint.line(24,376,936,376,'#54756888');
    if(this.groups)this.paint.text(vm.selectionText,190,377,12,this.selected.length?C.gold:C.muted,400,'sans-serif',520);
    else this.paint.text(vm.selectionText,24,510,14,this.selected.length?C.gold:C.muted,400,'sans-serif',520);
    if(this.groups){
      const cardsById=new Map(room.hand.map(card=>[card.id,card])),blocks:{ids:string[];group:number;single:boolean}[]=[];
      this.groups.forEach((group,index)=>{
        const ids=group.ids.filter(id=>cardsById.has(id));
        if(ids.length===1&&blocks[blocks.length-1]?.single)blocks[blocks.length-1].ids.push(ids[0]);
        else if(ids.length)blocks.push({ids:[...ids],group:index,single:ids.length===1});
      });
      let x=27,y=386,rowHeight=68;
      for(const block of blocks){
        const cardW=60,cardH=68,horizontalStep=block.single?24:6,verticalStep=block.single?0:5,width=cardW+Math.max(0,block.ids.length-1)*horizontalStep;
        if(x+width>936&&x>27){x=27;y+=rowHeight+7;rowHeight=68;}
        block.ids.forEach((id,index)=>{
          const card=cardsById.get(id)!,view=cardView(card,room.currentLevel,this.selected),cardX=x+index*horizontalStep,cardY=y+index*verticalStep-(view.selected?10:0);
          this.card(view,cardX,cardY,cardW,cardH);this.hits.push({x:cardX,y:cardY,w:cardW,h:cardH,card:id,run:()=>{}});
          if(!block.single){this.box(cardX+1,cardY+cardH-4,cardW-2,3,block.group%2?C.blue:C.gold);if(index===0)this.text(String(block.group+1),cardX+4,cardY+cardH-12,9,C.bg);}
        });
        rowHeight=Math.max(rowHeight,cardH+Math.max(0,block.ids.length-1)*verticalStep);x+=width+(block.single?0:9);
      }
    }else{
      const cards=vm.rows.flatMap(row=>row.cards),layout=handLayout(cards.length);
      cards.forEach((card,index)=>{const x=layout.left+index*layout.step,y=layout.top-(card.selected?12:0);this.card(card,x,y,layout.width,layout.height);this.hits.push({x,y,w:layout.width,h:layout.height,card:card.id,run:()=>{} });});
    }
    if(vm.ended){
      this.hits=[];this.paint.scrim();this.paint.paperPanel(215,102,530,364);this.paper=true;this.text((room.settlement?.winner??'')+' 队获胜 · 升 '+room.settlement?.upgrade+' 级',245,139,28,C.ink);
      vm.ranking.forEach((entry,index)=>this.text(entry.place+'   '+entry.name.slice(0,12)+'   '+entry.team+' 队',250,184+index*32,18));
      this.button(room.status==='finished'?'整场结束':'下一局',245,408,220,()=>this.act({type:'next'}),online&&vm.host&&room.status==='settlement',true);
      this.button('返回大厅',487,408,220,()=>this.leave());
    }
  }
  private drawActionBar(vm:ReturnType<typeof tableView>,online:boolean,seconds:string){
    const x0=this.actionBar.x+28,y=this.actionBar.y,h=40;let x=x0;
    this.paint.rect(this.actionBar.x,y,474,h,'#0c302b',13,'#56806b');
    for(const dot of [0,1,2]){this.paint.ellipse(this.actionBar.x+9,y+13+dot*7,1.5,1.5,'#a6bfb0');this.paint.ellipse(this.actionBar.x+17,y+13+dot*7,1.5,1.5,'#a6bfb0');}
    const room=this.room!;
    const segment=(label:string,width:number,fill:string,enabled:boolean,run?:()=>void)=>{
      this.paint.rect(x,y+4,width,h-8,fill,8,enabled?'#ffffff25':'#ffffff0a');
      this.centeredText(label,x+width/2,y+h/2,12,enabled?C.text:'#7e9387',width-10);
      if(enabled&&run)this.hits.push({x,y,w:width,h,run});x+=width+4;
    };
    const turn=room.status==='tribute'?'贡还贡':vm.me.autoPlay?'托管中':vm.mine?'轮到你':vm.turnLabel;
    segment(turn,130,'#17483c',false);
    segment('提示',70,'#356a81',online&&vm.mine,()=>this.hint());
    segment('不出',70,'#82513b',online&&vm.canPass,()=>this.act({type:'pass'}));
    if(room.status==='tribute')segment(vm.tributeLabel,76,'#3e7751',online&&vm.canTribute,()=>this.act(room.tribute.some(item=>item.from===room.mySeat&&!item.given)?{type:'tribute'}:{type:'tribute',cardId:this.selected[0]}));
    else segment('出牌',76,'#397b53',online&&vm.canPlay,()=>this.act({type:'play',cardIds:[...this.selected]}));
    segment(seconds,80,'#17382f',false);
  }
  private card(c:{label:string;symbol:string;red:boolean;wild:boolean;selected?:boolean},x:number,y:number,w:number,h:number){
    this.paint.card(c,x,y,w,h);
  }
  private drawPanel(){const p=this.overlay!;this.hits=[];this.paint.scrim();this.paint.paperPanel(105,64,750,430);this.paper=true;this.text(p.title,132,99,27,C.ink);
    const lines:string[]=[];for(const line of p.lines){let part='';for(const ch of line){this.ctx.font='18px sans-serif';if(this.ctx.measureText(part+ch).width>685){lines.push(part);part=ch;}else part+=ch;}lines.push(part);}
    const pages=Math.max(1,Math.ceil(lines.length/8));p.page=Math.min(p.page,pages-1);lines.slice(p.page*8,p.page*8+8).forEach((line,i)=>this.text(line,132,147+i*32,18));
    this.button('上一页',132,434,110,()=>{p.page--;this.draw();},p.page>0);this.text(`${p.page+1} / ${pages}`,270,454,18,C.paperMuted);
    this.button('下一页',370,434,110,()=>{p.page++;this.draw();},p.page<pages-1);this.button('关闭',707,434,120,()=>{this.overlay=undefined;this.draw();});}
}
