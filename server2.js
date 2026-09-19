import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { QUESTIONS } from './data/questions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const TIKTOK_USERNAME = String(process.env.TIKTOK_USERNAME || '').replace(/^@/, '').trim();
const SIGN_API_KEY = String(process.env.SIGN_API_KEY || '').trim();
const ADMIN_KEY = String(process.env.ADMIN_KEY || 'arena-tulai-dev');
const AUTO_ADVANCE = String(process.env.AUTO_ADVANCE || 'true').toLowerCase() !== 'false';
const QUESTION_SECONDS = Number(process.env.QUESTION_SECONDS || 25);
const REVEAL_SECONDS = Number(process.env.REVEAL_SECONDS || 7);
const TIKTOK_RETRY_MS = Number(process.env.TIKTOK_RETRY_MS || 15000);
const ANSWER_MAX = 70;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true, game: 'Arena Tulai', tiktokStatus }));
app.get('/control', (_, res) => res.sendFile(join(__dirname, 'public', 'control.html')));

const players = new Map();
const playerAliases = new Map();
let roundNumber = 0;
let currentQuestionIndex = -1;
let phase = 'lobby';
let roundStartedAt = 0;
let roundEndsAt = 0;
let roundTimer = null;
let nextTimer = null;
let roundAnswers = new Map();
let usedQuestionIndexes = [];
let lastEvents = [];

let tiktokStatus = TIKTOK_USERNAME ? 'connecting' : 'demo';
let tiktokConnection = null;
let tiktokRetryTimer = null;
let tiktokConnecting = false;

const funnyCorrect = [
  'BANG! CORECT 🔥',
  'Creier în formă maximă 🧠',
  'Ai gătit întrebarea asta 🍳',
  'Respect! A intrat perfect ✅',
  'TULAI, ce răspuns! ⚡'
];
const funnyWrong = [
  'Aproape… dar întrebarea a câștigat 😅',
  'A fost o capcană cu papuci 🩴',
  'Creierul a zis „recalculăm” 😂',
  'Data viitoare o demolăm 💥'
];

function cleanIdentity(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/^@/, '');
}

function usernameKey(value) {
  const v = cleanIdentity(value).toLowerCase();
  return (!v || v === 'tiktok_user' || v === 'tiktok user' || v === 'unknown') ? '' : v;
}

function idKey(value) {
  const v = cleanIdentity(value);
  return (!v || v === '0' || v === 'undefined' || v === 'null') ? '' : v;
}

function getPlayer(id, username, nickname) {
  const u = usernameKey(username);
  const uid = idKey(id);
  const aliases = [];
  if (u) aliases.push('u:' + u);
  if (uid) aliases.push('id:' + uid);

  let key = aliases.map(alias => playerAliases.get(alias)).find(k => k && players.has(k));
  if (!key) key = u ? 'u:' + u : uid ? 'id:' + uid : '';
  if (!key) return null;

  if (!players.has(key)) {
    players.set(key, {
      id: key,
      username: cleanIdentity(username),
      nickname: cleanIdentity(nickname) || cleanIdentity(username) || 'TikTok user',
      score: 0, knowledge: 0, gifts: 0, giftDiamonds: 0,
      correct: 0, attempts: 0, streak: 0
    });
  }

  const player = players.get(key);
  for (const alias of aliases) playerAliases.set(alias, key);
  if (cleanIdentity(username)) player.username = cleanIdentity(username);
  if (cleanIdentity(nickname)) player.nickname = cleanIdentity(nickname);
  return player;
}

function topPlayers(limit = 10) {
  return [...players.values()]
    .sort((a, b) => b.score - a.score || b.correct - a.correct || a.nickname.localeCompare(b.nickname))
    .slice(0, limit)
    .map((p, i) => ({
      ...p,
      rank: i + 1,
      score: Math.round(p.score),
      knowledge: Math.round(p.knowledge),
      gifts: Math.round(p.gifts)
    }));
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
    seconds: q.seconds || QUESTION_SECONDS,
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
    rules: { answerMax: ANSWER_MAX, giftRate: 1, giftMax: null }
  };
}

