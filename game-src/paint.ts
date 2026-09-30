/** Shared Canvas styling. All geometry uses the 960 × 540 logical viewport. */
export const COLORS = {
  bg:'#0b302b', felt:'#164c40', panel:'#19473e', line:'#386154',
  text:'#f7f1e2', muted:'#a6bfb0', gold:'#e7c789', blue:'#55b7d1', orange:'#ee8958',
  paper:'#f8f3e7', ink:'#183c32', soft:'#eae6d9', paperMuted:'#677a6a', red:'#b74a40',
  feltCenter:'#1b5a4b', feltEdge:'#08251f', sheen:'150,222,190', disabled:'#203e38', disabledText:'#80968b', scrim:'#041c18b8',
};
type Palette = Pick<typeof COLORS,'bg'|'felt'|'panel'|'line'|'muted'|'feltCenter'|'feltEdge'|'sheen'|'disabled'|'disabledText'|'scrim'>;
export type ThemeName = 'green'|'blue'|'navy';
export const THEMES: Record<ThemeName,{label:string}&Palette> = {
  green:{label:'松绿',bg:'#0b302b',felt:'#164c40',panel:'#19473e',line:'#386154',muted:'#a6bfb0',feltCenter:'#1b5a4b',feltEdge:'#08251f',sheen:'150,222,190',
    disabled:'#203e38',disabledText:'#80968b',scrim:'#041c18b8'},
  blue:{label:'深蓝',bg:'#0a1f3b',felt:'#17457a',panel:'#173d68',line:'#35608f',muted:'#a8bdd8',feltCenter:'#1e538f',feltEdge:'#071731',sheen:'140,196,255',
    disabled:'#18335a',disabledText:'#7d95b6',scrim:'#030c1cb8'},
  navy:{label:'藏青',bg:'#111a30',felt:'#243357',panel:'#223157',line:'#44567f',muted:'#afb9d0',feltCenter:'#2c3d66',feltEdge:'#0b1224',sheen:'182,196,240',
    disabled:'#1d2946',disabledText:'#828fad',scrim:'#060a17b8'},
};
export function applyTheme(name:ThemeName) {Object.assign(COLORS,THEMES[name]);}
export type CardFace = {label:string;symbol:string;red:boolean;wild:boolean;selected?:boolean};

export class Painter {
  private bounds={x:0,y:0,w:960,h:540};
  constructor(private ctx:CanvasRenderingContext2D) {}

  text(value:string,x:number,y:number,size=18,color:string=COLORS.text,weight=400,family='sans-serif',maxWidth?:number) {
    const c=this.ctx;c.save();c.fillStyle=color;c.textBaseline='middle';c.textAlign='left';
    c.font=`${weight} ${size}px ${family}`;
    let label=value;
    if(maxWidth!==undefined&&c.measureText(label).width>maxWidth) {
      while(label.length&&c.measureText(label+'…').width>maxWidth)label=label.slice(0,-1);
      label+='…';
    }
    c.fillText(label,x,y);c.restore();
  }

