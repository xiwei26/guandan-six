import { ApiError,client,errorMessage } from '../../services/client';
import type { RuleConfig } from '../../shared/types';
Page({
  data:{nickname:'',loggedIn:false,provider:'游客',resumeId:'',invited:false,code:'',modal:'',busy:false,error:'',
    roundOptions:['打到 A（需打过 A）','1 局','2 局','4 局','8 局'],roundIndex:0,timeOptions:['15 秒','30 秒','60 秒','不限时'],timeIndex:1,
    showRemaining:true,allowAutoPlay:true,allowCounter:true,resistance:true},
  onLoad(query:Record<string,string|undefined>) { if(query.room&&/^\d{6}$/.test(query.room))this.setData({code:query.room,invited:true}); },
  onShow() { this.refreshSession();if(this.data.invited&&this.data.loggedIn)this.setData({modal:'join'}); },
  refreshSession() { const s=client().session();this.setData({loggedIn:!!s,nickname:s?.nickname||this.data.nickname,provider:s?.provider==='wechat'?'微信牌友':'游客',resumeId:client().roomId()}); },
  inputNickname(event:WechatMiniprogram.Input) {this.setData({nickname:event.detail.value});},
  inputCode(event:WechatMiniprogram.Input) {this.setData({code:event.detail.value.replace(/\D/g,'').slice(0,6)});},
  async login(event:WechatMiniprogram.TouchEvent) {
    if(this.data.busy)return;this.setData({busy:true,error:''});
    try{await client().login(event.currentTarget.dataset.kind==='wechat'?'wechat':'guest',this.data.nickname);this.refreshSession();if(this.data.invited)this.setData({modal:'join'});}
    catch(e){this.setData({error:errorMessage(e)});}finally{this.setData({busy:false});}
  },
  openCreate(){this.setData({modal:'create',error:''});},openJoin(){this.setData({modal:'join',error:''});},
  closeModal(){if(!this.data.busy)this.setData({modal:'',invited:false,error:''});},
  stopTap(){},
  roundChange(event:WechatMiniprogram.PickerChange){this.setData({roundIndex:Number(event.detail.value)});},
  timeChange(event:WechatMiniprogram.PickerChange){this.setData({timeIndex:Number(event.detail.value)});},
  switchRule(event:WechatMiniprogram.SwitchChange) {
    const key=event.currentTarget.dataset.key;
    if(['showRemaining','allowAutoPlay','allowCounter','resistance'].includes(key))this.setData({[key]:event.detail.value});
  },
  async enter(event:WechatMiniprogram.TouchEvent) {
    if(this.data.busy)return;
    const mode=event.currentTarget.dataset.mode as 'create'|'join'|'demo';
    if(!['create','join','demo'].includes(mode))return;
    if(mode==='join'&&!/^\d{6}$/.test(this.data.code)){this.setData({error:'请输入六位房间号'});return;}
    this.setData({busy:true,error:''});
    try{
      const rounds:RuleConfig['rounds'][]=['A',1,2,4,8],seconds:RuleConfig['turnSeconds'][]=[15,30,60,0];
      const {showRemaining,allowAutoPlay,allowCounter,resistance}=this.data;
      const room=await client().enter(mode,mode==='join'?this.data.code:{rounds:rounds[this.data.roundIndex],turnSeconds:seconds[this.data.timeIndex],showRemaining,allowAutoPlay,allowCounter,resistance});
      this.setData({modal:'',invited:false});await this.openRoom(room.roomId);
    }catch(e){this.setData({error:errorMessage(e)});this.refreshSession();}finally{this.setData({busy:false});}
  },
  async resume() {
    if(this.data.busy)return;this.setData({busy:true,error:''});
    try{const room=await client().room(this.data.resumeId);await this.openRoom(room.roomId);}
    catch(e){if(e instanceof ApiError&&[403,404].includes(e.status))client().remember('');this.setData({error:errorMessage(e)});this.refreshSession();}
    finally{this.setData({busy:false});}
  },
  openRoom(id:string):Promise<void> { return new Promise((resolve,reject)=>wx.navigateTo({url:`/pages/room/index?id=${id}`,success:()=>resolve(),fail:()=>reject(new Error('无法打开牌桌，请点击返回房间重试'))})); },
  navigate(event:WechatMiniprogram.TouchEvent) {const page=event.currentTarget.dataset.page;if(['rules','history','settings'].includes(page))wx.navigateTo({url:`/pages/${page}/index`});},
  onShareAppMessage() {return {title:'六人掼蛋 · 三人一队，六人开掼',path:'/pages/home/index'};}
});
