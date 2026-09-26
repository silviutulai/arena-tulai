export const POINTS_GOAL = 2000;
export const LIKES_GOAL = 100000;
export const BOOST_THRESHOLD = 500;

export function quizMultiplier(totalScoreBeforeAnswer) {
  return Number(totalScoreBeforeAnswer) > BOOST_THRESHOLD ? 2 : 1;
}
export function communityScore(players) {
  return [...players.values()].reduce((sum, p) => sum + Math.max(0, Number(p.score) || 0), 0);
}
export function createLikeTracker() {
  const seenMessages = new Set();
  const totalBySender = new Map();
  let count = 0;
  function observe(data = {}) {
    const msgId = data.msgId || data.messageId || data.common?.msgId || data.common?.id;
    if (msgId && seenMessages.has(String(msgId))) return 0;
    const batch = Number(data.likeCount);
    const cumulative = Number(data.totalLikeCount);
    const user = data.user || {};
    const userKey = String(user.userId || data.userId || user.uniqueId || data.uniqueId || 'room').toLowerCase();
    let increment = 0;
    if (Number.isFinite(batch) && batch > 0) increment = Math.round(batch);
    else if (Number.isFinite(cumulative) && cumulative >= 0) {
      const prior = totalBySender.get(userKey);
      if (prior !== undefined) increment = Math.max(0, Math.round(cumulative - prior));
    }
    if (Number.isFinite(cumulative) && cumulative >= 0) {
      totalBySender.set(userKey, Math.max(cumulative, totalBySender.get(userKey) || 0));
    }
    if (msgId) {
      seenMessages.add(String(msgId));
      if (seenMessages.size > 10000) seenMessages.delete(seenMessages.values().next().value);
    }
    count += increment;
    return increment;
  }
  return { observe, get total() { return count; }, reset() { seenMessages.clear(); totalBySender.clear(); count = 0; } };
}
