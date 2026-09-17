import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { QUESTIONS } from './data/questions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const TIKTOK_USERNAME = (process.env.TIKTOK_USERNAME || '').replace(/^@/, '').trim();
const TIKTOK_ROOM_ID = String(process.env.TIKTOK_ROOM_ID || '').trim();
const SIGN_API_KEY = String(process.env.SIGN_API_KEY || '').trim();
const ADMIN_KEY = process.env.ADMIN_KEY || 'arena-tulai-dev';
const AUTO_ADVANCE = String(process.env.AUTO_ADVANCE || 'true').toLowerCase() !== 'false';
const DEFAULT_SECONDS = Number(process.env.QUESTION_SECONDS || 25);
const REVEAL_SECONDS = Number(process.env.REVEAL_SECONDS || 7);
const TIKTOK_RETRY_MS = Number(process.env.TIKTOK_RETRY_MS || 15000);
const ANSWER_MAX = 70;
const GIFT_POINT_RATE = 1;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true, game: 'Arena Tulai' }));
app.get('/control', (_, res) => res.sendFile(join(__dirname, 'public', 'control.html')));

const players = new Map();
let roundNumber = 0;
let currentQuestionIndex = -1;
let phase = 'lobby';
let roundStartedAt = 0;
let roundEndsAt = 0;
let roundTimer = null;
let nextTimer = null;
let tiktokStatus = TIKTOK_USERNAME ? 'connecting' : 'demo';
let tiktokConnection = null;
let tiktokRetryTimer = null;
let tiktokConnecting = false;
let usedQuestionIndexes = [];
let roundAnswers = new Map();
let lastEvents = [];

const funnyCorrect = ['BANG! CORECT 🔥','Creier în formă maximă 🧠','Ai gătit întrebarea asta 🍳','Respect! A intrat perfect ✅','TULAI, ce răspuns! ⚡'];
const funnyWrong = ['Aproape… dar întrebarea a câștigat 😅','A fost o capcană cu papuci 🩴','Creierul a zis „recalculăm” 😂','Data viitoare o demolăm 💥'];

function getPlayer(id, username, nickname) {
  const key = String(id || username || nickname || `anon:${players.size + 1}`);
  if (!players.has(key)) {
    players.set(key, {
      id: key,
      username: username || nickname || `player_${players.size + 1}`,
      nickname: nickname || username || `Player ${players.size + 1}`,
      score: 0,
      knowledge: 0,
      gifts: 0,
      giftDiamonds: 0,
      correct: 0,
      attempts: 0,
      streak: 0,
      avatar: null
    });
  }
  const p = players.get(key);
  if (username) p.username = username;
  if (nickname) p.nickname = nickname;
  return p;
}

function topPlayers(limit = 10) {
  return [...players.values()]
    .sort((a,b) => b.score - a.score || b.correct - a.correct || a.nickname.localeCompare(b.nickname))
    .slice(0, limit)
    .map((p, i) => ({...p, rank: i + 1, score: Math.round(p.score), knowledge: Math.round(p.knowledge), gifts: Math.round(p.gifts)}));
}

function publicQuestion() {
  if (currentQuestionIndex < 0) return null;
  const q = QUESTIONS[currentQuestionIndex];
  return {
    index: currentQuestionIndex,
    q: q.q,
    a: q.a,
    category: q.category,
    difficulty: q.difficulty,
    seconds: q.seconds || DEFAULT_SECONDS,
    correct: phase === 'reveal' ? q.correct : null
  };
}

function state() {
  return {
    title: 'ARENA TULAI',
    subtitle: 'CINE ESTE CEL MAI TARE?',
    phase,
    roundNumber,
    question: publicQuestion(),
    roundEndsAt,
    serverNow: Date.now(),
    top3: topPlayers(3),
    leaderboard: topPlayers(10),
    lastEvents: lastEvents.slice(0, 7),
    tiktokStatus,
    tiktokUsername: TIKTOK_USERNAME || null,
    rules: { answerMax: ANSWER_MAX, giftRate: GIFT_POINT_RATE, giftMax: null }
  };
}

function emitState() { io.emit('state', state()); }

function pushEvent(event) {
  lastEvents.unshift({ ...event, at: Date.now() });
  lastEvents = lastEvents.slice(0, 12);
  io.emit('feed', lastEvents[0]);
}

