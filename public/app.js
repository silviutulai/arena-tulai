const socket = io();
const $ = selector => document.querySelector(selector);
const els = {
  top3: $('#top3'), round: $('#round'), category: $('#category'), difficulty: $('#difficulty'),
  questionCard: $('#questionCard'), question: $('#question'), visualTag: $('#visualTag'),
  visualWrap: $('#visualWrap'), visualImage: $('#visualImage'), answers: $('#answers'),
  reveal: $('#reveal'), time: $('#time'), timer: $('#timer'), feed: $('#feed'),
  status: $('#status'), dot: $('#dot'), giftBurst: $('#giftBurst'),
  giftUser: $('#giftUser'), giftText: $('#giftText'),
  pointsGoal: $('#pointsGoal'), likesGoal: $('#likesGoal'),
  pointsGoalCurrent: $('#pointsGoalCurrent'), likesGoalCurrent: $('#likesGoalCurrent'),
  pointsGoalPercent: $('#pointsGoalPercent'), likesGoalPercent: $('#likesGoalPercent'),
  pointsGoalBar: $('#pointsGoalBar'), likesGoalBar: $('#likesGoalBar'),
  pointsProgress: $('#pointsProgress'), likesProgress: $('#likesProgress')
};
let currentState = null;
let clockOffset = 0;
let displayedVisual = '';
let giftTimer = null;
let lastQuestionKey = '';
const format = value => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('ro-RO');
const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[ch]));

function renderGoals(goals = {}) {
  const items = [
    { data: goals.points || {}, target: 2000, card: els.pointsGoal, label: els.pointsGoalCurrent,
      percent: els.pointsGoalPercent, bar: els.pointsGoalBar, progress: els.pointsProgress },
    { data: goals.likes || {}, target: 100000, card: els.likesGoal, label: els.likesGoalCurrent,
      percent: els.likesGoalPercent, bar: els.likesGoalBar, progress: els.likesProgress }
  ];
  for (const item of items) {
    const current = Math.max(0, Number(item.data.current) || 0);
    const target = Math.max(1, Number(item.data.target) || item.target);
    const pct = Math.max(0, Math.min(100, current / target * 100));
    item.label.textContent = format(current);
    item.percent.textContent = current >= target ? '✓ ATINS' : Math.floor(pct) + '%';
    item.bar.style.width = pct + '%';
    item.card.classList.toggle('complete', current >= target);
    item.progress.setAttribute('aria-valuenow', Math.min(current, target).toString());
  }
}

function renderTop3(top3 = []) {
  const icons = ['🥇','🥈','🥉'];
  els.top3.innerHTML = [0,1,2].map(i => {
    const player = top3[i];
    if (!player) return '<div class="top-player"><div class="rank">' + icons[i] +
      '</div><div class="name">LOC LIBER</div><div class="score">0 PTS</div><div class="waiting-chip">INTRĂ ÎN JOC</div></div>';
    const boosted = Boolean(player.boosted || player.score > 500);
    const chip = boosted ? '<div class="boost-chip">⚡ x2 ACTIV</div>' :
      '<div class="waiting-chip">' + format(Math.max(0, 501 - player.score)) + ' PTS PÂNĂ LA x2</div>';
    return '<div class="top-player"><div class="rank">' + icons[i] +
      '</div><div class="name">' + esc(player.nickname || player.username || 'Jucător') +
      '</div><div class="score">' + format(player.score) + ' PTS</div>' + chip + '</div>';
  }).join('');
}

