import { computeCapacityFromNDVI } from "./carryingCapacity.js";
import { getGrazingDecision } from "./grazingDecision.js";

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function decisionTypeFromDecision(decision) {
  if (decision.action === "rest") return "rest";
  if (decision.canGraze) return "graze";
  return "reduce";
}

function severityFromDecision(decision) {
  if (decision.level === "high") return "critical";
  if (decision.level === "medium") return "warning";
  return "info";
}

function titleFromDecision(decision) {
  if (decision.action === "rest") return "草场恢复不足，建议临时休牧";
  if (decision.canGraze) return "草场状态良好，可继续适度放牧";
  return "草场压力偏高，建议降低放牧强度";
}

function actionsFromDecision(decision) {
  if (decision.action === "rest") return ["暂停放牧", "设置临时围栏", "休牧期结束后重新评估"];
  if (decision.canGraze) return ["控制放牧密度", "优先轮牧", "每日观察草高和裸地变化"];
  return ["减少放牧羊单位", "缩短每日放牧时长", "3天后复查草情"];
}

/**
 * 生成决策草稿：只根据传入快照计算，不读写数据库。
 */
export function buildDecisionDraft({ pastureId, latest, q, history, predictedNdvi }) {
  const currentNdvi = latest?.ndvi_mean == null ? null : Number(latest.ndvi_mean);
  const decision = getGrazingDecision(currentNdvi, q, history || []);
  const capacity = computeCapacityFromNDVI(currentNdvi);
  const decisionType = decisionTypeFromDecision(decision);
  const severity = severityFromDecision(decision);
  const durationDays = decision.action === "rest" ? 14 : 7;
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = addDays(today, durationDays);
  const actions = actionsFromDecision(decision);
  const title = titleFromDecision(decision);
  const predicted = predictedNdvi == null ? currentNdvi : Number(predictedNdvi);
  const reasonSummary = decision.reason;
  const reasonForHerder = decision.canGraze
    ? "本周草场状态较好，可以继续适度放牧。请控制放牧密度，避免集中踩踏低洼区域。"
    : decision.action === "rest"
      ? "该区域草场恢复不足，建议暂停放牧，让草地恢复。确需放牧时请先联系合作社确认。"
      : "草场压力偏高，建议减少进入该区域的羊单位数量，优先转移到草势更好的区域。";
  const reasonTechnical = [
    `当前 NDVI ${currentNdvi == null ? "--" : currentNdvi.toFixed(3)}`,
    `预测 NDVI ${predicted == null ? "--" : predicted.toFixed(3)}`,
    `本地 P25 ${q?.p25 == null ? "--" : Number(q.p25).toFixed(3)}`,
    `本地 P50 ${q?.p50 == null ? "--" : Number(q.p50).toFixed(3)}`,
    `本地等级 ${decision.health?.label || "无数据"}`,
    `趋势 ${decision.trend || "稳定"}`
  ].join("，");

  return {
    pasture_id: pastureId,
    title,
    body: reasonForHerder,
    severity,
    action: decisionType,
    decision_type: decisionType,
    start_date: startDate,
    end_date: endDate,
    duration_days: durationDays,
    ndvi_value: currentNdvi,
    ndvi_current: currentNdvi,
    ndvi_predicted: predicted,
    ndvi_threshold_p25: q?.p25 == null ? null : Number(q.p25),
    ndvi_threshold_p50: q?.p50 == null ? null : Number(q.p50),
    local_grade: decision.health?.label || "无数据",
    trend: decision.trend || "稳定",
    overload_rate: null,
    biomass_agb: capacity.agb,
    confidence: decision.confidence,
    valid_from: startDate,
    valid_to: endDate,
    reason_summary: reasonSummary,
    reason_for_herder: reasonForHerder,
    reason_technical: reasonTechnical,
    recommended_actions: actions,
    decision
  };
}