  private roundPath(x:number,y:number,w:number,h:number,radius:number) {
    const c=this.ctx,r=Math.min(radius,w/2,h/2);c.beginPath();
    c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);
    c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);
    c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();
  }

  rect(x:number,y:number,w:number,h:number,fill:string,radius=10,stroke?:string) {
    const c=this.ctx;c.save();this.roundPath(x,y,w,h,radius);
    c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}c.restore();
  }

  /** Turn action button with a soft white halo and a white gradient rim. `colors` runs top to bottom. */
  actionButton(label:string,x:number,y:number,w:number,h:number,colors:[string,string],enabled:boolean) {
    const c=this.ctx,radius=h*.3;c.save();
    if(enabled){c.shadowColor='rgba(255,255,255,.55)';c.shadowBlur=16;}
    const fill=c.createLinearGradient(x,y,x,y+h);
    fill.addColorStop(0,enabled?colors[0]:'#6d777c');fill.addColorStop(1,enabled?colors[1]:'#434c51');
    this.roundPath(x,y,w,h,radius);c.fillStyle=fill;c.fill();c.restore();
    c.save();const rim=c.createLinearGradient(x,y,x,y+h);
    rim.addColorStop(0,`rgba(255,255,255,${enabled?.95:.45})`);rim.addColorStop(.55,'rgba(255,255,255,.18)');rim.addColorStop(1,`rgba(255,255,255,${enabled?.7:.3})`);
    this.roundPath(x+1,y+1,w-2,h-2,radius-1);c.strokeStyle=rim;c.lineWidth=2;c.stroke();
    c.fillStyle=enabled?'#fffaf0':'#b9c0c3';c.font=`600 ${Math.round(h*.375)}px sans-serif`;c.textAlign='center';c.textBaseline='middle';
    if(enabled){c.shadowColor='rgba(0,0,0,.35)';c.shadowBlur=3;c.shadowOffsetY=1;}
    c.fillText(label,x+w/2,y+h/2+1);c.restore();
  }

  /** Alarm clock showing the turn countdown inside its face; turns red for the final seconds. */
  alarmClock(cx:number,cy:number,size:number,label:string,urgent:boolean) {
    const c=this.ctx,r=size*.36,ring=urgent?COLORS.red:'#e3ac3f';c.save();
    c.shadowColor='rgba(255,255,255,.45)';c.shadowBlur=12;
    c.fillStyle=ring;for(const side of [-1,1]){c.beginPath();c.arc(cx+side*r*.78,cy-r*.86,r*.4,Math.PI,Math.PI*2);c.closePath();c.fill();}
    c.strokeStyle=ring;c.lineWidth=size*.05;c.lineCap='round';
    for(const side of [-1,1]){c.beginPath();c.moveTo(cx+side*r*.55,cy+r*.8);c.lineTo(cx+side*r*.85,cy+r*1.18);c.stroke();}
    c.beginPath();c.arc(cx,cy,r,0,Math.PI*2);c.fillStyle='#fff8ea';c.fill();c.lineWidth=size*.07;c.stroke();c.restore();
    c.save();c.fillStyle=urgent?COLORS.red:COLORS.ink;c.font=`700 ${Math.round(size*.375)}px sans-serif`;c.textAlign='center';c.textBaseline='middle';
    c.fillText(label,cx,cy+1,r*1.7);c.restore();
  }

  line(x:number,y:number,x2:number,y2:number,color:string=COLORS.line) {
    const c=this.ctx;c.save();c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=1;c.stroke();c.restore();
  }

  ellipse(x:number,y:number,rx:number,ry:number,fill:string,stroke?:string) {
    const c=this.ctx;c.save();c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=fill;c.fill();
    if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}c.restore();
  }

  avatar(initial:string,cx:number,y:number,size:number,team:'A'|'B',image?:CanvasImageSource) {
    const c=this.ctx,ring=team==='A'?COLORS.blue:COLORS.orange;
    c.save();c.beginPath();c.arc(cx,y+size/2,size/2-2,0,Math.PI*2);c.closePath();c.clip();
    c.fillStyle=team==='A'?'#155267':'#75422d';c.fillRect(cx-size/2,y,size,size);
    if(image) {try{c.drawImage(image,cx-size/2,y,size,size);}catch{this.avatarInitial(initial,cx,y,size,ring);}}
    else this.avatarInitial(initial,cx,y,size,ring);
    c.restore();c.beginPath();c.arc(cx,y+size/2,size/2-1,0,Math.PI*2);c.strokeStyle=ring;c.lineWidth=3;c.stroke();
  }

  private avatarInitial(initial:string,cx:number,y:number,size:number,color:string) {
    const c=this.ctx;c.save();c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.font=`600 ${Math.round(size*.43)}px sans-serif`;c.fillText(initial||'牌',cx,y+size/2,size*.78);c.restore();
  }

  arrow(x:number,y:number,color:string=COLORS.ink) {
    this.line(x-10,y,x+4,y,color);this.line(x,y-4,x+4,y,color);this.line(x,y+4,x+4,y,color);
  }

  /** Draw suits as paths so WeChat/system font fallback cannot turn them into missing glyphs. */
  suit(symbol:string,x:number,y:number,size:number,color:string) {
    const c=this.ctx;c.save();c.translate(x,y);c.scale(size,size);c.fillStyle=color;c.beginPath();
    if(symbol==='♥') {
      c.moveTo(.5,.95);c.bezierCurveTo(.35,.78,.02,.55,.02,.29);
      c.bezierCurveTo(.02,-.01,.38,-.05,.5,.2);c.bezierCurveTo(.62,-.05,.98,-.01,.98,.29);
      c.bezierCurveTo(.98,.55,.65,.78,.5,.95);
    } else if(symbol==='♠') {
      c.moveTo(.5,0);c.bezierCurveTo(.35,.2,.02,.39,.02,.61);
      c.bezierCurveTo(.02,.91,.37,.96,.5,.67);c.bezierCurveTo(.63,.96,.98,.91,.98,.61);
      c.bezierCurveTo(.98,.39,.65,.2,.5,0);
    } else if(symbol==='♣') {
      c.arc(.5,.25,.24,0,Math.PI*2);c.moveTo(.49,.61);c.arc(.25,.61,.24,0,Math.PI*2);
      c.moveTo(.99,.61);c.arc(.75,.61,.24,0,Math.PI*2);
    } else if(symbol==='♦') {
      c.moveTo(.5,0);c.lineTo(.92,.5);c.lineTo(.5,1);c.lineTo(.08,.5);
    } else {
      c.moveTo(.5,0);c.lineTo(.63,.37);c.lineTo(1,.5);c.lineTo(.63,.63);
      c.lineTo(.5,1);c.lineTo(.37,.63);c.lineTo(0,.5);c.lineTo(.37,.37);
    }
    c.closePath();c.fill();
    if(symbol==='♠'||symbol==='♣') {c.beginPath();c.moveTo(.45,.62);c.lineTo(.55,.62);c.quadraticCurveTo(.55,.86,.7,1);c.lineTo(.3,1);c.quadraticCurveTo(.45,.86,.45,.62);c.closePath();c.fill();}
    c.restore();
  }

  /** Jester head for jokers: red and gold for the big joker, ink and silver for the small one. */
  jester(x:number,y:number,size:number,big:boolean) {
    const c=this.ctx,main=big?'#c8412f':'#26323b',accent=big?'#e3ac3f':'#9eabb3',face='#fff8ea',ink='#2b211c';
    c.save();c.translate(x,y);c.scale(size,size);c.lineJoin='round';c.beginPath();
    c.moveTo(.2,.52);c.bezierCurveTo(.16,.38,.1,.3,.04,.31);c.bezierCurveTo(.16,.17,.3,.22,.36,.36);
    c.bezierCurveTo(.36,.2,.42,.09,.5,.04);c.bezierCurveTo(.58,.09,.64,.2,.64,.36);
    c.bezierCurveTo(.7,.22,.84,.17,.96,.31);c.bezierCurveTo(.9,.3,.84,.38,.8,.52);c.closePath();
    c.fillStyle=main;c.fill();
    c.fillStyle=accent;for(const [bx,by] of [[.05,.31],[.5,.05],[.95,.31]]){c.beginPath();c.arc(bx,by,.06,0,Math.PI*2);c.fill();}
    c.beginPath();c.moveTo(.24,.88);
    for(let i=0;i<=8;i++)c.lineTo(.24+i*.065,i%2?.99:.87);
    c.closePath();c.fill();
    c.beginPath();c.arc(.5,.66,.22,0,Math.PI*2);c.fillStyle=face;c.fill();c.lineWidth=.035;c.strokeStyle=main;c.stroke();
    c.beginPath();c.moveTo(.27,.5);c.quadraticCurveTo(.5,.4,.73,.5);c.lineTo(.72,.55);c.quadraticCurveTo(.5,.47,.28,.55);c.closePath();c.fillStyle=accent;c.fill();
    c.fillStyle=ink;for(const ex of [.42,.58]){c.beginPath();c.arc(ex,.64,.028,0,Math.PI*2);c.fill();}
    c.beginPath();c.arc(.5,.71,.038,0,Math.PI*2);c.fillStyle='#d9543f';c.fill();
    c.beginPath();c.arc(.5,.7,.11,Math.PI*.18,Math.PI*.82);c.lineWidth=.03;c.strokeStyle=ink;c.stroke();
    c.restore();
  }

  /** Full-screen felt: lit center, darker edges and a soft sheen along every side. No center disc. */
  backdrop(x=0,y=0,w=960,h=540) {
    this.bounds={x,y,w,h};
    const c=this.ctx,cx=x+w/2,cy=y+h*.42;c.save();
    const felt=c.createRadialGradient(cx,cy,0,cx,cy,Math.hypot(w,h)*.62);
    felt.addColorStop(0,COLORS.feltCenter);felt.addColorStop(.5,COLORS.felt);felt.addColorStop(1,COLORS.feltEdge);
    c.fillStyle=felt;c.fillRect(x,y,w,h);
    const band=Math.min(w,h)*.2,glow=COLORS.sheen;
    for(const [x0,y0,x1,y1,alpha] of [[x,y,x,y+band,.2],[x,y+h,x,y+h-band,.14],[x,y,x+band,y,.16],[x+w,y,x+w-band,y,.16]] as const){
      const sheen=c.createLinearGradient(x0,y0,x1,y1);sheen.addColorStop(0,`rgba(${glow},${alpha})`);sheen.addColorStop(.35,`rgba(${glow},${alpha*.35})`);sheen.addColorStop(1,`rgba(${glow},0)`);
      c.fillStyle=sheen;c.fillRect(x,y,w,h);
    }
    c.restore();
    this.rect(x+5,y+5,w-10,h-10,'transparent',22,`rgba(${glow},.22)`);
  }

  scrim() {const c=this.ctx,b=this.bounds;c.save();c.fillStyle=COLORS.scrim;c.fillRect(b.x,b.y,b.w,b.h);c.restore();}

  paperPanel(x:number,y:number,w:number,h:number) {
    const c=this.ctx;c.save();c.shadowColor='#00181055';c.shadowBlur=30;c.shadowOffsetY=10;
    this.rect(x,y,w,h,COLORS.paper,18);c.restore();
    this.rect(x+7,y+7,w-14,h-14,'transparent',12,'#d5d9c866');
  }

  tagWidth(label:string) {const c=this.ctx;c.save();c.font='600 12px sans-serif';const w=c.measureText(label).width+10;c.restore();return w;}

  /**
   * Pattern name: half-transparent blue text in a matching frame, on a card-coloured pill so a suit underneath
   * cannot show through. `x` is the right edge by default, or the left edge with `align` 'left'.
   */
  tag(label:string,x:number,bottom:number,align:'left'|'right'='right') {
    const c=this.ctx,color='#1d5fd0',w=this.tagWidth(label),h=18,left=align==='left'?x:x-w,y=bottom-h;c.save();
    this.rect(left,y,w,h,'#fffcf4',5);
    c.globalAlpha=.5;this.rect(left,y,w,h,'transparent',5,color);this.text(label,left+5,y+h/2+.5,12,color,600);c.restore();
  }

  /** A small public card beside an avatar, used for tribute and return cards. */
  miniCard(c:CardFace,x:number,y:number) {
    const ink=c.red?COLORS.red:COLORS.ink,w=30,h=40,ctx=this.ctx;
    ctx.save();ctx.shadowColor='#001e2455';ctx.shadowBlur=5;ctx.shadowOffsetY=2;this.rect(x,y,w,h,'#fffcf4',5,'#c5c9bb');ctx.restore();
    if(c.label==='大'||c.label==='小'){this.jester(x+3,y+2,24,c.label==='大');ctx.save();ctx.fillStyle=ink;ctx.font='600 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(c.label+'王',x+w/2,y+h-7);ctx.restore();return;}
    ctx.save();ctx.fillStyle=ink;ctx.font='600 17px Georgia, serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(c.label,x+w/2,y+12,w-4);ctx.restore();
    this.suit(c.symbol,x+w/2-7,y+22,14,ink);
  }

  /** Round "抗" badge marking a player who resisted the tribute. */
  resistMark(cx:number,cy:number) {
    const c=this.ctx;c.save();c.beginPath();c.arc(cx,cy,14,0,Math.PI*2);c.fillStyle='#fff8ea';c.fill();c.lineWidth=2;c.strokeStyle=COLORS.red;c.stroke();
    c.fillStyle=COLORS.red;c.font='700 16px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('抗',cx,cy+1);c.restore();
  }

  /** Rank index; `fit` squeezes wide labels such as "10" into the visible strip of an overlapped card. */
  private rank(label:string,x:number,y:number,size:number,color:string,fit=Infinity) {
    const c=this.ctx;c.save();c.fillStyle=color;c.textBaseline='middle';c.textAlign='left';c.font=`600 ${size}px Georgia, serif`;
    const width=c.measureText(label).width;if(width>fit)c.fillText(label,x,y,fit);else c.fillText(label,x,y);c.restore();
    return Math.min(width,fit);
  }

  /**
   * `row` puts the rank top-left of vertically stacked cards (small suit beside it, large suit bottom-left);
   * other players' played cards also use `row`, with rank top-left and suit bottom-left.
   * `column` stacks rank and suit in the left strip of horizontally fanned cards.
   * `scale` enlarges the rank and bottom-left suit (the viewer's hand); `strip` is the visible width of a fanned card.
   */
  card(c:CardFace,x:number,y:number,w:number,h:number,index?:'row'|'column',scale=1,strip=Infinity) {
    const ink=c.red?COLORS.red:COLORS.ink,joker=c.label==='大'||c.label==='小',big=c.label==='大',ctx=this.ctx;
    const style=index??(w>=48&&w<=64&&h<=64?'row':'column');
    ctx.save();ctx.shadowColor='#001e2440';ctx.shadowBlur=4;ctx.shadowOffsetY=2;
    this.rect(x,y,w,h,c.selected?'#ffedbf':'#fffcf4',6,c.selected?COLORS.gold:'#c5c9bb');ctx.restore();
    if(c.selected)this.rect(x+2,y+2,w-4,h-4,'transparent',4,'#c49a4f');
    const badge=(bx:number,by:number,size:number)=>{this.rect(bx,by,size,size+1,'#ead19b',3);this.text('配',bx+size*.15,by+size*.55,size*.66,'#725320',600);};
    if(style==='row'&&h>80) {
      // Stacked hand card: only the top 46px strip shows unless it is the bottom card of its column.
      const rankSize=Math.round(25*scale),rankY=y+4+rankSize*.6,pip=Math.round(28*scale);
      if(joker) {
        this.text(c.label+'王',x+6,rankY,Math.round(16*scale),ink,600,'sans-serif');
        this.jester(x+w-30,y+3,26,big);const art=Math.round(31*scale);this.jester(x+4,y+h-art-1,art,big);
      } else {
        const rankWidth=this.rank(c.label,x+6,rankY,c.label==='10'?Math.round(22*scale):rankSize,ink);
        this.suit(c.symbol,x+9+rankWidth,rankY-9.5,19,ink);
        // Starts below the next card's edge in a stack; the pattern tag covers its right side if they meet.
        this.suit(c.symbol,x+6,y+h-4-pip,pip,ink);
      }
      if(c.wild)badge(x+w-20,y+3,16);
      return;
    }
    if(style==='row') {
      // Other players' played cards: rank top-left, suit bottom-left, both 1.6 × the earlier face.
      if(joker){this.text(c.label+'王',x+3,y+14,20,ink,600,'sans-serif');this.jester(x+3,y+h-33,30,big);}
      else {
        this.rank(c.label,x+4,y+20,c.label==='10'?22:27,ink,w-8);
        this.suit(c.symbol,x+4,y+h-26,22,ink);
      }
      if(c.wild)badge(x+w-16,y+3,13);
      return;
    }
    const wide=w>=100,mid=w>=70&&!wide,large=h>80;
    const baseRank=wide?28:mid?22:large?28:20,baseRankY=wide?21:mid?16:large?19:14,baseSuitY=wide?38:mid?29:large?33:26;
    const rankSize=Math.round(baseRank*scale),rankY=y+baseRankY*scale,suitSize=wide?22:mid?16:large?20:15,left=x+(wide?6:5);
    // The suit sits below the (possibly enlarged) rank.
    const suitY=y+baseSuitY+(baseRankY*scale-baseRankY)+(rankSize-baseRank)*.35;
    if(joker) {
      const icon=wide?26:mid?24:large?24:20,letter=Math.round((wide?19:mid?15:13)*scale),step=Math.round((wide?21:mid?16:14)*scale);
      this.jester(x+(wide?3:2),y+3,icon,big);
      [...(c.label+'王')].forEach((char,i)=>this.text(char,left+(wide?1:0),y+icon+(wide?16:12)*scale+i*step,letter,ink,600));
      if(large){const art=wide?Math.min(w*.56,80):mid?42:w*.5;this.jester(x+w-art-(wide?8:4),y+h-art-(wide?10:4),art,big);}
    } else {
      // Fanned cards overlap: squeeze wide labels such as "10" into the visible strip.
      const fit=Number.isFinite(strip)?strip-6:scale===1?(wide?24:mid?30:large?26:19):Infinity;
      this.rank(c.label,x+5,rankY,c.label==='10'?rankSize-Math.round(3*scale):rankSize,ink,fit);
      this.suit(c.symbol,left,suitY,suitSize,ink);
      if(large){const pip=wide?46:mid?30:34;this.suit(c.symbol,x+w-pip-(wide?12:8),y+h-pip-(wide?16:10),pip,ink);}
    }
    if(c.wild){const size=wide?22:mid?17:large?18:15;badge(x+3,y+h-size-(wide?12:8),size);}
  }

  lobbyArt() {
    this.ellipse(270,317,184,87,COLORS.bg+'66',COLORS.line+'55');
    this.ellipse(270,317,164,72,'transparent',COLORS.line+'38');
    const ctx=this.ctx;
    for(const [index,angle] of [-.25,0,.25].entries()) {
      ctx.save();ctx.translate(197+index*64,300-Math.abs(index-1)*4);ctx.rotate(angle);
      if(index===1) {
        ctx.shadowColor='#00190f50';ctx.shadowBlur=16;ctx.shadowOffsetY=8;
        this.rect(-52,-74,104,148,COLORS.paper,9);ctx.shadowColor='transparent';
        this.rect(-47,-69,94,138,COLORS.panel,6);this.rect(-40,-62,80,124,'transparent',3,'#c4b88a');
        this.rect(-35,-57,70,114,'transparent',2,'#988f6c');
        this.suit('♣',-22,-30,44,'#d8d0aa');this.text('六人掼蛋',-28,33,14,'#e4dfbb',500,'serif');
      } else this.card({label:'A',symbol:index?'♠':'♥',red:!index,wild:false},-52,-74,104,148);
      ctx.restore();
    }
  }
}
