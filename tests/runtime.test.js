import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUESTIONS } from '../data/questions.js';
import { gradeAnswer, ANSWER_WINDOW_MS } from '../lib/round-scoring.js';
import {
  BOOST_THRESHOLD, quizMultiplier, communityScore,
  createLikeTracker, LIKES_GOAL
} from '../lib/live-goals.js';

const source = readFileSync(new URL('../server2.js', import.meta.url), 'utf8');
function section(start,end) {
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a, 'Source section available: ' + start);
  return source.slice(a,b);
}

// Real production scoring and TikTok event handlers, with a fake socket and
// fake incoming events. Does NOT create any TikTok or Render connection.
function createSimulation() {
  const code = [
    "const players=new Map();",
    "const received=[];const emitted=[];const handlers=new Map();",
    "const io={emit(type,payload){emitted.push({type,payload})}};",
    "const pushEvent=e=>received.push(e);",
    "let stateUpdates=0;const emitState=()=>stateUpdates++;",
    "let phase='question',currentQuestionIndex=0,firstCorrectAt=null;",
    "let roundAnswers=new Map(),roundStartedAt=Date.now(),roundEndsAt=Date.now()+60000;",
    "let roundTimer=null;const QUESTION_SECONDS=30;",
    "const funnyCorrect=['OK'],funnyWrong=['NO'];",
    "const console={log(){},warn(){},error(){}};",
    "const likeTracker=createLikeTracker();",
    "const getPlayer=(id,username,nickname)=>{",
    "  const key=String(username||id).toLowerCase();",
    "  if(!players.has(key))players.set(key,{id:key,username,nickname,score:0,knowledge:0,gifts:0,giftDiamonds:0,correct:0,attempts:0,streak:0});",
    "  return players.get(key);",
    "};",
    "const normalizeUser=(data={})=>{",
    "  const u=data.user||{};const id=u.userId||data.userId||'';",
    "  const username=u.uniqueId||data.uniqueId||'';",
    "  return {id,username,nickname:u.nickname||username,valid:Boolean(id||username)};",
    "};",
    "const giftDiamondCost=data=>Number(data.giftDetails?.diamondCount||data.diamondCount||1);",
    "const tiktokConnection={roomId:'test',on(type,callback){handlers.set(type,callback)}};",
    "const scheduleTikTokRetry=()=>{};",
    "const reconnectTikTok=()=>{};",
    "let tiktokConnecting=false,tiktokStatus='live:test';",
    "const revealAnswer=()=>{};",
    section('function scoreAnswer(', 'function resetGame()'),
    section('function onTikTokLike(', 'function scheduleTikTokRetry('),
    section('function attachTikTokHandlers(', 'async function connectTikTok()'),
    "attachTikTokHandlers(tiktokConnection,",
    " {CHAT:'chat',GIFT:'gift',LIKE:'like'},",
    " {DECODED_DATA:'decodedData',WEBSOCKET_DATA:'websocketData',CONNECTED:'connected',DISCONNECTED:'disconnected',ERROR:'error'});",
    "return {handlers,players,roundAnswers,received,emitted,likeTracker,",
    "  beginNext(){roundAnswers.clear();firstCorrectAt=null;roundStartedAt=Date.now();roundEndsAt=Date.now()+60000;},",
    "  get stateUpdates(){return stateUpdates;}};"
  ].join('\n');
  return new Function(
    'QUESTIONS','gradeAnswer','ANSWER_WINDOW_MS','BOOST_THRESHOLD',
    'quizMultiplier','communityScore','createLikeTracker','LIKES_GOAL',
    code
  )(QUESTIONS,gradeAnswer,ANSWER_WINDOW_MS,BOOST_THRESHOLD,quizMultiplier,
    communityScore,createLikeTracker,LIKES_GOAL);
}

test('standard TikTok CHAT is accepted once per question, gifts add at 1 point per diamond', () => {
  const game=createSimulation();
  const correct=QUESTIONS[0].correct;
  const user={userId:'123',uniqueId:'ana_live',nickname:'Ana'};
  game.handlers.get('chat')({msgId:'a1',user,comment:correct});
  game.handlers.get('chat')({msgId:'a2',user,comment:correct});
  const p=game.players.get('ana_live');
  assert.ok(p,'Player was created from real TikTok comment');
  assert.equal(p.score,50,'first correct still awards 50');
  assert.equal(p.correct,1,'repeat comment in same round is ignored');

  game.handlers.get('gift')({
    msgId:'g1',user,giftId:5655,
    giftDetails:{giftType:0,giftName:'Rose',diamondCount:2},
    repeatCount:2,repeatEnd:true
  });
  assert.equal(p.score,54,'2 diamonds x 2 gifts = 4 points');
  assert.equal(p.gifts,4);
  assert.equal(game.players.size,1,'chat and gift are recorded on one profile');
  assert.equal(communityScore(game.players),54);
});

test('501 points unlock future x2 quiz scoring; gift points remain x1', () => {
  const game=createSimulation(), user={userId:'123',uniqueId:'ana_live',nickname:'Ana'};
  const correct=QUESTIONS[0].correct;
  game.handlers.get('chat')({msgId:'a1',user,comment:correct}); // 50
  game.handlers.get('gift')({
    msgId:'g1',user,giftId:5655,
    giftDetails:{giftType:0,giftName:'Rose',diamondCount:451},
    repeatCount:1,repeatEnd:true
  }); // 501
  const p=game.players.get('ana_live');
  assert.equal(p.score,501);
  game.beginNext();
  game.handlers.get('chat')({msgId:'a2',user,comment:correct});
  assert.equal(p.score,601,'next first correct awards 100 with boost');
  game.handlers.get('gift')({
    msgId:'g2',user,giftId:5655,
    giftDetails:{giftType:0,giftName:'Rose',diamondCount:10},
    repeatCount:1,repeatEnd:true
  });
  assert.equal(p.score,611,'gift points are not doubled');
  assert.equal(game.players.size,1);
});

test('actual LIKE event listener advances tap goal and ignores repeated IDs', () => {
  const game=createSimulation();
  assert.equal(game.handlers.has('like'),true);
  game.handlers.get('like')({msgId:'l1',likeCount:50000,user:{userId:'123'}});
  game.handlers.get('like')({msgId:'l1',likeCount:50000,user:{userId:'123'}});
  game.handlers.get('like')({msgId:'l2',likeCount:50000,user:{userId:'123'}});
  assert.equal(game.likeTracker.total,100000);
  assert.equal(game.received.filter(e=>e.type==='goal').length,1);
  assert.ok(game.stateUpdates >= 2);
});