function renderQuestion(state) {
  const q = state.question;
  els.round.textContent = 'RUNDA ' + format(state.roundNumber);
  if (!q) {
    els.category.textContent = 'PREGĂTEȘTE-TE';
    els.difficulty.textContent = 'START';
    els.question.textContent = 'Scrie A, B, C sau D în chat când începe runda!';
    els.question.classList.remove('long');
    els.visualTag.classList.add('hidden');
    els.visualWrap.classList.add('hidden');
    els.questionCard.classList.remove('has-visual');
    [...els.answers.children].forEach((el, i) => {
      el.className = 'answer';
      el.querySelector('.answer-text').textContent = 'Răspunsul ' + 'ABCD'[i];
    });
    els.reveal.classList.add('hidden');
    displayedVisual = '';
    lastQuestionKey = '';
    return;
  }
  els.category.textContent = String(q.category || 'QUIZ').toUpperCase();
  els.difficulty.textContent = String(q.difficulty || 'QUIZ').toUpperCase();
  els.question.textContent = q.q;
  els.question.classList.toggle('long', q.q.length > 88);

  // Only self-hosted, allowlisted SVG assets are accepted.
  const visual = /^\/visuals\/[a-z0-9-]+\.svg$/.test(q.visual || '') ? q.visual : '';
  els.visualTag.classList.toggle('hidden', !visual);
  els.visualWrap.classList.toggle('hidden', !visual);
  els.questionCard.classList.toggle('has-visual', Boolean(visual));
  if (visual && displayedVisual !== visual) {
    els.visualImage.alt = 'Ilustrație pentru: ' + q.q;
    els.visualImage.src = visual;
    displayedVisual = visual;
  }
  if (!visual) displayedVisual = '';

  const questionKey = String(state.roundNumber) + ':' + String(q.index);
  const changed = lastQuestionKey !== questionKey;
  lastQuestionKey = questionKey;
  [...els.answers.children].forEach((el, i) => {
    const letter = 'ABCD'[i];
    if (changed || el.querySelector('.answer-text').textContent !== q.a[i]) {
      el.querySelector('.answer-text').textContent = q.a[i];
    }
    el.className = 'answer';
    if (state.phase === 'reveal') {
      el.classList.add(letter === q.correct ? 'correct' : 'dim');
    }
  });
  if (state.phase === 'reveal' && 'ABCD'.includes(q.correct)) {
    els.reveal.textContent = '✓ RĂSPUNS CORECT: ' + q.correct + ' — ' + q.a['ABCD'.indexOf(q.correct)];
    els.reveal.classList.remove('hidden');
  } else {
    els.reveal.classList.add('hidden');
  }
}

function renderFeed(events = []) {
  const active = events.length ? events : [{ type: 'round', text: 'Așteptăm prima rundă…' }];
  els.feed.innerHTML = active.slice(0,2).map(e => '<div class="feed-row ' +
    esc(e.type || '') + '">' + esc(e.text || '') + '</div>').join('');
}

function renderStatus(state) {
  const st = state.tiktokStatus || 'demo';
  els.dot.className = 'dot ' + (st.startsWith('live') ? 'live' : ['error','rate-limited'].includes(st) ? 'error' : '');
  const username = state.tiktokUsername ? ' @' + state.tiktokUsername : '';
  if (st.startsWith('live')) els.status.textContent = '● TIKTOK LIVE CONECTAT' + username;
  else if (st === 'demo') els.status.textContent = 'DEMO • CONFIGUREAZĂ TIKTOK_USERNAME';
  else if (st === 'connecting') els.status.textContent = 'TIKTOK • CONECTARE...';
  else if (st === 'waiting-live') els.status.textContent = 'AȘTEPT LIVE' + username;
  else if (st === 'rate-limited') els.status.textContent = 'TIKTOK • LIMITĂ TEMPORARĂ, RETRY AUTOMAT';
  else if (st === 'retrying' || st === 'disconnected') els.status.textContent = 'TIKTOK • RECONECTARE...';
  else els.status.textContent = 'TIKTOK • ' + st.toUpperCase();
}

function render(state) {
  currentState = state;
  clockOffset = Date.now() - (Number(state.serverNow) || Date.now());
  renderGoals(state.goals);
  renderTop3(state.top3);
  renderQuestion(state);
  renderFeed(state.lastEvents);
  renderStatus(state);
}

socket.on('state', render);
socket.on('feed', event => {
  if (!currentState) return;
  const events = [event, ...(currentState.lastEvents || [])].slice(0,7);
  currentState.lastEvents = events;
  renderFeed(events);
});
socket.on('giftBurst', gift => {
  els.giftUser.textContent = gift.user || 'Jucător';
  els.giftText.textContent = (gift.giftName || 'Gift') + ' • +' + format(gift.points) + ' PTS';
  els.giftBurst.classList.remove('hidden');
  els.giftBurst.style.animation = 'none';
  void els.giftBurst.offsetWidth;
  els.giftBurst.style.animation = 'giftPop 2.8s ease both';
  clearTimeout(giftTimer);
  giftTimer = setTimeout(() => els.giftBurst.classList.add('hidden'), 2800);
});
socket.on('disconnect', () => {
  els.dot.className = 'dot error';
  els.status.textContent = 'SITE • RECONECTARE...';
});

setInterval(() => {
  if (!currentState || !currentState.roundEndsAt || !currentState.question) {
    els.time.textContent = '--';
    els.timer.style.setProperty('--timer', '100%');
    return;
  }
  const serverNow = Date.now() - clockOffset;
  const left = Math.max(0, currentState.roundEndsAt - serverNow);
  const duration = currentState.phase === 'reveal' ? 7000 : (currentState.question.seconds || 30) * 1000;
  els.time.textContent = String(Math.ceil(left / 1000));
  els.timer.style.setProperty('--timer', Math.min(100, left / duration * 100) + '%');
}, 150);
