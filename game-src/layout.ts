export const WIDTH = 960;
export const HEIGHT = 540;
/** Bottom edge of the hand; the own identity chip and hand tools sit below it. */
export const HAND_BOTTOM = 496;
/**
 * Arranged cards: 1.5 × the former 54 × 58 faces, stacks 40% further apart than a plain 1.5 × scale.
 * Groups of up to six cards stay in one column; larger groups split into two columns overlapping by 30%.
 */
export const STACK = {width:81,height:87,step:46,perColumn:6,pairOverlap:.3,groupGap:10,fan:36};
/** Top seat is centred under the "局" of the header round label. */
export const TOP_SEAT_CX = 332;
/** Extra logical width per side inside the safe area, beyond the 960-wide design. */
export function tableEdge(width:number,height:number,safe?:{left:number;top:number;right:number;bottom:number}) {
  const view=viewport(width,height,safe);
  return Math.max(0,(((safe?.right??width)-(safe?.left??0))/view.scale-WIDTH)/2);
}
/**
 * Seat anchors by position relative to the viewer. Side seats sit closer to the screen edge where the safe area
 * allows (on 16:9 they keep their name block on screen), and the lower pair sits lower. Avatars and seat text are
 * 1.3 × their earlier size. The top seat and the viewer's own chip put the name beside the avatar.
 */
export function seatSpots(edge=0){
  const shift=Math.min(42,18+edge);
  return [
    {cx:44,y:496,size:44,row:true},
    {cx:896+shift,y:192,size:55,row:false},
    {cx:896+shift,y:64,size:55,row:false},
    {cx:TOP_SEAT_CX,y:42,size:52,row:true},
    {cx:64-shift,y:64,size:55,row:false},
    {cx:64-shift,y:192,size:55,row:false},
  ] as const;
}
/** Half-width of a side seat block (avatar, name and status line). */
export const SIDE_SEAT_HALF = 42;
/** Height of a side seat block below the avatar top: avatar, name and status line. */
export const SIDE_SEAT_TEXT = 42;
/** Tap target for a seat, used for profile and seat swapping. */
export function seatBounds(relative:number,edge=0){
  const s=seatSpots(edge)[relative];
  return s.row?{x:s.cx-s.size/2-4,y:s.y-4,w:s.size+150,h:s.size+8}:{x:s.cx-SIDE_SEAT_HALF-6,y:s.y-4,w:SIDE_SEAT_HALF*2+12,h:s.size+SIDE_SEAT_TEXT};
}
export function handLayout(count:number){
  const width=135,height=162,step=count>1?Math.min(72,(912-width)/(count-1)):0;
  return {width,height,step,left:(WIDTH-width-Math.max(0,count-1)*step)/2,top:HAND_BOTTOM-height};
}
/**
 * Centered, bottom-aligned columns for arranged groups; singles fan horizontally. Wide hands first tighten the
 * gaps between groups and the singles fan, and only overlap neighbouring groups if that still does not fit.
 * An end column rising above `side.y` keeps inside `side.x` (mirrored on the right) to stay clear of the lower
 * side seats; the hand stays centred unless that forces extra squeezing.
 */
export function stackLayout(blocks:{count:number;single:boolean;ranks?:string[]}[],side={x:24,y:0}){
  const {width,height,step,perColumn}=STACK,columns:{block:number;cards:number[];fan:boolean}[]=[];
  blocks.forEach((block,index)=>{
    if(block.single){for(let card=0;card<block.count;card++)columns.push({block:index,cards:[card],fan:true});return;}
    const count=Math.ceil(block.count/perColumn),base=Math.floor(block.count/count),extra=block.count%count;
    const sizes=Array.from({length:count},(_,column)=>base+(column<extra?1:0)),same=(cut:number)=>!!block.ranks&&block.ranks[cut-1]===block.ranks[cut];
    // Move a break onto a rank boundary when one is a card away, so a run of one rank is not parted.
    for(let column=0,cut=0;column<count-1;column++){
      cut+=sizes[column];
      const shift=same(cut)?[1,-1].find(d=>!same(cut+d)&&sizes[column]+d>=1&&sizes[column]+d<=perColumn&&sizes[column+1]-d>=1&&sizes[column+1]-d<=perColumn):0;
      if(shift){sizes[column]+=shift;sizes[column+1]-=shift;cut+=shift;}
    }
    let next=0;
    for(const size of sizes){columns.push({block:index,cards:Array.from({length:size},(_,i)=>next+i),fan:false});next+=size;}
  });
  const inGroup=width*(1-STACK.pairOverlap);
  const gaps=columns.slice(1).map((column,i)=>columns[i].block!==column.block?{natural:width+STACK.groupGap,soft:width+2,hard:48}
    :column.fan?{natural:STACK.fan,soft:26,hard:22}:{natural:inGroup,soft:inGroup,hard:40});
  const tall=(column?:{cards:number[];fan:boolean})=>!!column&&HAND_BOTTOM-height-(column.cards.length-1)*step<side.y;
  const left=tall(columns[0])?Math.max(24,side.x):24,right=tall(columns[columns.length-1])?Math.min(WIDTH-24,WIDTH-side.x):WIDTH-24;
  const room=right-left-width,sum=(key:'natural'|'soft'|'hard')=>gaps.reduce((total,gap)=>total+gap[key],0);
  const natural=sum('natural'),soft=sum('soft'),hard=sum('hard');
  const advances=gaps.map(gap=>natural<=room?gap.natural
    :soft<=room?gap.soft+(gap.natural-gap.soft)*(room-soft)/(natural-soft)
    :(gap.hard+(gap.soft-gap.hard)*Math.max(0,(room-hard)/(soft-hard)))*(hard>room?room/hard:1));
  const total=width+advances.reduce((sum,advance)=>sum+advance,0);
  let x=Math.max(left,Math.min(right-total,(WIDTH-total)/2));
  const cards=blocks.map(block=>Array.from({length:block.count},()=>({x:0,y:0})));
  const tags=blocks.map(()=>null as null|{right:number;bottom:number});
  columns.forEach((column,i)=>{
    column.cards.forEach((card,j)=>{cards[column.block][card]={x,y:HAND_BOTTOM-height-(column.cards.length-1-j)*step};});
    if(!column.fan&&columns[i+1]?.block!==column.block)tags[column.block]={right:x+Math.min(width,advances[i]??width)-4,bottom:HAND_BOTTOM-4};
    x+=advances[i]??0;
  });
  return {cards,tags,width,height};
}
/** `row` marks a control that can also be dragged, moving the whole row from its current origin. */
export type Hit = {x:number;y:number;w:number;h:number;run:()=>void;card?:string;row?:{x:number;y:number;width:number}};
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
