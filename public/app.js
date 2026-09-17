const socket = io();
const $ = s => document.querySelector(s);
const els = {
  top3: $('#top3'), round: $('#round'), category: $('#category'), difficulty: $('#difficulty'),
  question: $('#question'), answers: $('#answers'), reveal: $('#reveal'), time: $('#time'), timer: $('#timer'),
  feed: $('#feed'), status: $('#status'), dot: $('#dot'), giftBurst: $('#giftBurst'), giftUser: $('#giftUser'), giftText: $('#giftText')
};
let currentState = null;
let clockOffset = 0;

function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function medal(i){return ['🥇','🥈','🥉'][i] || `#${i+1}`}

function renderTop3(top3=[]){
  const spots = [0,1,2].map(i=>{
    const p=top3[i];
    return `<div class="top-player"><div class="rank">${medal(i)}</div><div class="name">${p?esc(p.nickname):'—'}</div><div class="score">${p?`${Math.round(p.score)} PTS`:'0 PTS'}</div></div>`
  });
  els.top3.innerHTML=spots.join('');
}
function renderQuestion(s){
  els.round.textContent=`RUNDA ${s.roundNumber}`;
  if(!s.question){
    els.category.textContent='Pregătește-te'; els.difficulty.textContent='LOBBY';
    els.question.innerHTML='Scrie <b>A, B, C sau D</b> în chat când începe runda.';
    [...els.answers.children].forEach((el,i)=>{el.className='answer'; el.querySelector('span').textContent='Răspuns';});
    els.reveal.classList.add('hidden'); return;
  }
  els.category.textContent=s.question.category;
  els.difficulty.textContent=s.question.difficulty.toUpperCase();
  els.question.textContent=s.question.q;
  [...els.answers.children].forEach((el,i)=>{
    const letter='ABCD'[i]; el.className='answer'; el.querySelector('span').textContent=s.question.a[i];
    if(s.phase==='reveal') el.classList.add(letter===s.question.correct?'correct':'dim');
  });
  if(s.phase==='reveal'){
    els.reveal.textContent=`✅ CORECT: ${s.question.correct} — ${s.question.a['ABCD'.indexOf(s.question.correct)]}`;
    els.reveal.classList.remove('hidden');
  }else els.reveal.classList.add('hidden');
}
function renderFeed(events=[]){
  els.feed.innerHTML=(events.length?events:[{type:'round',text:'Așteptăm prima rundă…'}]).slice(0,3).map(e=>`<div class="feed-row ${esc(e.type)}">${esc(e.text)}</div>`).join('');
}
function renderStatus(s){
  const st=s.tiktokStatus||'demo';
  els.dot.className='dot '+(st.startsWith('live')?'live':st==='error'?'error':'');
  if(st.startsWith('live')) els.status.textContent=`TIKTOK LIVE @${s.tiktokUsername}`;
  else if(st==='demo') els.status.textContent='DEMO MODE • CONECTEAZĂ USERNAME';
  else if(st==='waiting-live') els.status.textContent=`AȘTEPT LIVE @${s.tiktokUsername} • RETRY AUTOMAT`;
  else if(st==='retrying') els.status.textContent='TIKTOK • REÎNCERC CONECTAREA';
  else if(st==='connecting') els.status.textContent='TIKTOK • CONECTARE...';
  else if(st==='disconnected') els.status.textContent='TIKTOK • RECONECTARE...';
  else els.status.textContent='TIKTOK '+st.toUpperCase();
}
function render(s){
  currentState=s; clockOffset=Date.now()-s.serverNow; renderTop3(s.top3); renderQuestion(s); renderFeed(s.lastEvents); renderStatus(s);
}
socket.on('state',render);
socket.on('feed',e=>{if(!currentState)return; const arr=[e,...(currentState.lastEvents||[])].slice(0,7); currentState.lastEvents=arr; renderFeed(arr)});
socket.on('giftBurst',g=>{
  els.giftUser.textContent=g.user; els.giftText.textContent=`${g.giftName} • +${g.points} GIFT POWER`;
  els.giftBurst.classList.remove('hidden'); els.giftBurst.style.animation='none'; void els.giftBurst.offsetWidth; els.giftBurst.style.animation='giftPop 2.8s ease both';
  setTimeout(()=>els.giftBurst.classList.add('hidden'),2800);
});
setInterval(()=>{
  if(!currentState||!currentState.roundEndsAt){els.time.textContent='--';els.timer.style.setProperty('--timer','100%');return}
  const now=Date.now()-clockOffset, left=Math.max(0,currentState.roundEndsAt-now), total=(currentState.question?.seconds||7)*1000;
  const seconds=Math.ceil(left/1000); els.time.textContent=seconds;
  const pct=Math.max(0,Math.min(100,left/total*100)); els.timer.style.setProperty('--timer',`${pct}%`);
},150);