function emitState() {
  io.emit('state', state());
}

function pushEvent(event) {
  lastEvents.unshift({ ...event, at: Date.now() });
  lastEvents = lastEvents.slice(0, 12);
  io.emit('feed', lastEvents[0]);
}

function clearRoundTimers() {
  if (roundTimer) clearTimeout(roundTimer);
  if (nextTimer) clearTimeout(nextTimer);
  roundTimer = null;
  nextTimer = null;
}

function pickNextQuestion() {
  if (usedQuestionIndexes.length >= QUESTIONS.length) usedQuestionIndexes = [];
  const candidates = QUESTIONS.map((_, i) => i).filter(i => !usedQuestionIndexes.includes(i));
  const index = candidates[Math.floor(Math.random() * candidates.length)];
  usedQuestionIndexes.push(index);
  return index;
}

function startRound(forceIndex = null) {
  clearRoundTimers();
  roundNumber += 1;
  currentQuestionIndex = Number.isInteger(forceIndex) ? forceIndex : pickNextQuestion();
  phase = 'question';
  roundAnswers = new Map();

  const q = QUESTIONS[currentQuestionIndex];
  const seconds = q.seconds || QUESTION_SECONDS;
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

  if (AUTO_ADVANCE) {
    nextTimer = setTimeout(() => startRound(), REVEAL_SECONDS * 1000);
  }
}

function scoreAnswer({ id, username, nickname, answer }) {
  const normalized = String(answer || '').trim().toUpperCase().charAt(0);
  if (!['A', 'B', 'C', 'D'].includes(normalized)) return;

  if (phase !== 'question' || currentQuestionIndex < 0) {
    console.log(`[Arena] Answer ignored (phase=${phase}): ${nickname || username || id} -> ${normalized}`);
    return;
  }

  const player = getPlayer(id, username, nickname);
  if (!player) {
    console.log('[Arena] Answer ignored: no stable TikTok identity');
    return;
  }
  if (roundAnswers.has(player.id)) {
    console.log(`[Arena] Duplicate answer ignored: ${player.nickname} -> ${normalized}`);
    return;
  }

  const q = QUESTIONS[currentQuestionIndex];
  const correct = normalized === q.correct;
  player.attempts += 1;

  let points = 0;
  if (correct) {
    const totalMs = Math.max(1, (q.seconds || QUESTION_SECONDS) * 1000);
    const elapsed = Math.max(0, Date.now() - roundStartedAt);
    const timeRatio = Math.max(0, Math.min(1, 1 - elapsed / totalMs));
    const floor = { 'ușor': 0.56, 'mediu': 0.64, 'greu': 0.72, 'expert': 0.80 }[q.difficulty] || 0.62;
    points = Math.round(ANSWER_MAX * (floor + (1 - floor) * timeRatio));

    player.score += points;
    player.knowledge += points;
    player.correct += 1;
    player.streak += 1;

    pushEvent({
      type: 'correct',
      user: player.nickname,
      text: `${player.nickname}: ${normalized} +${points} • ${funnyCorrect[Math.floor(Math.random() * funnyCorrect.length)]}`
    });
  } else {
    player.streak = 0;
    pushEvent({
      type: 'wrong',
      user: player.nickname,
      text: `${player.nickname}: ${normalized} • ${funnyWrong[Math.floor(Math.random() * funnyWrong.length)]}`
    });
  }

  roundAnswers.set(player.id, { answer: normalized, correct, points, at: Date.now() });
  console.log(`[Arena] SCORED ${player.nickname}: answer=${normalized} correct=${correct} points=${points} total=${Math.round(player.score)}`);
  emitState();
}

