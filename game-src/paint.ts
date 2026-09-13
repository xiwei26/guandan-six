/** Shared Canvas styling. All geometry uses the 960 × 540 logical viewport. */
export const COLORS = {
  bg:'#0b302b', felt:'#164c40', panel:'#19473e', line:'#386154',
  text:'#f7f1e2', muted:'#a6bfb0', gold:'#e7c789', blue:'#9ccce3', orange:'#edb78f',
  paper:'#f8f3e7', ink:'#183c32', soft:'#eae6d9', paperMuted:'#677a6a', red:'#b74a40',
};

export class Painter {
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

  rect(x:number,y:number,w:number,h:number,fill:string,radius=10,stroke?:string) {
    const c=this.ctx,r=Math.min(radius,w/2,h/2);c.save();c.beginPath();
    c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);
    c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);
    c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();
    c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}c.restore();
  }

  line(x:number,y:number,x2:number,y2:number,color:string=COLORS.line) {
    const c=this.ctx;c.save();c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=1;c.stroke();c.restore();
  }

  ellipse(x:number,y:number,rx:number,ry:number,fill:string,stroke?:string) {
    const c=this.ctx;c.save();c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=fill;c.fill();
    if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}c.restore();
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

  backdrop() {
    const c=this.ctx;c.save();
    const wash=c.createLinearGradient(0,0,960,540);wash.addColorStop(0,'#17493d');wash.addColorStop(.55,'#103a32');wash.addColorStop(1,COLORS.bg);
    c.fillStyle=wash;c.fillRect(0,0,960,540);c.restore();
    this.rect(12,12,936,516,'transparent',20,'#ffffff0b');
  }

  scrim() {const c=this.ctx;c.save();c.fillStyle='#041c18b8';c.fillRect(0,0,960,540);c.restore();}

  paperPanel(x:number,y:number,w:number,h:number) {
    const c=this.ctx;c.save();c.shadowColor='#00181055';c.shadowBlur=30;c.shadowOffsetY=10;
    this.rect(x,y,w,h,COLORS.paper,18);c.restore();
    this.rect(x+7,y+7,w-14,h-14,'transparent',12,'#d5d9c866');
  }

  table() {
    this.ellipse(480,205,302,117,'#082b25');
    this.ellipse(480,200,300,116,'#486954');
    this.ellipse(480,198,294,110,COLORS.felt,'#7b8960');
    this.ellipse(480,198,279,96,'transparent','#70907455');
    this.text('六 人 掼 蛋',422,263,16,'#66907b',400,'serif');
  }

  card(c:{label:string;symbol:string;red:boolean;wild:boolean;selected?:boolean},x:number,y:number,w:number,h:number) {
    const ink=c.red?COLORS.red:COLORS.ink,large=h>80,ctx=this.ctx;
    ctx.save();ctx.shadowColor='#001e2440';ctx.shadowBlur=4;ctx.shadowOffsetY=2;
    this.rect(x,y,w,h,c.selected?'#ffedbf':'#fffcf4',6,c.selected?COLORS.gold:'#c5c9bb');ctx.restore();
    if(c.selected)this.rect(x+2,y+2,w-4,h-4,'transparent',4,'#c49a4f');
    if(c.label==='大'||c.label==='小') {
      const step=Math.min(16,(h-12)/5);
      [...'JOKER'].forEach((letter,i)=>this.text(letter,x+5,y+11+i*step,Math.min(19,step+2),ink,600,'Georgia, serif'));
      if(large)this.suit('✦',x+w-45,y+h-50,34,ink);
    } else {
      this.text(c.label,x+5,y+(large?19:14),large?(c.label==='10'?23:28):20,ink,600,'Georgia, serif');
      this.suit(c.symbol,x+5,y+(large?33:26),large?20:15,ink);
      if(large)this.suit(c.symbol,x+w-44,y+h-51,34,ink);
    }
    if(c.wild){this.rect(x+3,y+h-29,20,18,'#ead19b',4);this.text('配',x+7,y+h-20,11,'#725320',600);}
  }

  lobbyArt() {
    this.ellipse(270,317,184,87,'#0c302966','#72947d33');
    this.ellipse(270,317,164,72,'transparent','#72947d22');
    const ctx=this.ctx;
    for(const [index,angle] of [-.25,0,.25].entries()) {
      ctx.save();ctx.translate(197+index*64,300-Math.abs(index-1)*4);ctx.rotate(angle);
      if(index===1) {
        ctx.shadowColor='#00190f50';ctx.shadowBlur=16;ctx.shadowOffsetY=8;
        this.rect(-52,-74,104,148,COLORS.paper,9);ctx.shadowColor='transparent';
        this.rect(-47,-69,94,138,'#245344',6);this.rect(-40,-62,80,124,'transparent',3,'#acb58a');
        this.rect(-35,-57,70,114,'transparent',2,'#82986b');
        this.suit('♣',-22,-30,44,'#d4d5ac');this.text('六人掼蛋',-28,33,14,'#e4dfbb',500,'serif');
      } else this.card({label:'A',symbol:index?'♠':'♥',red:!index,wild:false},-52,-74,104,148);
      ctx.restore();
    }
  }
}
