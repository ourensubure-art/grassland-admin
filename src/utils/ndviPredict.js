/**
 * 简单线性回归预测 4 周后的 NDVI。
 */
export function predict4Weeks(history) {
  const recent = history.slice(-8).filter((d) => d.ndvi_mean != null);
  if (recent.length < 3) return null;

  const n = recent.length;
  const xs = recent.map((_, i) => i);
  const ys = recent.map((d) => Number(d.ndvi_mean));
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);
  const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const b = den === 0 ? 0 : num / den;
  const a = meanY - b * meanX;
  const predicted = a + b * (n + 3);
  return Math.max(0, Math.min(1, predicted));
}

/**
 * 为迷你图生成未来 N 周预测序列。
 */
export function predictNDVI(history, weeks = 4) {
  const recent = history.slice(-8).filter((d) => d.ndvi_mean != null);
  if (recent.length < 3) return [];

  const n = recent.length;
  const xs = recent.map((_, i) => i);
  const ys = recent.map((d) => Number(d.ndvi_mean));
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);
  const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const b = den === 0 ? 0 : num / den;
  const a = meanY - b * meanX;
  const lastDate = new Date(recent[recent.length - 1].week_start);

  return Array.from({ length: weeks }, (_, index) => {
    const step = index + 1;
    const nextDate = new Date(lastDate);
    nextDate.setDate(nextDate.getDate() + 7 * step);
    return {
      week_start: nextDate.toISOString().slice(0, 10),
      ndvi_predicted: Math.max(0, Math.min(1, a + b * (n - 1 + step))),
      isPredict: true
    };
  });
}
