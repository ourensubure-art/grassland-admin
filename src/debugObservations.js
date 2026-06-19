import { supabase } from "./lib/supabase.js";

// 临时字段探测函数：只读取 observations 前 3 条，不修改任何数据。
export async function debugObservationsFields() {
  const { data, error } = await supabase
    .from("observations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(3);

  if (error) {
    console.error("observations 字段探测失败：", error);
    return { data: [], fields: [], error };
  }

  const fields = [...new Set((data || []).flatMap((row) => Object.keys(row)))];
  console.log("observations 前 3 条完整数据：", data);
  console.log("observations 字段名：", fields);
  return { data, fields, error: null };
}

// 方便在浏览器控制台手动运行：window.debugObservationsFields()
window.debugObservationsFields = debugObservationsFields;