function pickNextQuestion() {
  if (usedQuestionIndexes.length >= QUESTIONS.length) usedQuestionIndexes = [];
  const candidates = QUESTIONS.map((_, i) => i).filter(i => !usedQuestionIndexes.includes(i));
  const idx = candidates[Math.floor(Math.random() * candidates.length)];
  usedQuestionIndexes.push(idx);
  return idx;
}

function clearTimers() {
  if (roundTimer) clearTimeout(roundTimer);
  if (nextTimer) clearTimeout(nextTimer);
  roundTimer = null;
  nextTimer = null;
}

function startRound(forceIndex = null) {
  clearTimers();
  roundNumber += 1;
  currentQuestionIndex = Number.isInteger(forceIndex) ? forceIndex : pickNextQuestion();
  phase = 'question';
  roundAnswers = new Map();
  const q = QUESTIONS[currentQuestionIndex];
  const seconds = q.seconds || DEFAULT_SECONDS;
  roundStartedAt = Date.now();
  roundEndsAt = roundStartedAt + seconds * 1000;
  pushEvent({ type: 'round', text: `Runda ${roundNumber}: ${q.category} • ${q.difficulty.toUpperCase()}` });
  emitState();
  roundTimer = setTimeout(revealAnswer, seconds * 1000);
}

function revealAnswer() {
  if (phase !== 'question') return;
  phase = 'reveal';
  roundEndsAt = Date.now() + REVEAL_SECONDS * 1000;
  const q = QUESTIONS[currentQuestionIndex];
  const correctCount = [...roundAnswers.values()].filter(x => x.correct).length;
  pushEvent({ type: 'reveal', text: `Răspuns: ${q.correct} • corecte: ${correctCount}` });
  emitState();
  if (AUTO_ADVANCE) nextTimer = setTimeout(() => startRound(), REVEAL_SECONDS * 1000);
}

function scoreAnswer({ id, username, nickname, answer }) {
  if (phase !== 'question' || currentQuestionIndex < 0) return;
  const normalized = String(answer || '').trim().toUpperCase().charAt(0);
  if (!['A','B','C','D'].includes(normalized)) return;
  const player = getPlayer(id, username, nickname);
  if (roundAnswers.has(player.id)) return;

  const q = QUESTIONS[currentQuestionIndex];
  const isCorrect = normalized === q.correct;
  player.attempts += 1;

  let points = 0;
  if (isCorrect) {
    const totalMs = Math.max(1, (q.seconds || DEFAULT_SECONDS) * 1000);
    const elapsed = Math.max(0, Date.now() - roundStartedAt);
    const timeRatio = Math.max(0, Math.min(1, 1 - elapsed / totalMs));
    const difficultyFloor = { 'ușor': 0.56, 'mediu': 0.64, 'greu': 0.72, 'expert': 0.80 }[q.difficulty] || 0.62;
    const factor = difficultyFloor + (1 - difficultyFloor) * timeRatio;
    points = Math.round(ANSWER_MAX * factor);
    player.score += points;
    player.knowledge += points;
    player.correct += 1;
    player.streak += 1;
    pushEvent({ type:'correct', user: player.nickname, text: `${player.nickname}: ${normalized} +${points} • ${funnyCorrect[Math.floor(Math.random()*funnyCorrect.length)]}` });
  } else {
    player.streak = 0;
    pushEvent({ type:'wrong', user: player.nickname, text: `${player.nickname}: ${normalized} • ${funnyWrong[Math.floor(Math.random()*funnyWrong.length)]}` });
  }
  roundAnswers.set(player.id, { answer: normalized, correct: isCorrect, points, at: Date.now() });
  emitState();
}

function scoreGift({ id, username, nickname, diamonds = 1, giftName = 'Gift', repeatCount = 1 }) {
  const player = getPlayer(id, username, nickname);
  const d = Math.max(1, Number(diamonds || 1)) * Math.max(1, Number(repeatCount || 1));
  const add = Math.round(d * GIFT_POINT_RATE);
  player.giftDiamonds += d;
  player.score += add;
  player.gifts += add;
  pushEvent({ type:'gift', user: player.nickname, text: `🎁 ${player.nickname}: ${giftName} • ${d} diamante = +${add} PTS` });
  io.emit('giftBurst', { user: player.nickname, giftName, diamonds: d, points: add });
  emitState();
}

function resetGame() {
  clearTimers();
  players.clear();
  roundAnswers.clear();
  lastEvents = [];
  roundNumber = 0;
  currentQuestionIndex = -1;
  phase = 'lobby';
  roundEndsAt = 0;
  emitState();
}

