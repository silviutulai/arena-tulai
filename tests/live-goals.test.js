import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  POINTS_GOAL, LIKES_GOAL, BOOST_THRESHOLD,
  quizMultiplier, communityScore, createLikeTracker
} from '../lib/live-goals.js';

const file = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../server2.js'), 'utf8');
function between(start, end) {
  const a=file.indexOf(start), b=end?file.indexOf(end,a):file.length;
  assert.ok(a>=0 && b>a,'Expected backend section '+start);
  return file.slice(a,b);
}
function fnv(text) {
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(16);
}

test('original TikTok LIVE connection and chat/gift listeners have not been changed', () => {
  // Baseline fingerprints from the last working version before Visual Edition.
  assert.equal(fnv(between('async function connectTikTok()')), '514ef5a9', 'Do not rewrite the TikTok connection');
  assert.equal(fnv(between('  function handleChat(', '  function handleGift(')), '4175a5a6', 'Do not rewrite comment reception');
  assert.equal(fnv(between('  function handleGift(', '  connection.on(WebcastEvent.CHAT')), 'c8a2502', 'Do not rewrite gift reception');
  assert.ok(file.includes("connection.on(WebcastEvent.LIKE, data => onTikTokLike(data));"), 'LIKE event listener missing');
});

test('the 2000-point goal totals all current player scores without double-counting aliases', () => {
  assert.equal(POINTS_GOAL,2000);
  const players=new Map([
    ['u:ana',{score:600,gifts:100,knowledge:500}],
    ['u:mihai',{score:1400,gifts:1000,knowledge:400}]
  ]);
  assert.equal(communityScore(players),2000);
  assert.equal(communityScore(new Map()),0);
  assert.equal(BOOST_THRESHOLD,500);
  assert.equal(quizMultiplier(500),1);
  assert.equal(quizMultiplier(501),2);
});

test('like batches, duplicate message IDs and room totals are handled correctly', () => {
  assert.equal(LIKES_GOAL,100000);
  const likes=createLikeTracker();
  assert.equal(likes.observe({msgId:'1',likeCount:50,totalLikeCount:50,user:{userId:'u1'}}),50);
  assert.equal(likes.observe({msgId:'1',likeCount:50,totalLikeCount:50,user:{userId:'u1'}}),0);
  assert.equal(likes.observe({msgId:'2',likeCount:25,totalLikeCount:75,user:{userId:'u1'}}),25);
  assert.equal(likes.observe({msgId:'3',totalLikeCount:90,user:{userId:'u1'}}),15);
  assert.equal(likes.observe({msgId:'4',totalLikeCount:90,user:{userId:'u1'}}),0);
  assert.equal(likes.total,90);
  likes.reset();
  assert.equal(likes.total,0);
  assert.equal(likes.observe({likeCount:100000}),100000);
  assert.equal(likes.total,100000);
});

test('like fallback starts from first observed cumulative count, not an invented total', () => {
  const likes=createLikeTracker();
  assert.equal(likes.observe({user:{uniqueId:'viewer'},totalLikeCount:320}),0);
  assert.equal(likes.observe({user:{uniqueId:'viewer'},totalLikeCount:360}),40);
  assert.equal(likes.total,40);
});
