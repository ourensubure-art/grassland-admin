import { supabase } from "../src/lib/supabase.js";

const TABLE_NAME = "ndvi_weekly";
const SAMPLE_LIMIT = 5;
const PAGE_SIZE = 1000;
const MAX_ROWS_FOR_DISTINCT = 50000;

// 根据样例值推断字段类型；真实数据库类型需要后续用 SQL/RPC 或后台确认。
function inferValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function inferFieldTypes(rows) {
  const fieldMap = new Map();
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      const types = fieldMap.get(field) || new Set();
      types.add(inferValueType(value));
      fieldMap.set(field, types);
    }
  }

  return [...fieldMap.entries()].map(([field, types]) => ({
    field,
    inferred_types: [...types]
  }));
}

async function fetchTotalCount() {
  const { count, error } = await supabase
    .from(TABLE_NAME)
    .select("*", { count: "exact", head: true });

  if (error) throw error;
  return count || 0;
}

async function fetchSampleRows() {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select("*")
    .limit(SAMPLE_LIMIT);

  if (error) throw error;
  return data || [];
}

async function fetchDistinctPastureIdCount() {
  const pastureIds = new Set();

  for (let from = 0; from < MAX_ROWS_FOR_DISTINCT; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("pasture_id")
      .not("pasture_id", "is", null)
      .range(from, to);

    if (error) throw error;
    for (const row of data || []) {
      pastureIds.add(row.pasture_id);
    }
    if (!data || data.length < PAGE_SIZE) break;
  }

  return pastureIds.size;
}

try {
  const [totalCount, sampleRows, distinctPastureIdCount] = await Promise.all([
    fetchTotalCount(),
    fetchSampleRows(),
    fetchDistinctPastureIdCount()
  ]);
  const fieldNames = [...new Set(sampleRows.flatMap((row) => Object.keys(row)))];
  const fieldTypes = inferFieldTypes(sampleRows);

  console.log("=== ndvi_weekly 总行数 ===");
  console.log(totalCount);
  console.log("\n=== 不同 pasture_id 数量 ===");
  console.log(distinctPastureIdCount);
  console.log("\n=== 字段名 ===");
  console.log(JSON.stringify(fieldNames, null, 2));
  console.log("\n=== 字段类型（基于前 5 行样例推断）===");
  console.log(JSON.stringify(fieldTypes, null, 2));
  console.log("\n=== 前 5 行数据 ===");
  console.log(JSON.stringify(sampleRows, null, 2));
} catch (error) {
  console.error("ndvi_weekly 探测失败：", error);
  process.exitCode = 1;
}
