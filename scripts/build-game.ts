import { build } from 'esbuild';
await build({entryPoints:['game-src/main.ts'], outfile:'minigame/game.js', bundle:true,
  platform:'neutral', format:'iife', target:'es2020', minify:true, legalComments:'none'});
console.log('小游戏 Canvas 客户端已构建：minigame/game.js');