function scoreGift({ id, username, nickname, diamonds = 1, giftName = 'Gift', repeatCount = 1 }) {
  const player = getPlayer(id, username, nickname);
  if (!player) {
    console.log('[Arena] Gift ignored: no stable TikTok identity');
    return;
  }
  const costPerGift = Math.max(1, Number(diamonds || 1));
  const count = Math.max(1, Number(repeatCount || 1));
  const totalDiamonds = Math.round(costPerGift * count);

  player.giftDiamonds += totalDiamonds;
  player.gifts += totalDiamonds;
  player.score += totalDiamonds;

  pushEvent({
    type: 'gift',
    user: player.nickname,
    text: `🎁 ${player.nickname}: ${giftName} • ${totalDiamonds}💎 = +${totalDiamonds} PTS`
  });
  io.emit('giftBurst', {
    user: player.nickname,
    giftName,
    diamonds: totalDiamonds,
    points: totalDiamonds
  });
  emitState();
}

function resetGame() {
  clearRoundTimers();
  players.clear();
  playerAliases.clear();
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

  socket.on('admin:start', ({ key, index } = {}) => {
    if (!isAdmin(socket, key)) return;
    startRound(Number.isInteger(index) ? index : null);
  });

  socket.on('admin:reveal', ({ key } = {}) => {
    if (!isAdmin(socket, key)) return;
    revealAnswer();
  });

  socket.on('admin:reset', ({ key } = {}) => {
    if (!isAdmin(socket, key)) return;
    resetGame();
  });

  socket.on('admin:demoAnswer', ({ key, username, answer } = {}) => {
    if (!isAdmin(socket, key)) return;
    scoreAnswer({ id: `demo:${username}`, username, nickname: username, answer });
  });

  socket.on('admin:demoGift', ({ key, username, diamonds, giftName } = {}) => {
    if (!isAdmin(socket, key)) return;
    scoreGift({ id: `demo:${username}`, username, nickname: username, diamonds, giftName });
  });

  socket.on('admin:reconnectTikTok', ({ key } = {}) => {
    if (!isAdmin(socket, key)) return;
    reconnectTikTok();
  });
});

function normalizeUser(data = {}) {
  const nested = [
    data.user, data.userInfo, data.user_info,
    data.userDetails, data.user_details,
    data.sender, data.author
  ].filter(Boolean);

  const user = nested.find(x =>
    x.userId || x.user_id || x.id || x.uniqueId || x.unique_id || x.secUid || x.sec_uid
  ) || nested[0] || {};

  const id =
    user.userId || user.user_id || user.id ||
    data.userId || data.user_id ||
    user.secUid || user.sec_uid ||
    data.secUid || data.sec_uid || '';

  const username =
    user.uniqueId || user.unique_id ||
    data.uniqueId || data.unique_id ||
    user.username || data.username || '';

  const nickname =
    user.nickname || user.nickName || user.displayName ||
    data.nickname || data.nickName || data.displayName ||
    username || '';

  const stableId = idKey(id);
  const stableUsername = usernameKey(username);

  return {
    id: stableId,
    username: stableUsername ? cleanIdentity(username) : '',
    nickname: cleanIdentity(nickname) || (stableUsername ? cleanIdentity(username) : ''),
    valid: Boolean(stableId || stableUsername)
  };
}

function giftDiamondCost(data = {}) {
  return Number(
    data.extendedGiftInfo?.diamond_count ||
    data.extendedGiftInfo?.diamondCount ||
    data.giftDetails?.diamondCount ||
    data.giftDetails?.diamond_count ||
    data.diamondCount ||
    data.giftDiamondCount ||
    1
  );
}

function scheduleTikTokRetry(reason = 'disconnected') {
  if (!TIKTOK_USERNAME || tiktokRetryTimer) return;
  tiktokStatus = reason === 'offline' ? 'waiting-live' : 'retrying';
  emitState();
  console.log(`[TikTok] Retry in ${Math.round(TIKTOK_RETRY_MS / 1000)}s (${reason})`);

  tiktokRetryTimer = setTimeout(() => {
    tiktokRetryTimer = null;
    connectTikTok();
  }, TIKTOK_RETRY_MS);
}

