import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { QUESTIONS } from '../data/questions.js';
import { gradeAnswer, FIRST_CORRECT_POINTS, ANSWER_WINDOW_MS } from '../lib/round-scoring.js';
import { BOOST_THRESHOLD, quizMultiplier, communityScore } from '../lib/live-goals.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
test('exactly 120 completely new questions: 46 illustrated and 74 standard', () => {
  assert.equal(QUESTIONS.length, 120);
  assert.equal(QUESTIONS.filter(q => q.visual).length, 46);
  assert.equal(QUESTIONS.filter(q => !q.visual).length, 74);
  const names = QUESTIONS.map(q => q.q.normalize('NFKC').toLowerCase().trim());
  assert.equal(new Set(names).size, QUESTIONS.length, 'No repeated question prompts');
  assert.ok(new Set(QUESTIONS.map(q => q.category)).size >= 20);
  for (const q of QUESTIONS) {
    assert.equal(q.a.length, 4, q.q);
    assert.ok(q.a.every(x => typeof x === 'string' && x.trim()), q.q);
    assert.ok('ABCD'.includes(q.correct), q.q);
    assert.ok(Number.isInteger(q.seconds) && q.seconds >= 20 && q.seconds <= 50, q.q);
    if (q.visual) {
      assert.match(q.visual, /^\/visuals\/[a-z0-9-]+\.svg$/);
      const path = join(ROOT, 'public', q.visual.slice(1));
      assert.ok(existsSync(path), 'Missing asset: ' + path);
      const svg = readFileSync(path, 'utf8');
      assert.ok(svg.includes('<svg ') && svg.includes('</svg>'), 'Malformed asset: ' + path);
    }
  }
  for (const legacy of ['Care număr urmează: 3, 9, 27, 81, ?',
    'Ce înseamnă acronimul CPU în informatică?', 'Care este capitala Kazahstanului în 2026?']) {
    assert.ok(!names.includes(legacy.toLowerCase()), 'Legacy question survived');
  }
});

test('unchanged first-correct timing: 50, 40, 30, 20, 10, 0', () => {
  const wrong = gradeAnswer({correct:false,answeredAt:100,firstCorrectAt:null});
  assert.equal(wrong.points,0);
  assert.equal(wrong.firstCorrectAt,null);
  const first = gradeAnswer({correct:true,answeredAt:1000,firstCorrectAt:null});
  assert.deepEqual(first,{points:50,firstCorrectAt:1000,isFirst:true});
  for (const [delay,points] of [[0,49],[1000,40],[2000,30],[3000,20],[4000,10],[4999,1],[5000,0],[7000,0]]) {
    assert.equal(gradeAnswer({correct:true,answeredAt:1000+delay,firstCorrectAt:1000}).points,points, String(delay));
  }
  assert.equal(FIRST_CORRECT_POINTS,50);
  assert.equal(ANSWER_WINDOW_MS,5000);
});

test('x2 only on future quiz awards when player already exceeded 500', () => {
  assert.equal(BOOST_THRESHOLD,500);
  assert.equal(quizMultiplier(0),1);
  assert.equal(quizMultiplier(499),1);
  assert.equal(quizMultiplier(500),1);
  assert.equal(quizMultiplier(501),2);
  let score=490;
  score += 50 * quizMultiplier(score); // crossing answer does not retroactively double
  assert.equal(score,540);
  score += 40 * quizMultiplier(score); // one second behind next round
  assert.equal(score,620);
  const players=new Map([['a',{score:620}],['b',{score:100}]]);
  assert.equal(communityScore(players),720);
});

test('images correspond to visible map and diagram categories', () => {
  const visuals=QUESTIONS.filter(q=>q.visual);
  assert.ok(visuals.some(q=>q.visual.includes('map-ita')));
  assert.ok(visuals.some(q=>q.visual.includes('map-jpn')));
  assert.ok(visuals.some(q=>q.visual.includes('/moon.svg')));
  assert.ok(visuals.some(q=>q.visual.includes('/water.svg')));
  assert.ok(visuals.some(q=>q.visual.includes('/chart.svg')));
});
