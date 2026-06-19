// ⚠️ DEPRECATED 2026-06-19
// 这个固定阈值已废弃，改用 v_pasture_quantiles 动态分位数。
// 待全部引用清理后可删除此文件。
//
// 历史版本曾基于 scripts/analyze-ndvi.mjs 对 pasture_001 的 52 周 NDVI 分布计算：
// P25=0.1391、P50=0.1679、P75=0.2669。这里取三位小数，作为本地化健康等级阈值。
export const HEALTH_LEVELS = {
  poorMax: 0.139,
  mediumMax: 0.168,
  goodMax: 0.267
};

// 基于周变化 ΔNDVI 分布：P75 约为 0.0096，P90 约为 0.0422。
// 取 0.02 作为“周快速生长”阈值，表示超过常规波动上沿的明显增长。
export const GROWTH_RATE_THRESHOLD = 0.02;

// 基于周变化 ΔNDVI 分布：P25 约为 -0.0098，最小值约为 -0.049。
// 取 -0.02 作为“周明显下降”阈值，表示低于常规波动下沿的明显退化。
export const DECLINE_RATE_THRESHOLD = -0.02;