function isAdmin(socket, key) {
  return String(key || socket.handshake.auth?.key || socket.handshake.query?.key || '') === ADMIN_KEY;
}

io.on('connection', socket => {
  socket.emit('state', state());
  socket.on('admin:start', ({key, index} = {}) => {
    if (!isAdmin(socket, key)) return;
    startRound(Number.isInteger(index) ? index : null);
  });
  socket.on('admin:reveal', ({key} = {}) => {
    if (!isAdmin(socket, key)) return;
    revealAnswer();
  });
  socket.on('admin:reset', ({key} = {}) => {
    if (!isAdmin(socket, key)) return;
    resetGame();
  });
  socket.on('admin:demoAnswer', ({key, username, answer} = {}) => {
    if (!isAdmin(socket, key)) return;
    scoreAnswer({ id:`demo:${username}`, username, nickname:username, answer });
  });
  socket.on('admin:demoGift', ({key, username, diamonds, giftName} = {}) => {
    if (!isAdmin(socket, key)) return;
    scoreGift({ id:`demo:${username}`, username, nickname:username, diamonds, giftName });
  });
  socket.on('admin:reconnectTikTok', ({key} = {}) => {
    if (!isAdmin(socket, key)) return;
    if (tiktokRetryTimer) clearTimeout(tiktokRetryTimer);
    tiktokRetryTimer = null;
    tiktokStatus = 'connecting';
    emitState();
    connectTikTok(true);
  });
});

function scheduleTikTokRetry(reason = 'waiting') {
  if (!TIKTOK_USERNAME || tiktokRetryTimer) return;
  tiktokStatus = reason === 'offline' ? 'waiting-live' : 'retrying';
  emitState();
  console.log(`[TikTok] Retry in ${Math.round(TIKTOK_RETRY_MS / 1000)}s (${reason})`);
  tiktokRetryTimer = setTimeout(() => {
    tiktokRetryTimer = null;
    connectTikTok();
  }, TIKTOK_RETRY_MS);
}

function normalizeTikTokUser(data = {}) {
  const nested = data.user || {};
  return {
    id: nested.userId || data.userId || nested.uniqueId || data.uniqueId || data.msgId || `tt:${Date.now()}`,
    username: nested.uniqueId || data.uniqueId || nested.nickname || data.nickname || 'tiktok_user',
    nickname: nested.nickname || data.nickname || nested.uniqueId || data.uniqueId || 'TikTok user'
  };
}

function attachTikTokHandlers(connection, WebcastEvent) {
  const onChat = data => {
    const comment = String(data?.comment || '').trim();
    const person = normalizeTikTokUser(data);
    console.log(`[TikTok CHAT] ${person.nickname} (@${person.username}): ${comment}`);
    const match = comment.match(/^\s*([ABCD])(?:\s|[.!?,;:🔥✅❤️💙💚💛💜])*$/iu);
    if (!match) return;
    console.log(`[Arena] Answer accepted: ${person.nickname} -> ${match[1].toUpperCase()}`);
    scoreAnswer({ ...person, answer: match[1] });
  };

  const onGift = data => {
    const giftType = data?.giftDetails?.giftType ?? data?.giftType;
    if (giftType === 1 && !data?.repeatEnd) return;
    const person = normalizeTikTokUser(data);
    const diamonds = data?.extendedGiftInfo?.diamond_count || data?.giftDetails?.diamondCount || data?.diamondCount || data?.giftDiamondCount || 1;
    const giftName = data?.giftDetails?.giftName || data?.extendedGiftInfo?.name || data?.giftName || 'Gift';
    scoreGift({
      ...person,
      diamonds,
      giftName,
      repeatCount: data?.repeatCount || 1
    });
  };

  const chatEvent = WebcastEvent?.CHAT || 'chat';
  const giftEvent = WebcastEvent?.GIFT || 'gift';
  connection.on(chatEvent, onChat);
  connection.on(giftEvent, onGift);
  if (chatEvent !== 'chat') connection.on('chat', onChat);
  if (giftEvent !== 'gift') connection.on('gift', onGift);

  connection.on('disconnected', (code, reason) => {
    if (tiktokConnection !== connection) return;
    console.warn(`[TikTok] disconnected code=${code ?? '?'} reason=${reason ?? '?'}`);
    tiktokConnection = null;
    tiktokConnecting = false;
    tiktokStatus = 'disconnected';
    emitState();
    scheduleTikTokRetry('disconnected');
  });

  connection.on('error', err => {
    console.error('[TikTok] stream error:', err?.message || err);
    if (tiktokConnection === connection) {
      tiktokStatus = 'error';
      emitState();
    }
  });
}

