import { MiniClient, ApiError, errorMessage } from '../miniprogram/services/client';
import { RoomConnection, type ConnectionState } from '../miniprogram/services/connection';
import { tableView, DEFAULT_OPTIONS, cardView, PLACES } from '../miniprogram/utils/presentation';
import { canLeaveCompletely, leaveMessage } from '../miniprogram/utils/room-exit';
import {arrangeHand,reconcileGroups,manualGroup,displayGroups,groupTag,patternName,type HandGroup} from './arrangement';
import { findHints } from '../shared/cards';
import type { RoomView, GameAction, RuleConfig } from '../shared/types';
import { WIDTH, HEIGHT, HAND_BOTTOM, STACK, TOP_SEAT_CX, SIDE_SEAT_HALF, SIDE_SEAT_TEXT, viewport, hitAt, handLayout, stackLayout, seatSpots, seatBounds, lobbySpread, tableEdge, type Hit } from './layout';
import { Painter, COLORS as C, THEMES, applyTheme, type ThemeName, type CardFace } from './paint';

/** The card counter is reserved as a future paid feature; flip this to show it again. */
const CARD_COUNTER_ENABLED=false;

type TouchEvent={touches:{clientX:number;clientY:number}[]};
type Box={x:number;y:number;w:number;h:number};
type HandItems={cards:{view:CardFace;id:string;x:number;y:number;w:number;h:number;index:'row'|'column';strip:number}[];tags:{label:string;right:number;bottom:number}[]};
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
  '首局打 2；大王 > 小王 > 当前级牌 > A 至 2。红桃级牌为逢人配，可以替普通牌，不能替王。',
  '支持单张、对子、三张、三带二、顺子、三连对、钢板、同花顺、4–12 张炸弹。',
  '天王炸 > 12–7 炸 > 三大王 > 三小王 > 6 炸 > 同花顺 > 5 炸 > 4 炸。王炸不许配牌。',
  '头游队获胜。末尾连续 3 / 2 / 1 名对手，升 4 / 3 / 2 级；末游同队只升 1 级。例如打 2 升 4 级，下局打 6；升 2 级，下局打 4。',
  '胜方三人出完后，其余玩家不再出牌，按剩牌数从多到少排为末游、五游、四游，直接进入下一局。',
  '出完者最后一手无人压，由顺时针最近的未出完队友接风，无队友则由下一人首出。',
  '末尾 3 / 2 / 1 名均为对手时，这几名对手进贡；末游与头游同队时，末游向本队头游进贡。贡牌按大小依次给头游及其后的胜方玩家。进最大非逢人配牌；还 2–9 非级牌，没有时还最小非逢人配。',
  '首局随机选人首出，之后由进贡牌最大者首出。单贡者须有 3 张大王、双/三贡败队合计 3 张大王可抗贡，抗贡时由上局头游首出。',
  '打到 A：须在己方打 A 的一局拿到头游，且末游是对方。对方头游，或头游末游都是己方，记闯关失败一次；前者对方继续升级，后者下局继续打 A。累计失败 3 次退回打 2。',
  '固定局数打满结束，展示等级与本局排名。'
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
  private edge=0;
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
  private theme:ThemeName='green';
  /** Where the viewer dragged the turn buttons; unset means automatic placement. */
  private turnPos?:{x:number;y:number};
  private press?:{run:()=>void;x:number;y:number;origin:{x:number;y:number};width:number;moved:boolean};
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
    const turnPos=platform.getStorageSync('gd6.ui.turnButtons') as {x?:number;y?:number}|undefined;
    if(turnPos&&Number.isFinite(turnPos.x)&&Number.isFinite(turnPos.y))this.turnPos={x:turnPos.x!,y:turnPos.y!};
    const theme=platform.getStorageSync('gd6.ui.theme') as ThemeName|undefined;
    if(theme&&theme in THEMES)this.theme=theme;applyTheme(this.theme);
    this.canvas=platform.createCanvas();this.ctx=this.canvas.getContext('2d')!;this.paint=new Painter(this.ctx);
    this.resize();
    platform.onWindowResize(()=>this.resize());
    platform.onTouchStart(e=>this.touch(e,false));platform.onTouchMove(e=>this.touch(e,true));
    platform.onTouchEnd(()=>{this.drag=undefined;this.release();});platform.onTouchCancel(()=>{this.drag=undefined;this.press=undefined;});
    platform.onKeyboardConfirm(e=>this.finishInput(e.value));
    platform.onKeyboardComplete(()=>{this.editing=undefined;this.draw();});
    platform.onHide(()=>{this.visible=false;this.epoch++;this.connection?.stop();this.drag=undefined;this.press=undefined;this.stopClock();});
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
    this.edge=tableEdge(info.windowWidth,info.windowHeight,info.safeArea);
    this.background={x:-this.view.x/this.view.scale,y:-this.view.y/this.view.scale,w:info.windowWidth/this.view.scale,h:info.windowHeight/this.view.scale};
    this.ctx.setTransform(dpr*this.view.scale,0,0,dpr*this.view.scale,dpr*this.view.x,dpr*this.view.y);this.draw();}
  private text(s:string,x:number,y:number,size=18,color:string=this.paper?C.ink:C.text){this.paint.text(s,x,y,size,color);}
  private centeredText(s:string,x:number,y:number,size:number,color:string,maxWidth:number){
    const c=this.ctx;c.save();c.font=`400 ${size}px sans-serif`;c.textAlign='center';c.textBaseline='middle';let label=s;
    if(c.measureText(label).width>maxWidth){while(label.length&&c.measureText(label+'…').width>maxWidth)label=label.slice(0,-1);label+='…';}
    c.fillStyle=color;c.fillText(label,x,y,maxWidth);c.restore();
  }
  private button(label:string,x:number,y:number,w:number,run:()=>void,enabled=true,primary=false,height=40,fontSize=16){
    const fill=primary?C.gold:this.paper?C.soft:C.panel;
    this.paint.rect(x,y,w,height,enabled?fill:this.paper?'#eeebe1':C.disabled,8,primary?'#f0d7a3':this.paper?'#d9decf':C.line);
    this.paint.text(label,x+12,y+height/2,fontSize,enabled?(primary||this.paper?C.ink:C.text):this.paper?'#8a9383':C.disabledText,primary?600:400,'sans-serif',w-24);
    if(enabled&&!this.busy)this.hits.push({x:x+this.hitOffset,y,w,h:height,run});
  }
  private setTheme(theme:ThemeName){this.theme=theme;applyTheme(theme);this.platform.setStorageSync('gd6.ui.theme',theme);this.draw();}
  /** Table colour swatches; centred on `cx` when `centered` is set, otherwise starting at `x`. */
  private themePicker(x:number,y:number,centered=false){
    const names=Object.keys(THEMES) as ThemeName[],chip=74,gap=8,labelWidth=40;
    const left=centered?x-(labelWidth+names.length*chip+(names.length-1)*gap)/2:x;
    this.paint.text('桌面',left,y+14,13,C.muted);
    names.forEach((name,i)=>{
      const cx=left+labelWidth+i*(chip+gap),selected=this.theme===name;
      this.paint.rect(cx,y,chip,28,selected?'#ffffff1c':'#00000022',14,selected?C.gold:C.line);
      this.paint.ellipse(cx+16,y+14,8,8,THEMES[name].feltCenter,'#ffffff66');
      this.paint.text(THEMES[name].label,cx+30,y+14,13,selected?C.gold:C.text);
      this.hits.push({x:cx+this.hitOffset,y,w:chip,h:28,run:()=>this.setTheme(name)});
    });
  }
  private touch(e:TouchEvent,moving:boolean){if(this.busy||this.editing)return;const t=e.touches[0];if(!t)return;
    const x=(t.clientX-this.view.x)/this.view.scale,y=(t.clientY-this.view.y)/this.view.scale;
    if(moving&&this.press){
      const press=this.press;if(!press.moved&&Math.hypot(x-press.x,y-press.y)<8)return;
      press.moved=true;this.turnPos=this.clampTurn({x:press.origin.x+x-press.x,y:press.origin.y+y-press.y},press.width);this.draw();return;
    }
    if(!moving){this.drag=undefined;this.press=undefined;}
    const h=hitAt(this.hits,x,y);
    // Turn buttons act on release so the same touch can drag the whole row instead.
    if(!moving&&h?.row){this.press={run:h.run,x,y,origin:{x:h.row.x,y:h.row.y},width:h.row.width,moved:false};return;}
    if(!moving){if(h?.card)this.drag={select:!this.selected.includes(h.card),seen:new Set()};}
    if(h?.card&&this.drag){if(!this.drag.seen.has(h.card)){this.drag.seen.add(h.card);this.selected=this.drag.select?[...new Set([...this.selected,h.card])]:this.selected.filter(id=>id!==h.card);this.draw();}}
    else if(!moving)h?.run();
  }
  private release(){const press=this.press;this.press=undefined;if(!press)return;
    if(press.moved){this.platform.setStorageSync('gd6.ui.turnButtons',this.turnPos);this.draw();}else press.run();}
  private clampTurn(pos:{x:number;y:number},width:number){return {x:Math.max(8-this.edge,Math.min(WIDTH+this.edge-8-width,pos.x)),y:Math.max(36,Math.min(HAND_BOTTOM-64,pos.y))};}
  private input(title:string,value:string,done:(s:string)=>void,maxLength=80){this.editing={title,done};this.draw();
    this.platform.showKeyboard({defaultValue:value,maxLength,multiple:false,confirmHold:false,confirmType:'done',fail:()=>{this.editing=undefined;this.error(new Error('无法打开输入键盘，请重试'));}});}
  private finishInput(value:string){const editing=this.editing;this.editing=undefined;this.platform.hideKeyboard({});if(editing){try{editing.done(value.trim());}catch(e){this.error(e);}}this.draw();}
  private error(e:unknown){this.platform.showModal({title:'操作未完成',content:errorMessage(e),showCancel:false});}
  private async task(run:()=>Promise<void>){if(this.busy)return;this.busy=true;this.draw();try{await run();}catch(e){this.error(e);}finally{this.busy=false;this.draw();}}
  private async syncLobbyRoom(){if(this.room||!this.api.session()||this.busy||this.leaving)return;try{await this.api.recoverRoom();}catch{/* Keep cached controls usable when the server cannot be reached. */}finally{this.draw();}}
  private async login(kind:'guest'|'wechat'){await this.task(async()=>{await this.api.login(kind,this.nickname);});await this.syncLobbyRoom();}
  private enter(mode:'create'|'join'|'demo',id?:string){if(mode==='join'&&!/^\d{6}$/.test(id||'')){this.error(new Error('请输入六位房间号'));return;}
    void this.task(async()=>{const epoch=this.epoch;const room=await this.api.enter(mode,mode==='create'||mode==='demo'?this.options:id);if(!this.visible||epoch!==this.epoch)return;this.accept(room);this.connect();});}
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
      this.platform.getFileSystemManager().readFile({filePath:path,encoding:'base64',success:result=>{
        if(result.data.length>350_000){this.platform.showToast({title:'图片太大，请选一张较小的头像',icon:'none'});return;}
        this.profileAvatar=result.data;
        const image=this.makeImage(path);this.profilePreview=image;
        if(image){image.onload=()=>this.draw();image.src=path;}
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
        if(this.avatarImages.get(player.userId)!==entry)return;
        const activePlayer=this.room?.players.find(item=>item.userId===player.userId);
        if(activePlayer?.avatarVersion!==version){this.avatarImages.delete(player.userId);return;}
        const extension=payload.mime==='image/jpeg'?'jpg':payload.mime==='image/png'?'png':'webp';
        const path=`${this.platform.env.USER_DATA_PATH}/gd6-avatar-${player.userId.replace(/[^A-Za-z0-9_-]/g,'_')}-${version}.${extension}`;
        this.platform.getFileSystemManager().writeFile({filePath:path,data:payload.data,encoding:'base64',success:()=>{
          if(this.avatarImages.get(player.userId)!==entry)return;
          const image=this.makeImage(path);entry.loading=false;entry.image=image;
          if(image){image.onload=()=>{if(this.room?.roomId===room.roomId)this.draw();};image.src=path;}
          this.draw();
        },fail:()=>{if(this.avatarImages.get(player.userId)!==entry)return;entry.loading=false;this.avatarImages.delete(player.userId);this.draw();}});
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
    this.paint.suit('♣',56,34,25,C.gold);this.text('好友相聚，开一局',94,48,14,C.muted);this.themePicker(248,34);
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
    const toggles=([['showRemaining','显示剩余牌数'],['allowAutoPlay','允许托管'],['allowCounter','记牌器'],['resistance','抗贡']] as const).filter(([key])=>key!=='allowCounter'||CARD_COUNTER_ENABLED);
    toggles.forEach(([key,label],i)=>this.button(`${label}：${this.options[key]?'开':'关'}`,250,154+i*54,460,()=>{this.options[key]=!this.options[key];this.draw();}));
    this.button('完成',250,402,460,()=>{this.configuring=false;this.draw();},true,true);
  }
  private table(){this.polishedTable();}
  /** Opponents' card counts appear only once they are down to ten cards or fewer. */
  private seatStatus(room:RoomView,seat:ReturnType<typeof tableView>['seats'][number],player?:RoomView['players'][number]){
    if(!player)return seat.team+'队 · '+seat.detail;
    const own=seat.relative===0,count=own?room.hand.length:player.remainingCards;
    const info=seat.offline?['离线']:seat.pass?['不出']:player.finishRank?[PLACES[player.finishRank-1]]
      :[count!==null&&count<=10?(own?'仅剩 ':'')+count+' 张':'',player.bot?'机器人':player.autoPlay?'托管':''];
    return [seat.team+'队',...info].filter(Boolean).join(' · ');
  }
  private measure(s:string,size:number,weight=400){const c=this.ctx;c.save();c.font=`${weight} ${size}px sans-serif`;const width=c.measureText(s).width;c.restore();return width;}
  private polishedTable(){
    const room=this.room!,vm=tableView(room,this.selected,'rank'),online=this.state==='online',spots=seatSpots(this.edge);
    this.paint.suit('♣',22,13,22,C.gold);this.paint.text('六人掼蛋',52,24,21,C.text,600,'serif');
    this.text((room.mode==='computer'?'电脑局':'好友房')+' '+room.roomId,150,17,14,C.muted);
    this.text('规则 '+room.rules.ruleVersion+(room.rules.ruleVersion==='6P_V1'?' · 旧版房间':''),150,33,11,C.muted);
    // The round label is placed so its "局" sits directly above the top seat's avatar.
    const lead='第 '+room.round+' ';
    this.text(lead+'局 · 打 '+room.currentLevel,TOP_SEAT_CX-this.measure(lead,16)-this.measure('局',16)/2,24,16,C.gold);
    let levelX=410;
    const level=(s:string,size:number,color:string)=>{this.text(s,levelX,24,size,color);levelX+=this.measure(s,size);};
    for(const team of ['A','B'] as const){
      if(team==='B'){levelX+=8;level('/',15,C.muted);levelX+=8;}
      level(team+' '+room.teamLevels[team],17,team==='A'?C.blue:C.orange);
      const failures=room.aceFailures?.[team]??0;if(failures)level(` 失败${failures}/3`,11,C.gold);
    }
    // Header actions stay left of the WeChat capsule. Invite and connection status are pre-game only; reconnect returns when offline.
    if(vm.waiting)this.button('邀请',562,6,64,()=>this.platform.shareAppMessage(this.share()),true,false,30,14);
    if(vm.waiting||!online)this.button(online?'已连接':'重连',632,6,76,()=>void this.restore(room.roomId),!online,false,30,14);
    this.button('返回大厅',714,6,92,()=>this.leave(),true,false,30,14);
    let topTextRight=TOP_SEAT_CX+40,ownTextRight=100;
    vm.seats.forEach(seat=>{
      const spot=spots[seat.relative],{cx,y,size}=spot,own=seat.relative===0,teamColor=seat.team==='A'?C.blue:C.orange;
      const player=room.players.find(item=>item.seat===seat.seat),avatar=player?this.avatarImages.get(player.userId)?.image:undefined;
      if(seat.active)this.paint.ellipse(cx,y+size/2,size/2+5,size/2+5,'transparent',C.gold);
      if(this.swapSeat===seat.seat)this.paint.ellipse(cx,y+size/2,size/2+7,size/2+7,'transparent',C.gold);
      this.paint.avatar(seat.initial,cx,y,size,seat.team as 'A'|'B',avatar);
      const name=own?seat.nickname.replace(/ · 你$/,''):seat.nickname,color=seat.low?C.gold:teamColor;
      const secondary=vm.waiting?seat.team+'队 · '+(seat.ready?'已准备':'未准备'):this.seatStatus(room,seat,player);
      if(spot.row){
        const x=cx+size/2+9;this.paint.text(name,x,y+size/2-10,17,C.text,500,'sans-serif',124);this.paint.text(secondary,x,y+size/2+12,14,color,400,'sans-serif',150);
        const right=x+Math.min(150,Math.max(this.measure(name,17,500),this.measure(secondary,14)));
        if(seat.relative===3)topTextRight=right;else ownTextRight=right;
      }else{
        // The text may use the room out to the screen edge; a play hugging the avatar sits above the name row.
        const reach=Math.min(90,cx<WIDTH/2?cx+this.edge-4:WIDTH+this.edge-cx-4);
        this.centeredText(name,cx,y+size+14,17,C.text,reach*2);this.centeredText(secondary,cx,y+size+33,14,color,reach*2);
      }
      const bounds=seatBounds(seat.relative,this.edge);
      if(own)this.hits.push({...bounds,run:()=>this.openProfile()});
      if(this.swapping)this.hits.push({...bounds,run:()=>{
        if(!this.swapSeat){this.swapSeat=seat.seat;this.draw();}
        else{this.act({type:'swap',seat:this.swapSeat,target:seat.seat});this.swapping=false;this.swapSeat=0;}
      }});
    });
    if(!vm.waiting)this.drawExchange(room,spots,ownTextRight);
    if(vm.waiting){
      const realCount=room.players.filter(player=>!player.bot).length;
      this.centeredText(room.mode==='computer'?'真人不满六人，空位电脑补位':'等待六位牌友准备',480,214,26,C.text,590);
      this.centeredText(room.mode==='computer'?'当前 '+realCount+' 位真人 · '+vm.readyCount+' 位已准备 · '+vm.roundText:vm.readyCount+' / 6 已准备 · '+vm.roundText,480,252,19,C.muted,620);
      this.centeredText(this.swapping?(this.swapSeat?'再点目标座位完成换座':'先选未准备玩家，再选目标座位'):'分享房间号，邀请好友入座',480,286,16,C.muted,620);
      this.themePicker(480,318,true);
      this.button(this.swapping?'换座 '+(this.swapSeat||'选座'):'调整座位',142,380,160,()=>{this.swapping=!this.swapping;this.swapSeat=0;this.draw();},online&&vm.host,false,48,19);
      this.button('随机组队',314,380,160,()=>this.act({type:'shuffleTeams'}),online&&vm.host&&vm.canShuffle,false,48,19);
      this.button(vm.me.ready?'取消准备':'准备',486,380,150,()=>this.act({type:'ready',ready:!vm.me.ready}),online,!vm.me.ready,48,19);
      this.button('开始',648,380,170,()=>this.act({type:'start'}),online&&vm.host&&vm.allReady,true,48,19);return;
    }
    // Lay the hand out first so plays and turn buttons can keep clear of tall arranged columns.
    const hand=this.handItems(room,vm,spots);
    const handTop=(x0:number,x1:number)=>Math.min(HAND_BOTTOM,...hand.cards.filter(card=>card.x<x1&&card.x+card.w>x0).map(card=>card.y));
    let play:{box:Box;relative:number}|undefined;
    if(room.lastPlay&&room.lastPlaySeat!==null&&vm.played.length)play=this.drawPlayed(room,vm,spots,topTextRight,handTop);
    else if(!vm.tribute&&!vm.mine)this.centeredText('等待首出',480,140,22,C.muted,240);
    if(vm.tribute)this.centeredText('贡还贡 · 按提示选择牌',480,104,17,C.gold,300);
    this.drawHand(hand);
    this.drawTurnClock(room,spots,topTextRight,handTop,play);
    this.drawTools(room,vm,online);
    this.drawTurnButtons(room,vm,online,spots,play);
    if(vm.ended){
      const settlement=room.settlement,winnerFailed=settlement?.ace?.some(item=>item.team===settlement.winner);
      this.hits=[];this.paint.scrim();this.paint.paperPanel(215,102,530,364);this.paper=true;
      this.text((settlement?.winner??'')+(winnerFailed?' 队头游 · 末游同队，闯关失败':' 队获胜 · 升 '+settlement?.upgrade+' 级'),245,139,winnerFailed?24:28,C.ink);
      vm.ranking.forEach((entry,index)=>this.text(entry.place+'   '+entry.name.slice(0,12)+'   '+entry.team+' 队',250,184+index*32,18));
      const ace=(settlement?.ace??[]).map(item=>item.reset?`${item.team} 队闯关失败 3 次，退回打 2`:`${item.team} 队闯关失败第 ${item.count} 次`).join('；');
      if(ace)this.paint.text(ace,250,384,15,C.red,500,'sans-serif',470);
      this.button(room.status==='finished'?'整场结束':`下一局 · 打 ${settlement?.toLevel??room.currentLevel}`,245,408,220,()=>this.act({type:'next'}),online&&vm.host&&room.status==='settlement',true);
      this.button('返回大厅',487,408,220,()=>this.leave());
    }
  }
  /**
   * Opponents' plays hug their avatar (the top seat's sits right of its name); the viewer's own play is centred.
   * A lower side seat's play rises just clear of tall arranged columns and is then labelled with the player's name.
   */
  private drawPlayed(room:RoomView,vm:ReturnType<typeof tableView>,spots:ReturnType<typeof seatSpots>,topTextRight:number,handTop:(x0:number,x1:number)=>number){
    const relative=(room.lastPlaySeat!-room.mySeat+6)%6,cards=vm.played,combination=room.lastPlay!,own=relative===0;
    const w=own?42:48,h=own?63:64,gap=own?24:46,rows=!own&&cards.length>6?2:1,perRow=Math.ceil(cards.length/rows);
    const width=w+(perRow-1)*gap,height=h+(rows-1)*22,spot=spots[relative],right=relative===1||relative===2;
    const label=combination.type==='single'?'':patternName(combination.type,combination.size,combination.label),tagWidth=label?this.paint.tagWidth(label)+4:0;
    let x:number,y:number,lifted=false;
    if(own){x=480-width/2;y=110;}
    else if(relative===3){x=topTextRight+12;y=36;}
    else{
      x=right?spot.cx-36-width:spot.cx+36;y=spot.y-4;
      const clear=handTop(right?x-tagWidth:x,right?x+width:x+width+tagWidth)-height-6;
      if(clear<y){y=Math.max(110,clear);lifted=true;}
    }
    for(let row=0;row<rows;row++)cards.slice(row*perRow,(row+1)*perRow).forEach((card,i)=>this.card(card,x+i*gap,y+row*22,w,h));
    // Other players' cards carry the suit bottom-left, so the pattern tag sits beside the row, away from the avatar.
    if(label)right?this.paint.tag(label,x-4,y+height):this.paint.tag(label,x+width+4,y+height,'left');
    if(lifted)this.centeredText(room.players.find(player=>player.seat===room.lastPlaySeat)?.nickname??'',x+width/2,y-9,12,C.muted,width);
    return {box:{x:right?x-tagWidth:x,y,w:width+tagWidth,h:height},relative};
  }
  /**
   * Public tribute: the card each player received sits at the avatar corner away from their plays
   * (the viewer's beside their name); a player who resisted gets a round 抗 badge there instead.
   */
  private drawExchange(room:RoomView,spots:ReturnType<typeof seatSpots>,ownTextRight:number){
    const received=new Map<number,RoomView['hand'][number]>();
    for(const item of room.tribute){if(item.given&&item.card)received.set(item.to,item.card);if(item.returned&&item.returnCard)received.set(item.from,item.returnCard);}
    const resisted=room.tributeResisted?room.resistedSeats??[]:[];
    for(let relative=0;relative<6;relative++){
      const seat=(room.mySeat-1+relative)%6+1,card=received.get(seat);if(!card&&!resisted.includes(seat))continue;
      const spot=spots[relative],right=relative===1||relative===2;
      const x=relative===0?ownTextRight+10:right?spot.cx+spot.size/2-14:spot.cx-spot.size/2-16,y=relative===0?spot.y+2:spot.y+spot.size-40;
      if(card)this.paint.miniCard(cardView(card,room.currentLevel),x,y);else this.paint.resistMark(x+15,y+20);
    }
  }
  /** Another player's turn shows a small countdown clock where their cards will land; it goes once they act. */
  private drawTurnClock(room:RoomView,spots:ReturnType<typeof seatSpots>,topTextRight:number,handTop:(x0:number,x1:number)=>number,play?:{box:Box;relative:number}){
    if(room.status!=='playing'||room.deadline===null||room.currentTurnSeat===room.mySeat)return;
    const relative=(room.currentTurnSeat-room.mySeat+6)%6,spot=spots[relative],size=40;
    const x=relative===3?topTextRight+12:relative===1||relative===2?spot.cx-36-size:spot.cx+36;
    let y=relative===3?36+(64-size)/2:spot.y+(spot.size-size)/2;
    // Lower side seats keep the clock clear of tall arranged columns, and below an upper seat's play.
    if(relative===1||relative===5)y=Math.min(y,Math.max(play?play.box.y+play.box.h+4:128,handTop(x,x+size)-size-6));
    const seconds=Math.max(0,Math.ceil((room.deadline-Date.now())/1000));
    this.paint.alarmClock(x+size/2,y+size/2,size,String(seconds),seconds<=5);
  }
  /** 提示 / 不出 / 出牌 and the countdown clock appear only when the viewer has to act, clear of the last play. */
  private drawTurnButtons(room:RoomView,vm:ReturnType<typeof tableView>,online:boolean,spots:ReturnType<typeof seatSpots>,play?:{box:Box;relative:number}){
    const tribute=room.status==='tribute',donation=room.tribute.some(item=>item.from===room.mySeat&&!item.given);
    const repayment=room.tribute.some(item=>item.to===room.mySeat&&item.given&&!item.returned);
    if(tribute?!donation&&!repayment:!vm.mine||vm.me.autoPlay)return;
    const green:[string,string]=['#62bd88','#2c744a'],h=64,gap=8,clock=64;
    const buttons:[string,number,[string,string],boolean,()=>void][]=tribute
      ?[[vm.tributeLabel,152,green,online&&vm.canTribute,()=>this.act(donation?{type:'tribute'}:{type:'tribute',cardId:this.selected[0]})]]
      :[['提示',140,['#5fabcc','#2b6581'],online,()=>this.hint()],['不出',140,['#cf8a63','#7f462e'],online&&vm.canPass,()=>this.act({type:'pass'})],
        ['出牌',152,green,online&&vm.canPlay,()=>this.act({type:'play',cardIds:[...this.selected]})]];
    const seconds=room.deadline===null?null:Math.max(0,Math.ceil((room.deadline-Date.now())/1000));
    const total=buttons.reduce((sum,button)=>sum+button[1]+gap,0)+(seconds===null?-gap:clock);
    let x=480-total/2,y=108;
    const box=play?.box;
    if(this.turnPos)({x,y}=this.clampTurn(this.turnPos,total));
    else if(box&&box.y<y+h&&box.y+box.h>y){
      if(play!.relative===3)y=box.y+box.h+6;
      else if(box.x+box.w/2<WIDTH/2)x=Math.max(x,box.x+box.w+10);
      else x=Math.min(x,box.x-10-total);
    }
    // Stay between the side seats so a seat name is never hidden behind the buttons.
    if(!this.turnPos)x=Math.max(spots[4].cx+SIDE_SEAT_HALF+8,Math.min(spots[2].cx-SIDE_SEAT_HALF-8-total,x));
    // Every part of the row can start a drag; a tap acts on release.
    const row={x,y,width:total};
    for(const [label,w,colors,enabled,run] of buttons){
      this.paint.actionButton(label,x,y,w,h,colors,enabled);this.hits.push({x,y,w,h,run:enabled?run:()=>{},row});x+=w+gap;
    }
    if(seconds!==null){this.paint.alarmClock(x+clock/2,y+h/2,clock,String(seconds),seconds<=5);this.hits.push({x,y,w:clock,h,run:()=>{},row});}
  }
  /** Hand tools live in the bottom-right strip below the hand, beside the viewer's identity chip. */
  private drawTools(room:RoomView,vm:ReturnType<typeof tableView>,online:boolean){
    const y=505,h=30;
    this.paint.text(vm.selectionText,206,y+h/2,12,this.selected.length?C.gold:C.muted,400,'sans-serif',CARD_COUNTER_ENABLED?186:250);
    if(CARD_COUNTER_ENABLED)this.button('记牌',400,y,58,()=>this.panel('记牌器 · 公开信息',vm.counter.map(item=>item.label+'：'+item.count).reduce<string[]>((rows,label,index)=>{if(index%5===0)rows.push(label);else rows[rows.length-1]+='      '+label;return rows;},[])),room.rules.allowCounter,false,h,12);
    this.button('一键理牌',466,y,84,()=>{this.groups=arrangeHand(room.hand,room.currentLevel,room.rules);this.selected=[];this.draw();},room.hand.length>0,true,h,13);
    this.button('组合',556,y,56,()=>{try{this.groups=manualGroup(this.groups??[],room.hand,this.selected,room.currentLevel,room.rules);this.selected=[];this.draw();}catch(error){this.error(error);}},this.selected.length>0,false,h,13);
    this.button('还原',618,y,56,()=>{this.groups=null;this.selected=[];this.draw();},room.hand.length>0,false,h,13);
    this.button(vm.tribute?'交换进度':vm.me.autoPlay?'取消托管':'托管',680,y,78,()=>vm.tribute?this.panel('贡还贡',vm.exchanges.map(exchange=>exchange.fromName+' → '+exchange.toName+'：'+exchange.label)):this.act({type:'auto',enabled:!vm.me.autoPlay}),vm.tribute||online&&room.rules.allowAutoPlay,false,h,12);
    const straightFlushes=new Map<string,{rank:number;ids:string[]}>();
    for(const play of findHints(room.hand,null,room.currentLevel,room.rules).filter(item=>item.type==='straightFlush')){
      const naturals=play.cards.filter(card=>!(card.suit==='heart'&&card.rank===room.currentLevel)),suit=naturals[0]?.suit;
      if(!suit||suit==='joker'||naturals.some(card=>card.suit!==suit))continue;
      const previous=straightFlushes.get(suit);if(!previous||play.rank>previous.rank)straightFlushes.set(suit,{rank:play.rank,ids:play.cards.map(card=>card.id)});
    }
    this.centeredText('同花顺',783,y+h/2,11,C.muted,40);
    ([
      ['spade','♠'],['heart','♥'],['club','♣'],['diamond','♦']
    ] as const).forEach(([suit,symbol],index)=>{
      const x=804+index*36,available=straightFlushes.has(suit),red=suit==='heart'||suit==='diamond';
      this.paint.rect(x,y,32,h,available?'#ead9b2':C.disabled,7,available?(red?C.red:C.ink):C.line);
      this.paint.suit(symbol,x+8,y+7,16,available?(red?C.red:C.ink):C.disabledText);
      // Selecting a straight flush keeps the current arrangement.
      if(available)this.hits.push({x,y,w:32,h,run:()=>{this.selected=[...straightFlushes.get(suit)!.ids];this.draw();}});
    });
  }
  /**
   * The hand is centred above the tool strip; arranged groups stack upward with bombs strongest-first on the left,
   * with tall end columns kept clear of the lower side seats.
   */
  private handItems(room:RoomView,vm:ReturnType<typeof tableView>,spots:ReturnType<typeof seatSpots>):HandItems{
    const cards:HandItems['cards']=[],tags:HandItems['tags']=[];
    if(!this.groups){
      const views=vm.rows.flatMap(row=>row.cards),layout=handLayout(views.length);
      views.forEach((view,index)=>cards.push({view,id:view.id,x:layout.left+index*layout.step,y:layout.top-(view.selected?18:0),w:layout.width,h:layout.height,index:'column',strip:index<views.length-1?layout.step:layout.width}));
      return {cards,tags};
    }
    const cardsById=new Map(room.hand.map(card=>[card.id,card])),blocks:{ids:string[];tag:string|null;single:boolean}[]=[],singles:string[]=[];
    for(const group of displayGroups(this.groups,room.rules)){
      const ids=group.ids.filter(id=>cardsById.has(id));
      if(ids.length===1)singles.push(ids[0]);else if(ids.length)blocks.push({ids,tag:ids.length===group.ids.length?groupTag(group):null,single:false});
    }
    if(singles.length)blocks.push({ids:singles,tag:null,single:true});
    const seat=spots[5],side={x:seat.cx+SIDE_SEAT_HALF+8,y:seat.y+seat.size+SIDE_SEAT_TEXT};
    const layout=stackLayout(blocks.map(block=>({count:block.ids.length,single:block.single,ranks:block.ids.map(id=>cardsById.get(id)!.rank)})),side);
    blocks.forEach((block,b)=>{
      block.ids.forEach((id,i)=>{
        const view=cardView(cardsById.get(id)!,room.currentLevel,this.selected);
        const next=block.single?layout.cards[b][i+1]:undefined;
        cards.push({view,id,x:layout.cards[b][i].x,y:layout.cards[b][i].y-(view.selected?15:0),w:STACK.width,h:STACK.height,index:block.single?'column':'row',strip:next?next.x-layout.cards[b][i].x:STACK.width});
      });
      const tag=layout.tags[b];
      if(block.tag&&tag)tags.push({label:block.tag,right:tag.right,bottom:tag.bottom-(this.selected.includes(block.ids[block.ids.length-1])?15:0)});
    });
    return {cards,tags};
  }
  private drawHand(hand:HandItems){
    for(const card of hand.cards){this.card(card.view,card.x,card.y,card.w,card.h,card.index,1.3,card.strip);this.hits.push({x:card.x,y:card.y,w:card.w,h:card.h,card:card.id,run:()=>{}});}
    for(const tag of hand.tags)this.paint.tag(tag.label,tag.right,tag.bottom);
  }
  private card(c:CardFace,x:number,y:number,w:number,h:number,index?:'row'|'column',scale=1,strip=Infinity){
    this.paint.card(c,x,y,w,h,index,scale,strip);
  }
  private drawPanel(){const p=this.overlay!;this.hits=[];this.paint.scrim();this.paint.paperPanel(105,64,750,430);this.paper=true;this.text(p.title,132,99,27,C.ink);
    const lines:string[]=[];for(const line of p.lines){let part='';for(const ch of line){this.ctx.font='18px sans-serif';if(this.ctx.measureText(part+ch).width>685){lines.push(part);part=ch;}else part+=ch;}lines.push(part);}
    const pages=Math.max(1,Math.ceil(lines.length/8));p.page=Math.min(p.page,pages-1);lines.slice(p.page*8,p.page*8+8).forEach((line,i)=>this.text(line,132,147+i*32,18));
    this.button('上一页',132,434,110,()=>{p.page--;this.draw();},p.page>0);this.text(`${p.page+1} / ${pages}`,270,454,18,C.paperMuted);
    this.button('下一页',370,434,110,()=>{p.page++;this.draw();},p.page<pages-1);this.button('关闭',707,434,120,()=>{this.overlay=undefined;this.draw();});}
}
