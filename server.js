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
const ADMIN_KEY = process.env.ADMIN_KEY || 'arena-tulai-dev';
const AUTO_ADVANCE = String(process.env.AUTO_ADVANCE || 'true').toLowerCase() !== 'false';
const DEFAULT_SECONDS = Number(process.env.QUESTION_SECONDS || 25);
const REVEAL_SECONDS = Number(process.env.REVEAL_SECONDS || 7);
const GIFT_POINT_RATE = Number(process.env.GIFT_POINT_RATE || 0.35);
const TIKTOK_RETRY_MS = Number(process.env.TIKTOK_RETRY_MS || 15000);
const ANSWER_MAX = 70;
const GIFT_MAX_PER_ROUND = 30;

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
  const key = String(id || username || nickname || 'anon');
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
    rules: { answerMax: ANSWER_MAX, giftMax: GIFT_MAX_PER_ROUND }
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

const giftRoundPoints = new Map();

function scoreGift({ id, username, nickname, diamonds = 1, giftName = 'Gift', repeatCount = 1 }) {
  const player = getPlayer(id, username, nickname);
  const d = Math.max(1, Number(diamonds || 1)) * Math.max(1, Number(repeatCount || 1));
  player.giftDiamonds += d;
  const roundKey = `${roundNumber}:${player.id}`;
  const already = giftRoundPoints.get(roundKey) || 0;
  const raw = d * GIFT_POINT_RATE;
  const add = roundNumber > 0 ? Math.max(0, Math.min(GIFT_MAX_PER_ROUND - already, raw)) : 0;
  if (add > 0) {
    giftRoundPoints.set(roundKey, already + add);
    player.score += add;
    player.gifts += add;
  }
  pushEvent({ type:'gift', user: player.nickname, text: `🎁 ${player.nickname}: ${giftName} • +${Math.round(add)} Gift Power` });
  io.emit('giftBurst', { user: player.nickname, giftName, diamonds: d, points: Math.round(add) });
  emitState();
}

function resetGame() {
  clearTimers();
  players.clear();
  giftRoundPoints.clear();
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

async function connectTikTok(force = false) {
  if (!TIKTOK_USERNAME) {
    tiktokStatus = 'demo';
    emitState();
    return;
  }
  if (tiktokConnecting && !force) return;
  tiktokConnecting = true;
  tiktokStatus = 'connecting';
  emitState();

  try {
    const { TikTokLiveConnection, WebcastEvent } = await import('tiktok-live-connector');
    const connection = new TikTokLiveConnection(TIKTOK_USERNAME, {
      processInitialData: false,
      enableExtendedGiftInfo: true
    });
    tiktokConnection = connection;

    connection.on(WebcastEvent.CHAT, data => {
      const user = data.user || {};
      const comment = String(data.comment || '').trim();
      const match = comment.match(/^([ABCD])\b/i) || comment.match(/^([ABCD])$/i);
      if (!match) return;
      scoreAnswer({
        id: user.userId || user.uniqueId,
        username: user.uniqueId,
        nickname: user.nickname || user.uniqueId,
        answer: match[1]
      });
    });

    connection.on(WebcastEvent.GIFT, data => {
      const giftType = data.giftDetails?.giftType ?? data.giftType;
      if (giftType === 1 && !data.repeatEnd) return;
      const user = data.user || {};
      scoreGift({
        id: user.userId || user.uniqueId,
        username: user.uniqueId,
        nickname: user.nickname || user.uniqueId,
        diamonds: data.extendedGiftInfo?.diamond_count || data.diamondCount || 1,
        giftName: data.giftDetails?.giftName || data.extendedGiftInfo?.name || data.giftName || 'Gift',
        repeatCount: data.repeatCount || 1
      });
    });

    connection.on('disconnected', () => {
      tiktokConnection = null;
      tiktokConnecting = false;
      tiktokStatus = 'disconnected';
      emitState();
      scheduleTikTokRetry('disconnected');
    });
    connection.on('error', err => {
      console.error('[TikTok] error:', err?.message || err);
      tiktokStatus = 'error';
      emitState();
    });

    const stateInfo = await connection.connect();
    tiktokStatus = `live:${stateInfo.roomId || 'connected'}`;
    console.log(`[TikTok] Connected @${TIKTOK_USERNAME}`);
    if (tiktokRetryTimer) clearTimeout(tiktokRetryTimer);
    tiktokRetryTimer = null;
    emitState();
  } catch (err) {
    tiktokConnection = null;
    const msg = String(err?.message || err || 'unknown error');
    const offline = err?.name === 'UserOfflineError' || /isn't online|not currently live|offline/i.test(msg);
    if (offline) {
      console.log(`[TikTok] @${TIKTOK_USERNAME} not detected LIVE yet.`);
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
  connectTikTok();
});