function makeTikTokConnection(TikTokLiveConnection, bypassLiveCheck = false) {
  const options = {
    processInitialData: false,
    fetchRoomInfoOnConnect: !bypassLiveCheck,
    enableExtendedGiftInfo: false
  };
  if (SIGN_API_KEY) options.signApiKey = SIGN_API_KEY;
  return new TikTokLiveConnection(TIKTOK_USERNAME, options);
}

async function connectWithFallback(TikTokLiveConnection, WebcastEvent) {
  const primary = makeTikTokConnection(TikTokLiveConnection, false);
  try {
    const stateInfo = await primary.connect(TIKTOK_ROOM_ID || undefined);
    tiktokConnection = primary;
    attachTikTokHandlers(primary, WebcastEvent);
    return { connection: primary, stateInfo, mode: TIKTOK_ROOM_ID ? 'room-id' : 'normal' };
  } catch (err) {
    const msg = String(err?.message || err || 'unknown error');
    const offline = err?.name === 'UserOfflineError' || /isn't online|not currently live|offline|user_not_found/i.test(msg);
    if (!offline || TIKTOK_ROOM_ID) throw err;

    console.warn(`[TikTok] Live check said OFFLINE for @${TIKTOK_USERNAME}. Trying room-id bypass...`);
    try { await primary.disconnect(); } catch {}

    const bypass = makeTikTokConnection(TikTokLiveConnection, true);
    const roomId = await bypass.fetchRoomId();
    console.log(`[TikTok] Bypass resolved roomId=${roomId}`);
    const stateInfo = await bypass.connect(roomId);
    tiktokConnection = bypass;
    attachTikTokHandlers(bypass, WebcastEvent);
    return { connection: bypass, stateInfo, mode: 'bypass' };
  }
}

async function connectTikTok(force = false) {
  if (!TIKTOK_USERNAME) {
    tiktokStatus = 'demo';
    emitState();
    return;
  }
  if (tiktokConnecting && !force) return;

  if (force && tiktokConnection) {
    const old = tiktokConnection;
    tiktokConnection = null;
    try { await old.disconnect(); } catch {}
  }

  tiktokConnecting = true;
  tiktokStatus = 'connecting';
  emitState();

  try {
    const { TikTokLiveConnection, WebcastEvent } = await import('tiktok-live-connector');
    const { connection, stateInfo, mode } = await connectWithFallback(TikTokLiveConnection, WebcastEvent);
    tiktokConnection = connection;
    tiktokStatus = `live:${stateInfo.roomId || connection.roomId || 'connected'}`;
    console.log(`[TikTok] Connected @${TIKTOK_USERNAME} (${mode}) roomId=${stateInfo.roomId || connection.roomId || '?'}`);
    if (tiktokRetryTimer) clearTimeout(tiktokRetryTimer);
    tiktokRetryTimer = null;
    emitState();
  } catch (err) {
    tiktokConnection = null;
    const msg = String(err?.message || err || 'unknown error');
    const offline = err?.name === 'UserOfflineError' || /isn't online|not currently live|offline|user_not_found/i.test(msg);
    if (offline) {
      console.log(`[TikTok] @${TIKTOK_USERNAME} still not resolvable as LIVE after bypass: ${msg}`);
      scheduleTikTokRetry('offline');
    } else {
      tiktokStatus = 'error';
      console.error('[TikTok] connect failed:', msg);
      emitState();
      scheduleTikTokRetry('error');
    }
  } finally {
    tiktokConnecting = false;
  }
}

server.listen(PORT, () => {
  console.log(`Arena Tulai: http://localhost:${PORT}`);
  console.log(`Control: http://localhost:${PORT}/control?key=${ADMIN_KEY}`);
  console.log(`[TikTok] target=@${TIKTOK_USERNAME || 'none'}${TIKTOK_ROOM_ID ? ` roomId=${TIKTOK_ROOM_ID}` : ''}${SIGN_API_KEY ? ' EulerKey=yes' : ''}`);
  console.log('[Arena] Gifts: 100% enabled — 1 diamond = 1 point, no cap.');
  connectTikTok();
});
