import { supabase } from "../src/lib/supabase.js";

const TABLE_NAME = "ndvi_weekly";
const PAGE_SIZE = 1000;

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values) {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function round(value, digits = 4) {
  if (value == null || Number.isNaN(value)) return null;
  return Number(value.toFixed(digits));
}

function summarize(values) {
  return {
    count: values.length,
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    mean: round(mean(values)),
    std: round(std(values)),
    p25: round(percentile(values, 0.25)),
    p50: round(percentile(values, 0.5)),
    p75: round(percentile(values, 0.75)),
    p90: round(percentile(values, 0.9))
  };
}

async function fetchAllNdviRows() {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("id,pasture_id,week_start,week_end,ndvi_mean,ndvi_filled,is_interpolated,created_at")
      .order("pasture_id", { ascending: true })
      .order("week_start", { ascending: true })
      .range(from, to);

    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function groupByPasture(rows) {
  return rows.reduce((map, row) => {
    const pastureId = row.pasture_id || "未知牧场";
    if (!map.has(pastureId)) map.set(pastureId, []);
    map.get(pastureId).push(row);
    return map;
  }, new Map());
}

function weeklyDeltas(rows) {
  const sorted = [...rows].sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
  const deltas = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = Number(sorted[index - 1].ndvi_filled);
    const current = Number(sorted[index].ndvi_filled);
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      deltas.push({
        from_week: sorted[index - 1].week_start,
        to_week: sorted[index].week_start,
        delta: current - previous
      });
    }
  }
  return deltas;
}

function analyzePasture(pastureId, rows) {
  const filledValues = rows
    .map((row) => Number(row.ndvi_filled))
    .filter((value) => Number.isFinite(value));
  const observedValues = rows
    .map((row) => row.ndvi_mean == null ? null : Number(row.ndvi_mean))
    .filter((value) => Number.isFinite(value));
  const deltas = weeklyDeltas(rows);
  const deltaValues = deltas.map((item) => item.delta);

  const largestIncrease = deltas.reduce((best, item) => !best || item.delta > best.delta ? item : best, null);
  const largestDecrease = deltas.reduce((best, item) => !best || item.delta < best.delta ? item : best, null);

  return {
    pasture_id: pastureId,
    row_count: rows.length,
    week_range: {
      start: rows[0]?.week_start || null,
      end: rows[rows.length - 1]?.week_start || null
    },
    ndvi_filled: summarize(filledValues),
    ndvi_mean_observed_only: observedValues.length ? summarize(observedValues) : null,
    interpolation: {
      interpolated_count: rows.filter((row) => row.is_interpolated).length,
      observed_count: rows.filter((row) => !row.is_interpolated).length
    },
    weekly_delta: {
      ...summarize(deltaValues),
      positive_weeks: deltaValues.filter((value) => value > 0).length,
      negative_weeks: deltaValues.filter((value) => value < 0).length,
      flat_weeks: deltaValues.filter((value) => value === 0).length,
      largest_increase: largestIncrease ? { ...largestIncrease, delta: round(largestIncrease.delta) } : null,
      largest_decrease: largestDecrease ? { ...largestDecrease, delta: round(largestDecrease.delta) } : null
    }
  };
}

try {
  const rows = await fetchAllNdviRows();
  const groups = groupByPasture(rows);
  const analyses = [...groups.entries()].map(([pastureId, pastureRows]) => analyzePasture(pastureId, pastureRows));

  console.log("=== ndvi_weekly 全量数据探索 ===");
  console.log(JSON.stringify({
    total_rows: rows.length,
    pasture_count: groups.size,
    analyses
  }, null, 2));
} catch (error) {
  console.error("NDVI 全量分析失败：", error);
  process.exitCode = 1;
}
