import { createClient } from "@supabase/supabase-js";

// Node 调试脚本：读取 .env.local 后探测 observations 字段，不修改任何数据。
const envText = await import("node:fs").then(({ readFileSync }) =>
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
);

const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    })
);

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { data, error } = await supabase
  .from("observations")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(3);

if (error) {
  console.error("observations 字段探测失败：", error);
  process.exitCode = 1;
} else {
  const fields = [...new Set((data || []).flatMap((row) => Object.keys(row)))];
  console.log("observations_fields=", JSON.stringify(fields, null, 2));
  console.log("observations_sample=", JSON.stringify(data, null, 2));
}
