// Punctaj per întrebare: primul răspuns CORECT = 50p.
// Următoarele răspunsuri corecte pierd 10p pe fiecare secundă față de primul.
// Timpul este măsurat la recepția mesajului pe server.
export const FIRST_CORRECT_POINTS = 50;
export const POINTS_LOST_PER_SECOND = 10;
export const ANSWER_WINDOW_MS = 5000;

export function gradeAnswer({ correct, answeredAt, firstCorrectAt }) {
  if (!correct) return { points: 0, firstCorrectAt, isFirst: false };
  if (!Number.isFinite(answeredAt)) throw new TypeError('answeredAt must be finite');

  if (firstCorrectAt == null) {
    return { points: FIRST_CORRECT_POINTS, firstCorrectAt: answeredAt, isFirst: true };
  }

  const elapsedMs = Math.max(0, answeredAt - firstCorrectAt);
  if (elapsedMs >= ANSWER_WINDOW_MS) {
    return { points: 0, firstCorrectAt, isFirst: false };
  }

  // Proporțional cu fracțiunile de secundă; nu permitem egalarea primului.
  const raw = FIRST_CORRECT_POINTS - POINTS_LOST_PER_SECOND * elapsedMs / 1000;
  const points = Math.max(1, Math.min(FIRST_CORRECT_POINTS - 1, Math.round(raw)));
  return { points, firstCorrectAt, isFirst: false };
}
