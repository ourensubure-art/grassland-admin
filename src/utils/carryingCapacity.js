/**
 * 根据 NDVI 计算地上生物量（干物质）
 * @param {number} ndvi - NDVI 值（0-1）
 * @returns {number} 生物量 kg/ha
 */
export function ndviToAGB(ndvi) {
  // 内蒙古典型草原线性反演模型：AGB = 2120 × NDVI - 184
  // 文献依据：李博等(2014)
  const agb = 2120 * ndvi - 184;
  return Math.max(0, agb);
}

/**
 * 计算可利用生物量（保留 50% 维持生态）
 */
export function usableAGB(agb) {
  return agb * 0.5;
}

/**
 * 计算理论载畜量（羊单位·天/公顷）
 * 1 个羊单位日采食干草 1.8 kg
 */
export function carryingCapacitySUDays(usableAgb) {
  return usableAgb / 1.8;
}

/**
 * 计算月载畜量（羊单位/公顷/月）
 */
export function carryingCapacityMonthly(suDays) {
  return suDays / 30;
}

/**
 * 一站式：从 NDVI 直接得到所有承载力指标
 */
export function computeCapacityFromNDVI(ndvi) {
  const agb = ndviToAGB(ndvi);
  const usable = usableAGB(agb);
  const suDays = carryingCapacitySUDays(usable);
  const monthly = carryingCapacityMonthly(suDays);
  return {
    ndvi,
    agb: Math.round(agb),
    usableAGB: Math.round(usable),
    suDaysPerHa: Math.round(suDays),
    monthlyCapacity: monthly.toFixed(2)
  };
}

/**
 * 评估超载状态
 * @param {number} actualStocking - 实际放牧密度（羊单位/公顷/月）
 * @param {number} theoreticalCapacity - 理论载畜量（羊单位/公顷/月）
 */
export function evaluateOverstocking(actualStocking, theoreticalCapacity) {
  if (theoreticalCapacity <= 0) {
    return { status: "critical", ratio: Infinity, message: "草地几乎无可利用生物量，必须立即休牧" };
  }
  const ratio = actualStocking / theoreticalCapacity;
  if (ratio > 1.5) return { status: "critical", ratio, message: "严重超载，建议立即减畜或休牧" };
  if (ratio > 1.2) return { status: "warning", ratio, message: "超载，建议减畜" };
  if (ratio > 0.8) return { status: "healthy", ratio, message: "放牧强度合理" };
  return { status: "underused", ratio, message: "放牧不足，可适度增畜" };
}
