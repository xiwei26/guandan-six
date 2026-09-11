export const WIDTH = 960;
export const HEIGHT = 540;
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
export function hitAt(hits:Hit[],x:number,y:number) {
  return [...hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h);
}
