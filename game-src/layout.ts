export const WIDTH = 960;
export const HEIGHT = 540;
/** Waiting rooms use the space occupied by hands and play controls during a game. */
export const WAITING_SEATS = [
  {x:302,y:398,w:356,h:70},
  {x:718,y:316,w:218,h:94},
  {x:718,y:176,w:218,h:94},
  {x:371,y:100,w:218,h:94},
  {x:24,y:176,w:218,h:94},
  {x:24,y:316,w:218,h:94},
] as const;
export function handLayout(count:number){
  const width=90,height=108,step=count>1?Math.min(48,(912-width)/(count-1)):0;
  return {width,height,step,left:(WIDTH-width-Math.max(0,count-1)*step)/2,top:376};
}
export type Hit = {x:number;y:number;w:number;h:number;run:()=>void;card?:string};
export function viewport(width:number,height:number,safe?:{left:number;top:number;right:number;bottom:number}) {
  const left=safe?.left??0,top=safe?.top??0;
  const scale=Math.min(((safe?.right??width)-left)/WIDTH,((safe?.bottom??height)-top)/HEIGHT);
  return {scale,x:left+(((safe?.right??width)-left)-WIDTH*scale)/2,y:top+(((safe?.bottom??height)-top)-HEIGHT*scale)/2};
}
/** Extra room for the lobby columns, without stretching text or card faces. */
export function lobbySpread(width:number,height:number,safe?:{left:number;top:number;right:number;bottom:number}) {
  const view=viewport(width,height,safe);
  const available=(safe?.right??width)-(safe?.left??0);
  return Math.min(100,Math.max(0,(available/view.scale-WIDTH)/2))*.65;
}
export function hitAt(hits:Hit[],x:number,y:number) {
  return [...hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h);
}
