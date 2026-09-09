import {client,errorMessage} from '../../services/client';
import type {StatsSummary,HistoryEntry} from '../../shared/types';
Page({data:{loading:false,error:'',stats:null as StatsSummary|null,history:[] as (HistoryEntry & {date:string;names:string;won:boolean})[]},_generation:0,
onShow(){void this.refresh();},onHide(){this._generation++;},onUnload(){this._generation++;},
async refresh(){const generation=++this._generation;this.setData({loading:true,error:''});try{const [{history},{stats}]=await Promise.all([client().history(),client().stats()]);if(generation!==this._generation)return;const uid=client().session()?.userId;this.setData({stats,history:history.map(h=>({...h,date:new Date(h.at).toLocaleString(),names:h.order.map((p,i)=>(i+1)+'. '+p.nickname).join(' / '),won:h.order.some(p=>p.userId===uid&&p.team===h.winner)}))});}catch(e){if(generation===this._generation)this.setData({error:errorMessage(e)});}finally{if(generation===this._generation)this.setData({loading:false});}},
home(){wx.reLaunch({url:'/pages/home/index'});}});
