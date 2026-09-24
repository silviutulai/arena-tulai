import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// These tests exercise the actual production functions without starting HTTP/TikTok.
const source = readFileSync(new URL('../server2.js', import.meta.url), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'source block exists: ' + start);
  return source.slice(a, b);
}
function identity(players, aliases, answers) {
  return new Function('players', 'playerAliases', 'roundAnswers',
    section('function cleanIdentity(', 'function topPlayers(') + ';return getPlayer;'
  )(players, aliases, answers);
}
function attachChat({ normalizeUser, getPlayer, scoreAnswer, timers }) {
  const body = section('function attachTikTokHandlers(', 'async function connectTikTok()');
  const attach = new Function(
    'normalizeUser','getPlayer','scoreAnswer','phase','setTimeout','console',
    'extractAnswer','claim','giftDiamondCost','scoreGift','tiktokConnection',
    'scheduleTikTokRetry','emitState','tiktokStatus','tiktokConnecting',
    body + ';return attachTikTokHandlers;'
  )(
    normalizeUser,getPlayer,scoreAnswer,'question',cb => { timers.push(cb); return 1; },
    { log() {}, warn() {}, error() {} },
    null,()=>true,()=>1,()=>{},null,()=>{},()=>{},'',false
  );
  const events = new Map();
  const connection = { on(name, cb) { events.set(name, cb); }, roomId: 'test' };
  attach(connection,{CHAT:'chat',GIFT:'gift'},{
    DECODED_DATA:'decodedData',WEBSOCKET_DATA:'websocketData',
    CONNECTED:'connected',DISCONNECTED:'disconnected',ERROR:'error'
  });
  return events;
}

test('merges username-only and ID-only records with cumulative scores', () => {
  const players = new Map(), aliases = new Map(), roundAnswers = new Map();
  const getPlayer = identity(players, aliases, roundAnswers);
  const idOnly = getPlayer('177', '', 'Ana');
  idOnly.score = 50;
  idOnly.knowledge = 50;
  idOnly.correct = 1;
  idOnly.attempts = 1;
  roundAnswers.set(idOnly.id, { answer: 'A', correct: true, points: 50, at: 100 });

  const userOnly = getPlayer('', '@ANA_real', 'Ana');
  userOnly.score = 7;
  userOnly.gifts = 7;
  userOnly.giftDiamonds = 7;
  assert.equal(players.size, 2);

  const merged = getPlayer('177', 'ana_REAL', 'Ana');
  assert.equal(players.size, 1);
  assert.equal(merged.score, 57);
  assert.equal(merged.knowledge, 50);
  assert.equal(merged.gifts, 7);
  assert.equal(roundAnswers.size, 1);
  assert.strictEqual(getPlayer('', 'ana_real', 'Ana'), merged);
  assert.strictEqual(getPlayer('177', '', 'Ana'), merged);
});

test('reconciles two already-scored aliases on the same round', () => {
  const players = new Map(), aliases = new Map(), roundAnswers = new Map();
  const getPlayer = identity(players, aliases, roundAnswers);
  const first = getPlayer('177', '', 'Ana');
  Object.assign(first, { score: 50, knowledge: 50, correct: 1, attempts: 1 });
  roundAnswers.set(first.id, { answer: 'A', correct: true, points: 50, at: 100 });

  const second = getPlayer('', 'ana_real', 'Ana');
  Object.assign(second, { score: 40, knowledge: 40, correct: 1, attempts: 1 });
  roundAnswers.set(second.id, { answer: 'A', correct: true, points: 40, at: 150 });

  const merged = getPlayer('177', 'ana_real', 'Ana');
  assert.equal(players.size, 1);
  assert.equal(merged.score, 50);
  assert.equal(merged.knowledge, 50);
  assert.equal(merged.correct, 1);
  assert.equal(merged.attempts, 1);
  assert.equal(roundAnswers.size, 1);
  assert.equal([...roundAnswers.values()][0].at, 100);
});

test('invalid decoded message cannot block real CHAT, fallback never double-scores', () => {
  const timers = [], scored = [];
  const normalizeUser = data => ({
    id: data.user?.userId || '',
    username: data.user?.uniqueId || '',
    nickname: data.user?.nickname || 'Ana',
    valid: Boolean(data.user?.userId || data.user?.uniqueId)
  });
  const events = attachChat({
    timers, normalizeUser, getPlayer() { return {}; },
    scoreAnswer(data) { scored.push(data); }
  });

  events.get('decodedData')('WebcastChatMessage', {
    comment:'A', common:{msgId:'one'}, user:{}
  });
  for (const cb of timers.splice(0)) cb();
  events.get('chat')({
    comment:'A', common:{msgId:'one'},
    user:{userId:'177',uniqueId:'ana_real',nickname:'Ana'}
  });
  assert.equal(scored.length, 1, 'normal chat must pass');

  events.get('decodedData')('WebcastChatMessage', {
    comment:'B', common:{msgId:'two'},
    user:{userId:'177',uniqueId:'ana_real',nickname:'Ana'}
  });
  events.get('chat')({
    comment:'B', common:{msgId:'two'},
    user:{userId:'177',uniqueId:'ana_real',nickname:'Ana'}
  });
  for (const cb of timers.splice(0)) cb();
  assert.equal(scored.length, 2, 'decoded + normal = one delivery');
});

test('separate chats without message IDs are not globally suppressed', () => {
  const timers=[], scored=[];
  const events=attachChat({
    timers,
    normalizeUser:data=>({id:'177',username:'ana_real',nickname:'Ana',valid:true}),
    getPlayer(){return {};},scoreAnswer(data){scored.push(data);}
  });
  const data={comment:'A',user:{userId:'177',uniqueId:'ana_real'}};
  events.get('chat')(data);
  events.get('chat')(data);
  // Production scoreAnswer enforces one answer per player per round; the
  // handler MUST allow the same answer in a later round.
  assert.equal(scored.length, 2);
});