function attachTikTokHandlers(connection, WebcastEvent, ControlEvent) {
  const seen = new Map();

  function cleanupSeen() {
    const cutoff = Date.now() - 120000;
    for (const [key, at] of seen) {
      if (at < cutoff) seen.delete(key);
    }
  }

  function eventKey(type, data = {}) {
    const common = data.common || {};
    const hardId =
      data.msgId || data.messageId || data.id ||
      common.msgId || common.messageId || common.id ||
      data.logId || common.logId;
    if (hardId) return `${type}:id:${String(hardId)}`;

    const person = normalizeUser(data);
    const text = String(data.comment || data.content || data.text || '');
    const giftId = data.giftId || data.giftDetails?.giftId || data.giftDetails?.id || '';
    const repeat = data.repeatCount || '';
    const ts = data.createTime || common.createTime || data.timestamp || common.timestamp || '';
    return `${type}:${person.id}:${text}:${giftId}:${repeat}:${ts}`;
  }

  function claim(type, data) {
    cleanupSeen();
    const key = eventKey(type, data);
    if (seen.has(key)) return false;
    seen.set(key, Date.now());
    return true;
  }

  function extractAnswer(raw) {
    const clean = String(raw || '')
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF\uFE0F]/g, '')
      .trim()
      .toUpperCase();

    const match = clean.match(/^([ABCD])(?:\s|[^A-Z0-9])*$/u);
    return match ? match[1] : null;
  }

  function handleChat(data = {}, source = 'chat') {
    if (!claim('chat', data)) return;

    const person = normalizeUser(data);
    const comment = String(data.comment || data.content || data.text || '').trim();
    if (!person.valid) {
      console.log(`[TikTok CHAT/${source}] Ignored message without stable user: ${comment}`);
      return;
    }
    console.log(`[TikTok CHAT/${source}] ${person.nickname} (@${person.username || person.id}): ${comment}`);

    const answer = extractAnswer(comment);
    if (!answer) {
      console.log(`[Arena] Chat seen but not A/B/C/D: "${comment}"`);
      return;
    }

    console.log(`[Arena] Answer accepted: ${person.nickname} -> ${answer}`);
    scoreAnswer({ ...person, answer });
  }

  function handleGift(data = {}, source = 'gift') {
    if (!claim('gift', data)) return;
    if (source !== 'event') return;

    const giftType = data.giftDetails?.giftType ?? data.giftType;
    if (giftType === 1 && !data.repeatEnd) return;

    const person = normalizeUser(data);
    if (!person.valid) {
      console.log('[TikTok GIFT] Ignored gift without a real user');
      return;
    }

    const giftId = data.giftId || data.giftDetails?.giftId || data.giftDetails?.id || '';
    const giftName =
      data.giftDetails?.giftName ||
      data.extendedGiftInfo?.name ||
      data.giftName ||
      '';

    if (!giftId && !giftName) {
      console.log('[TikTok GIFT] Ignored non-gift payload');
      return;
    }

    const diamonds = giftDiamondCost(data);
    if (!Number.isFinite(diamonds) || diamonds <= 0) {
      console.log('[TikTok GIFT] Ignored gift with invalid diamond value');
      return;
    }

    const repeatCount = Math.max(1, Number(data.repeatCount || 1));
    console.log(`[TikTok GIFT/${source}] ${person.nickname} (@${person.username || person.id}): ${giftName || ('Gift ' + giftId)} cost=${diamonds} x${repeatCount}`);
    scoreGift({
      ...person,
      diamonds,
      giftName: giftName || `Gift ${giftId}`,
      repeatCount
    });
  }

  connection.on(WebcastEvent.CHAT, data => handleChat(data, 'event'));
  connection.on(WebcastEvent.GIFT, data => handleGift(data, 'event'));

  const decodedEvent = ControlEvent?.DECODED_DATA || 'decodedData';
  connection.on(decodedEvent, (eventName, decodedData) => {
    const name = String(eventName || '');
    if (/chat/i.test(name)) {
      handleChat(decodedData || {}, `decoded:${name}`);
    }
  });

  let websocketPackets = 0;
  const wsDataEvent = ControlEvent?.WEBSOCKET_DATA || 'websocketData';
  connection.on(wsDataEvent, () => {
    websocketPackets += 1;
    if (websocketPackets === 1 || websocketPackets % 50 === 0) {
      console.log(`[TikTok] WebSocket packets received: ${websocketPackets}`);
    }
  });

  connection.on(ControlEvent?.CONNECTED || 'connected', stateInfo => {
    console.log(`[TikTok] WebSocket connected roomId=${stateInfo?.roomId || connection.roomId || '?'}`);
  });

  connection.on(ControlEvent?.DISCONNECTED || 'disconnected', payload => {
    if (tiktokConnection !== connection) return;
    const code = payload?.code;
    const reason = payload?.reason;
    console.warn(`[TikTok] Disconnected code=${code ?? '?'} reason=${reason ?? '?'}`);
    tiktokConnection = null;
    tiktokConnecting = false;
    tiktokStatus = 'disconnected';
    emitState();
    scheduleTikTokRetry('disconnected');
  });

  connection.on(ControlEvent?.ERROR || 'error', err => {
    const info = err?.info || err?.message || String(err || 'unknown');
    const exception = err?.exception?.message || err?.exception || '';
    console.error(`[TikTok] Error: ${info}`, exception);
  });
}

