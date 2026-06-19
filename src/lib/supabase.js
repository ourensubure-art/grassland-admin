import { createClient } from "@supabase/supabase-js";

// Supabase 配置来自环境变量；浏览器由 Vite 注入，Node 调试脚本由 node --env-file 注入。
const viteEnv = import.meta.env || {};
const nodeEnv = typeof process !== "undefined" ? process.env : {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || nodeEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY || nodeEnv.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("缺少 Supabase 环境变量，请检查 .env.local。");
}

// 全站共用的 Supabase 客户端。
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
