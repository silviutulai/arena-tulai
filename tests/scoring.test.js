import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTIONS } from '../data/questions.js';
import { gradeAnswer, FIRST_CORRECT_POINTS, ANSWER_WINDOW_MS } from '../lib/round-scoring.js';

test('doar 80 întrebări noi: 30 ușoare și 50 grele sau expert', () => {
  assert.equal(QUESTIONS.length, 80);
  assert.equal(QUESTIONS.filter(q => q.difficulty === 'ușor').length, 30);
  assert.equal(QUESTIONS.filter(q => q.difficulty === 'greu' || q.difficulty === 'expert').length, 50);
  const normalized = QUESTIONS.map(q => q.q.trim().toLowerCase());
  assert.equal(new Set(normalized).size, 80, 'Nu acceptăm întrebări duplicate');
  for (const q of QUESTIONS) {
    assert.equal(q.a.length, 4);
    assert.ok('ABCD'.includes(q.correct));
    assert.ok(q.a.every(x => typeof x === 'string' && x.trim()));
    assert.ok(Number.isInteger(q.seconds) && q.seconds >= 15);
  }
  assert.ok(!normalized.some(q => q.includes('capitala australiei')), 'Întrebare veche rămasă în joc');
});

test('corecții la două întrebări de logică', () => {
  const seif = QUESTIONS.find(q => q.q.includes('seif'));
  assert.equal(seif.a['ABCD'.indexOf(seif.correct)], '603');
  const logica = QUESTIONS.find(q => q.q.startsWith('Dacă A este falsă'));
  assert.equal(logica.a['ABCD'.indexOf(logica.correct)], 'Adevărată');
});

test('primul corect primește 50, chiar dacă cineva a răspuns greșit înainte', () => {
  const wrong = gradeAnswer({ correct: false, answeredAt: 500, firstCorrectAt: null });
  assert.deepEqual(wrong, { points: 0, firstCorrectAt: null, isFirst: false });
  const first = gradeAnswer({ correct: true, answeredAt: 1000, firstCorrectAt: wrong.firstCorrectAt });
  assert.deepEqual(first, { points: FIRST_CORRECT_POINTS, firstCorrectAt: 1000, isFirst: true });
});

test('scade 10 puncte pentru fiecare secundă și se oprește după 5 secunde', () => {
  for (const [delay, expected] of [[0,49],[1000,40],[2000,30],[3000,20],[4000,10],[4999,1],[5000,0],[6000,0]]) {
    const result = gradeAnswer({ correct: true, answeredAt: 1000 + delay, firstCorrectAt: 1000 });
    assert.equal(result.points, expected, 'întârziere ' + delay + 'ms');
    assert.equal(result.firstCorrectAt, 1000);
    assert.equal(result.isFirst, false);
  }
  assert.equal(ANSWER_WINDOW_MS, 5000);
});

test('punctele pot fi adunate pe mai multe întrebări independent', () => {
  const p = { score: 0 };
  p.score += gradeAnswer({correct:true,answeredAt:500,firstCorrectAt:null}).points;
  p.score += gradeAnswer({correct:true,answeredAt:9500,firstCorrectAt:8500}).points;
  assert.equal(p.score,90);
});