async function connectTikTok() {
  if (!TIKTOK_USERNAME) {
    tiktokStatus = 'demo';
    emitState();
    return;
  }
  if (tiktokConnecting || tiktokConnection?.isConnected) return;

  tiktokConnecting = true;
  tiktokStatus = 'connecting';
  emitState();

  try {
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import('tiktok-live-connector');
    const options = {
      processInitialData: false,
      fetchRoomInfoOnConnect: false,
      enableExtendedGiftInfo: false
    };
    if (SIGN_API_KEY) options.signApiKey = SIGN_API_KEY;

    const connection = new TikTokLiveConnection(TIKTOK_USERNAME, options);
    tiktokConnection = connection;
    attachTikTokHandlers(connection, WebcastEvent, ControlEvent);

    const roomId = await connection.fetchRoomId();
    console.log(`[TikTok] Resolved @${TIKTOK_USERNAME} -> roomId=${roomId}`);

    const info = await connection.connect(roomId);
    tiktokStatus = `live:${info.roomId || roomId}`;
    console.log(`[TikTok] Connected @${TIKTOK_USERNAME} roomId=${info.roomId || roomId}`);

    if (tiktokRetryTimer) clearTimeout(tiktokRetryTimer);
    tiktokRetryTimer = null;
    emitState();
  } catch (err) {
    const message = String(err?.message || err?.exception?.message || err || 'unknown error');
    console.error(`[TikTok] Connect failed: ${message}`);
    tiktokConnection = null;

    const offline = err?.name === 'UserOfflineError' || /isn't online|not currently live|offline|user_not_found/i.test(message);
    tiktokStatus = offline ? 'waiting-live' : 'error';
    emitState();
    scheduleTikTokRetry(offline ? 'offline' : 'error');
  } finally {
    tiktokConnecting = false;
  }
}

async function reconnectTikTok() {
  if (tiktokRetryTimer) clearTimeout(tiktokRetryTimer);
  tiktokRetryTimer = null;

  const old = tiktokConnection;
  tiktokConnection = null;
  if (old) {
    try { await old.disconnect(); } catch {}
  }

  tiktokConnecting = false;
  await connectTikTok();
}

server.listen(PORT, () => {
  console.log(`Arena Tulai: http://localhost:${PORT}`);
  console.log(`Control: http://localhost:${PORT}/control?key=${ADMIN_KEY}`);
  console.log(`[TikTok] Target @${TIKTOK_USERNAME || 'none'} — dynamic roomId mode`);
  console.log('[Arena] Gift scoring: 1 diamond = 1 point, no cap.');
  connectTikTok();
});
