function getGrade(currentNdvi, q) {
  if (currentNdvi == null) return "无数据";
  if (currentNdvi >= q.p75) return "优";
  if (currentNdvi >= q.p50) return "良";
  if (currentNdvi >= q.p25) return "中";
  return "差";
}

/**
 * 基于当前周本地历史分位数做放牧决策。
 */
export function getGrazingDecision(currentNdvi, q, history) {
  if (currentNdvi == null || q == null) {
    return {
      level: "无数据",
      canGraze: false,
      action: "observe",
      restDays: 0,
      reason: "本周缺少有效观测",
      triggers: ["本周缺少有效 NDVI 或本地分位数基线"],
      health: { label: "无数据", color: "#64748b", score: 0 },
      recovery: null,
      confidence: 0
    };
  }

  const grade = getGrade(currentNdvi, q);
  const recovery = q.peak ? currentNdvi / q.peak : null;

  // 趋势：基于近 4 个有效观测点的首尾差值。
  const recent = history.slice(-4).map((d) => Number(d.ndvi_mean)).filter((v) => Number.isFinite(v));
  const trendValue = recent.length >= 2 ? recent[recent.length - 1] - recent[0] : 0;
  const trend = trendValue > 0.01 ? "上升" : trendValue < -0.01 ? "下降" : "稳定";

  const canGraze = (grade === "优" || grade === "良") && trendValue >= -0.02;
  const level = canGraze ? "low" : grade === "中" ? "medium" : "high";
  const action = canGraze ? "continue" : grade === "差" ? "rest" : "observe";
  const restDays = action === "rest" ? 14 : 0;
  const healthColors = {
    优: "#16a34a",
    良: "#65a30d",
    中: "#ca8a04",
    差: "#dc2626"
  };
  const healthScores = { 优: 4, 良: 3, 中: 2, 差: 1 };
  const comparison = grade === "优" || grade === "良" ? "≥" : "<";
  const reason = `当前 NDVI ${currentNdvi.toFixed(3)} ${comparison} 本地 P50 ${Number(q.p50).toFixed(3)}`;
  const triggers = [
    `当前等级：${grade}（按当前周本地分位数）`,
    `恢复度：${recovery == null ? "暂无" : `${(recovery * 100).toFixed(0)}%`}（相对本地 peak ${Number(q.peak).toFixed(3)}）`,
    `近 4 个有效点趋势：${trend}`
  ];

  return {
    level,
    canGraze,
    action,
    restDays,
    reason,
    triggers,
    trend,
    trendValue,
    health: { label: grade, color: healthColors[grade], score: healthScores[grade] },
    recovery,
    baselines: {
      p25: Number(q.p25),
      p50: Number(q.p50),
      p75: Number(q.p75),
      p90: q.p90 == null ? null : Number(q.p90),
      peak: Number(q.peak),
      mean: q.mean_value == null ? null : Number(q.mean_value)
    },
    confidence: canGraze ? 0.86 : 0.78
  };
}
