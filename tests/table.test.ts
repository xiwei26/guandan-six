import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Table} from '../src/components/Table';
import {createRoom,addPlayer,applyAction,getRoomView} from '../server/game';

for(const mode of ['friends','computer'] as const) {
  test(`${mode} web lobby exposes host seating tools and preserves readiness and connection guards`,()=>{
    const state=createRoom('123456','p1','房主',{},mode);addPlayer(state,'p2','好友');
    const render=(userId='p1',connection='online',busy=false)=>renderToStaticMarkup(createElement(Table,{
      room:getRoomView(state,userId),session:{userId,token:'test',nickname:userId,provider:'guest'},
      connection,busy,action:async()=>{},report:()=>{},
    }));
    const button=(html:string,label:string)=>{
      const match=html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button=>button.includes(label));
      assert.ok(match,`missing button: ${label}`);return match;
    };
    for(const label of ['随机组队','调整座位']) {
      assert.doesNotMatch(button(render(),label),/disabled/);
      assert.match(button(render('p1','offline'),label),/disabled/);
      assert.match(button(render('p1','online',true),label),/disabled/);
      assert.ok(!render('p2').includes(label),'only the host may adjust teams');
    }
    applyAction(state,'p2',{type:'ready',ready:true});
    assert.match(button(render(),'随机组队'),/disabled/);
    applyAction(state,'p2',{type:'ready',ready:false});
    assert.doesNotMatch(button(render(),'随机组队'),/disabled/);
  });
}
