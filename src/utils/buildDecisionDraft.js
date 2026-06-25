import { computeCapacityFromNDVI } from "./carryingCapacity.js";
import { getGrazingDecision } from "./grazingDecision.js";

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function titleFromRisk(riskLevel, restDays) {
  if (riskLevel === "high") return `建议休牧 ${restDays} 天`;
  if (riskLevel === "medium") return "建议减畜放牧，加强监测";
  return "草场状态良好，可适度放牧";
}

function riskFromDecision(decision) {
  if (decision.level === "high") return "high";
  if (decision.level === "medium") return "medium";
  return "low";
}

/**
 * 生成决策草稿：只根据传入快照计算，不读写数据库。
 */
export function buildDecisionDraft({ pastureId, latest, q, history, predictedNdvi }) {
  const currentNdvi = latest?.ndvi_mean == null ? null : Number(latest.ndvi_mean);
  const decision = getGrazingDecision(currentNdvi, q, history || []);
  const capacity = computeCapacityFromNDVI(currentNdvi);
  const riskLevel = riskFromDecision(decision);
  const durationDays = decision.action === "rest" ? 14 : 7;
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = addDays(today, durationDays);
  const title = titleFromRisk(riskLevel, decision.restDays || durationDays);
  const predicted = predictedNdvi == null ? currentNdvi : Number(predictedNdvi);
  const localLevel = decision.health?.label || "无数据";
  const trend = decision.trend || "稳定";
  const confidence = decision.confidence || 0;
  const p50Text = q?.p50 == null ? "--" : Number(q.p50).toFixed(3);
  const ndviText = currentNdvi == null ? "--" : currentNdvi.toFixed(3);
  const compare = riskLevel === "low" ? "≥" : "<";
  const reason = `当前 NDVI ${ndviText} ${compare} 本地 P50 ${p50Text}，趋势${trend}，置信度${Math.round(confidence * 100)}%`;

  return {
    pasture_id: pastureId,
    status: "draft",
    title,
    reason,
    risk_level: riskLevel,
    ndvi_current: currentNdvi,
    ndvi_forecast: predicted,
    local_level: localLevel,
    trend,
    confidence,
    rest_days: decision.restDays || 0,
    risk_label: decision.level,
    start_date: startDate,
    end_date: endDate,
    created_by: "decision_admin",
    biomass_agb: capacity.agb,
    p50: q?.p50 == null ? null : Number(q.p50),
    decision
  };
}
