import { supabase } from "./lib/supabase.js";
import * as echarts from "echarts";
import { predictNDVI, predict4Weeks } from "./utils/ndviPredict.js";
import { computeCapacityFromNDVI, evaluateOverstocking } from "./utils/carryingCapacity.js";
import { buildDecisionDraft } from "./utils/buildDecisionDraft.js";
import { createOrUpdateDecisionDraft, deleteDecisionDraft, fetchDecisionCounts, fetchDecisions, publishDecision } from "./utils/decisionApi.js";
import {
  formatDate,
  formatDateTimeShort,
  formatMetric,
  formatPercent,
  riskClass,
  riskLabel,
  statusClass,
  statusLabel
} from "./utils/decisionFormat.js";

const OBSERVATIONS_TABLE = "observations";
const NDVI_TABLE = "ndvi_weekly";
const LATEST_NDVI_VIEW = "v_latest_ndvi";
const PASTURE_QUANTILES_VIEW = "v_pasture_quantiles";
const DEFAULT_PASTURE_ID = "pasture_001";
const RANKING_PAGE_SIZE = 1000;
const RANKING_MAX_ROWS = 10000;

const $ = (sel) => document.querySelector(sel);
let currentPage = "decision";
const state = {
  observations: [],
  rankingRows: [],
  totals: {
    total: 0,
    today: 0,
    week: 0
  },
  ndvi: {
    initialized: false,
    loading: false,
    rows: [],
    pastures: [],
    selectedPastureId: ""
  },
  decisions: {
    loading: false,
    rows: [],
    statusFilter: "published",
    highlightedId: null
  }
};
let currentDecisionDraft = null;
let ndviChart = null;
let decisionChartInstance = null;
let latestCapacity = null;

function esc(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 从 description 开头的【位置】提取位置；没有前缀时标记为未知位置。
function parseDescription(rawDescription) {
  const description = String(rawDescription || "").trim();
  const match = description.match(/^【(.+?)】/);
  if (!match) return { location: "未知位置", pureDescription: description || "无文字描述" };
  const pureDescription = description.replace(/^【.+?】/, "").trim();
  return {
    location: match[1].trim() || "未知位置",
    pureDescription: pureDescription || "无文字描述"
  };
}

function normalizeObservation(row) {
  const parsed = parseDescription(row.description);
  return {
    id: row.id,
    user_id: row.user_id,
    pasture_id: row.pasture_id,
    photo_url: row.photo_url,
    description: row.description,
    pureDescription: parsed.pureDescription,
    location: parsed.location,
    latitude: row.latitude,
    longitude: row.longitude,
    created_at: row.created_at,
    reporter: row.user_id ? row.user_id : "匿名牧民"
  };
}

function todayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function weekStartIso() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function countRows(filterFromIso = null) {
  let query = supabase
    .from(OBSERVATIONS_TABLE)
    .select("id", { count: "exact", head: true });
  if (filterFromIso) query = query.gte("created_at", filterFromIso);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function fetchRecentRows() {
  const { data, error } = await supabase
    .from(OBSERVATIONS_TABLE)
    .select("id,user_id,pasture_id,photo_url,description,latitude,longitude,created_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data || []).map(normalizeObservation);
}

// 位置是从 description 前缀解析出来的，只能先拉取描述后在前端聚合。
async function fetchRankingRows() {
  const rows = [];
  for (let from = 0; from < RANKING_MAX_ROWS; from += RANKING_PAGE_SIZE) {
    const to = from + RANKING_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(OBSERVATIONS_TABLE)
      .select("id,description")
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < RANKING_PAGE_SIZE) break;
  }
  return rows;
}

async function loadDashboardData() {
  setLoading(true);
  setError("");
  try {
    const [total, today, week, recentRows, rankingRows] = await Promise.all([
      countRows(),
      countRows(todayStartIso()),
      countRows(weekStartIso()),
      fetchRecentRows(),
      fetchRankingRows()
    ]);

    state.totals = { total, today, week };
    state.observations = recentRows;
    state.rankingRows = rankingRows;
    renderOverview();
    setEmpty(total === 0);
  } catch (error) {
    console.error("读取 Supabase observations 失败：", error);
    setError("连接数据失败，请检查网络或 Supabase 权限后重试。");
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  $("#refreshBtn").disabled = isLoading;
  $("#refreshBtn").textContent = isLoading ? "刷新中..." : "刷新";
  $("#refreshBtn").classList.toggle("opacity-60", isLoading);
  $("#refreshBtn").classList.toggle("cursor-not-allowed", isLoading);

  if (!isLoading) return;
  $("#updatedAt").textContent = "正在读取真实数据...";
  $("#overviewStatus").className = "mb-5 rounded-lg bg-white p-4 shadow-panel";
  $("#overviewStatus").innerHTML = `
    <div class="flex items-center gap-3 text-sm font-bold text-slate-600">
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-grass-600 border-t-transparent"></span>
      正在连接 Supabase 并读取 observations...
    </div>`;
  $("#villageChart").innerHTML = skeletonRows(5);
  $("#recentList").innerHTML = skeletonRows(6);
}

function setError(message) {
  if (!message) {
    $("#overviewStatus").className = "mb-5 hidden";
    $("#overviewStatus").innerHTML = "";
    return;
  }
  $("#overviewStatus").className = "mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800";
  $("#overviewStatus").innerHTML = `
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <p class="font-bold">${esc(message)}</p>
      <button id="retryBtn" class="h-10 rounded-md bg-red-700 px-4 text-sm font-black text-white">重试</button>
    </div>`;
  $("#retryBtn").addEventListener("click", loadDashboardData);
}

function setEmpty(isEmpty) {
  if (!isEmpty) return;
  $("#overviewStatus").className = "mb-5 rounded-lg border border-slate-200 bg-white p-4 text-slate-600";
  $("#overviewStatus").innerHTML = `<p class="font-bold">当前还没有任何观察记录。牧民端上报后，点击刷新即可看到数据。</p>`;
}

function skeletonRows(count) {
  return Array.from({ length: count }, () => `
    <div class="animate-pulse rounded-md border border-slate-100 p-3">
      <div class="h-4 w-2/3 rounded bg-slate-200"></div>
      <div class="mt-3 h-8 rounded bg-slate-100"></div>
    </div>`).join("");
}

function spinnerHtml(text) {
  return `
    <div class="flex items-center gap-3 text-sm font-bold text-slate-600">
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-grass-600 border-t-transparent"></span>
      ${esc(text)}
    </div>`;
}

function showToast(message, type = "success") {
  let toast = $("#appToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "appToast";
    toast.className = "fixed right-5 top-20 z-[60] hidden rounded-lg px-4 py-3 text-sm font-black shadow-panel";
    document.body.appendChild(toast);
  }
  const classes = {
    success: "bg-grass-600 text-white",
    error: "bg-red-700 text-white",
    info: "bg-slate-900 text-white"
  };
  toast.className = `fixed right-5 top-20 z-[60] rounded-lg px-4 py-3 text-sm font-black shadow-panel ${classes[type] || classes.info}`;
  toast.textContent = message;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2600);
}

function renderOverview() {
  $("#totalCount").textContent = state.totals.total;
  $("#todayCount").textContent = state.totals.today;
  $("#weekCount").textContent = state.totals.week;
  $("#updatedAt").textContent = `更新时间：${formatDateTime(new Date().toISOString())}`;
  renderVillageChart();
  renderRecentList();
}

function isAdmin() {
  return localStorage.getItem("grassland_admin") === "true";
}

function applyAdminModeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("admin") === "1") {
    localStorage.setItem("grassland_admin", "true");
  }
}

function updateAdminUi() {
  const admin = isAdmin();
  $("#adminModeToggle").checked = admin;
  $("#generateDraftsBtn").classList.add("hidden");
  $("#decisionAdminBadge").textContent = admin ? "管理员模式" : "普通模式";
  $("#decisionAdminBadge").className = admin
    ? "rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white"
    : "rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600";
  $("#decisionsListHint").textContent = "草稿用于人工审核，已发布决策为只读记录。";
  renderDecisionFilterButtons();
}

async function initDecisionsTab() {
  await loadDecisionsList();
}

async function loadDecisionsList() {
  state.decisions.loading = true;
  setDecisionsLoading(true);
  setDecisionsError("");
  updateAdminUi();

  try {
    state.decisions.rows = await fetchDecisions({ status: state.decisions.statusFilter });
    renderDecisionsList();
    await renderDecisionCounts();
  } catch (error) {
    console.error("读取决策列表失败：", error);
    setDecisionsError("决策列表读取失败，请检查网络或 Supabase 权限后重试。");
  } finally {
    state.decisions.loading = false;
    setDecisionsLoading(false);
  }
}

async function renderDecisionCounts() {
  try {
    const counts = await fetchDecisionCounts();
    $("#decisionsCount").textContent = `${filteredDecisionRows().length} 条 · 草稿 ${counts.draft} / 已发布 ${counts.published}`;
  } catch (error) {
    console.warn("读取决策计数失败：", error);
    $("#decisionsCount").textContent = `${filteredDecisionRows().length} 条`;
  }
}

function setDecisionsLoading(isLoading) {
  $("#refreshDecisionsBtn").disabled = isLoading;
  $("#refreshDecisionsBtn").textContent = isLoading ? "读取中..." : "刷新列表";
  $("#refreshDecisionsBtn").classList.toggle("opacity-60", isLoading);
  $("#refreshDecisionsBtn").classList.toggle("cursor-not-allowed", isLoading);

  if (!isLoading) return;
  $("#decisionsStatus").className = "mb-5 rounded-lg bg-white p-4 shadow-panel";
  $("#decisionsStatus").innerHTML = spinnerHtml("正在读取决策发布数据...");
  $("#decisionsList").innerHTML = skeletonRows(4);
  $("#decisionsCount").textContent = "-- 条";
}

function setDecisionsError(message) {
  if (!message) {
    $("#decisionsStatus").className = "mb-5 hidden";
    $("#decisionsStatus").innerHTML = "";
    return;
  }
  $("#decisionsStatus").className = "mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800";
  $("#decisionsStatus").innerHTML = `
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <p class="font-bold">${esc(message)}</p>
      <button id="decisionsRetryBtn" class="h-10 rounded-md bg-red-700 px-4 text-sm font-black text-white">重试</button>
    </div>`;
  $("#decisionsRetryBtn").addEventListener("click", loadDecisionsList);
}

function renderDecisionsList() {
  renderDecisionFilterButtons();
  const rows = state.decisions.rows;
  $("#decisionsCount").textContent = `${rows.length} 条`;

  if (!rows.length) {
    $("#decisionsList").innerHTML = `<p class="rounded-md bg-slate-50 p-5 text-sm font-bold text-slate-500">暂无可查看的决策。</p>`;
    return;
  }

  $("#decisionsList").innerHTML = rows.map((decision) => {
    const isDraft = decision.status === "draft";
    const cardClass = isDraft
      ? "border-dashed border-slate-300 bg-white hover:border-slate-500"
      : "border-grass-300 bg-white hover:border-grass-600";
    const highlightClass = String(decision.id) === String(state.decisions.highlightedId) ? "ring-4 ring-amber-300 animate-pulse" : "";
    return `
    <article class="rounded-lg border p-4 transition ${cardClass} ${highlightClass}" data-decision-id="${esc(decision.id)}">
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div class="min-w-0">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            ${pillHtml(statusLabel(decision.status), statusClass(decision.status))}
            ${pillHtml(riskLabel(decision.risk_level), riskClass(decision.risk_level))}
          </div>
          <h4 class="text-lg font-black leading-7 text-slate-950">${esc(decision.title)}</h4>
          <p class="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">${esc(decision.reason || "暂无理由")}</p>
        </div>
        <div class="shrink-0 space-y-2 text-right">
          <div class="rounded-md bg-slate-50 px-3 py-2">
            <p class="text-xs font-black text-slate-500">牧场</p>
            <p class="mt-1 text-sm font-black text-slate-900">${esc(decision.pasture_id)}</p>
          </div>
          ${isDraft ? `
            <div class="flex justify-end gap-2">
              <button class="h-9 rounded-md border border-slate-300 px-3 text-xs font-black text-slate-500" type="button" disabled>✏️ 编辑</button>
              <button class="discard-draft-btn h-9 rounded-md border border-red-200 px-3 text-xs font-black text-red-700 hover:bg-red-50" data-discard-decision-id="${esc(decision.id)}">🗑 丢弃草稿</button>
              <button class="publish-decision-btn h-9 rounded-md bg-grass-600 px-3 text-xs font-black text-white hover:bg-grass-700" data-publish-decision-id="${esc(decision.id)}">✅ 审核并发布</button>
            </div>` : ""}
        </div>
      </div>
      <div class="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm md:grid-cols-5">
        ${decisionStatHtml("执行日期", `${formatDate(decision.start_date)} 至 ${formatDate(decision.end_date)}`)}
        ${decisionStatHtml("当前 NDVI", formatMetric(decision.ndvi_current))}
        ${decisionStatHtml("预测 NDVI", formatMetric(decision.ndvi_forecast))}
        ${decisionStatHtml("本地等级", decision.local_level || "--")}
        ${decisionStatHtml("趋势", decision.trend || "--")}
        ${decisionStatHtml("置信度", formatPercent(decision.confidence))}
      </div>
      <div class="mt-4 grid gap-3 text-sm md:grid-cols-2">
        ${decisionStatHtml("建议休牧天数", `${Number(decision.rest_days || 0)} 天`)}
        ${decisionStatHtml(isDraft ? "生成时间" : "发布时间", isDraft ? formatDateTimeShort(decision.created_at) : formatDateTimeShort(decision.published_at))}
      </div>
    </article>
  `;
  }).join("");

  document.querySelectorAll("[data-decision-id]").forEach((card) => {
    card.addEventListener("click", () => {
      console.log("待打开决策详情：", card.dataset.decisionId);
    });
  });
  document.querySelectorAll("[data-publish-decision-id]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await handlePublishDecision(btn.dataset.publishDecisionId);
    });
  });
  document.querySelectorAll("[data-discard-decision-id]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await handleDiscardDraft(btn.dataset.discardDecisionId);
    });
  });
}

function filteredDecisionRows() {
  return state.decisions.rows;
}

function renderDecisionFilterButtons() {
  document.querySelectorAll("[data-decision-status-filter]").forEach((btn) => {
    const filter = btn.dataset.decisionStatusFilter;
    const active = state.decisions.statusFilter === filter;
    btn.disabled = false;
    btn.classList.toggle("bg-white", active);
    btn.classList.toggle("text-slate-950", active);
    btn.classList.toggle("shadow-sm", active);
    btn.classList.toggle("text-slate-500", !active);
    btn.classList.toggle("cursor-not-allowed", btn.disabled);
    btn.classList.toggle("opacity-40", btn.disabled);
  });
}

async function handleGenerateDrafts() {
  $("#generateDraftsBtn").disabled = true;
  $("#generateDraftsBtn").textContent = "生成中...";
  setDecisionsError("");
  try {
    await loadPastures();
    const pastureIds = state.ndvi.pastures.length
      ? state.ndvi.pastures.map((pasture) => pasture.id)
      : [state.ndvi.selectedPastureId || DEFAULT_PASTURE_ID];
    const results = [];

    for (const pastureId of pastureIds) {
      const { latest, q, history } = await loadDecisionData(pastureId);
      if (!latest || !q) continue;
      const predictedNdvi = predict4Weeks(history) ?? Number(latest.ndvi_mean);
      const draft = buildDecisionDraft({ pastureId, latest, q, history, predictedNdvi });
      results.push(await createOrUpdateDecisionDraft({ draft }));
    }

    state.decisions.statusFilter = "draft";
    state.decisions.highlightedId = results[0]?.decision?.id || null;
    await loadDecisionsList();
    $("#decisionsStatus").className = "mb-5 rounded-lg border border-grass-200 bg-grass-50 p-4 text-grass-800";
    $("#decisionsStatus").innerHTML = `<p class="font-black">已生成 ${results.length} 条草稿；重复生成会覆盖同牧场现有草稿。</p>`;
    showToast("草稿已生成，请前往决策发布页审核");
    setTimeout(() => {
      state.decisions.highlightedId = null;
      if (currentPage === "decisions") renderDecisionsList();
    }, 2000);
  } catch (error) {
    console.error("生成决策草稿失败：", error);
    setDecisionsError(`生成草稿失败：${error.message || "请检查 Supabase 写入权限"}`);
  } finally {
    $("#generateDraftsBtn").disabled = false;
    $("#generateDraftsBtn").textContent = "生成草稿";
  }
}

async function handleCreateDraftFromOverview() {
  if (!currentDecisionDraft) {
    showToast("暂无可生成的决策草稿", "error");
    return;
  }

  const btn = $("#createDecisionDraftBtn");
  btn.disabled = true;
  btn.textContent = "生成中...";
  try {
    const result = await createOrUpdateDecisionDraft({ draft: currentDecisionDraft });
    state.decisions.statusFilter = "draft";
    state.decisions.highlightedId = result.decision?.id || null;
    showToast("草稿已生成，请前往决策发布页审核");
    switchPage("decisions");
    setTimeout(() => {
      state.decisions.highlightedId = null;
      if (currentPage === "decisions") renderDecisionsList();
    }, 2000);
  } catch (error) {
    console.error("生成决策草稿失败：", error);
    showToast(`草稿生成失败：${error.message || "请检查 decisions 表和写入权限"}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📝 生成决策草稿";
  }
}

async function handlePublishDecision(decisionId) {
  if (!window.confirm("确认发布这条决策吗？发布后会移动到已发布列表。")) return;
  try {
    await publishDecision({ decisionId });
    state.decisions.statusFilter = "published";
    await loadDecisionsList();
    showToast("已发布");
  } catch (error) {
    console.error("发布决策失败：", error);
    setDecisionsError(`发布失败：${error.message || "请检查 Supabase 更新权限"}`);
    showToast("发布失败", "error");
  }
}

async function handleDiscardDraft(decisionId) {
  if (!window.confirm("确认丢弃这条草稿吗？此操作不可恢复。")) return;
  try {
    await deleteDecisionDraft(decisionId);
    await loadDecisionsList();
    showToast("草稿已丢弃");
  } catch (error) {
    console.error("丢弃草稿失败：", error);
    setDecisionsError(`丢弃失败：${error.message || "请检查 Supabase 删除权限"}`);
    showToast("丢弃失败", "error");
  }
}

function pillHtml(label, classes) {
  return `<span class="inline-flex rounded-full border px-3 py-1 text-xs font-black ${classes}">${esc(label)}</span>`;
}

function decisionStatHtml(label, value) {
  return `
    <div class="rounded-md bg-slate-50 p-3">
      <p class="text-xs font-black text-slate-500">${esc(label)}</p>
      <p class="mt-1 font-black text-slate-900">${esc(value)}</p>
    </div>`;
}

async function initDecisionTab() {
  renderDecisionLoading();
  try {
    const selectedPastureId = await ensureSelectedPastureId();
    const { latest, q, history } = await loadDecisionData(selectedPastureId);
    if (!latest || !q) {
      renderDecisionEmpty();
      return;
    }

    const currentNDVI = latest.ndvi_mean == null ? null : Number(latest.ndvi_mean);
    const predictions = predictNDVI(history, 4);
    const predictedNDVI = predict4Weeks(history) ?? currentNDVI;
    const draft = buildDecisionDraft({ pastureId: selectedPastureId, latest, q, history, predictedNdvi: predictedNDVI });
    currentDecisionDraft = draft;
    const decision = draft.decision;

    renderDecisionMainCard(decision);
    renderDecisionMetrics(currentNDVI, predictedNDVI, decision.trendValue || 0, decision);
    renderCapacityCard(currentNDVI);
    renderMiniChart(history, predictions, decision);
    renderTriggers(decision.triggers);
    $("#goToNdviBtn").onclick = () => switchPage("ndvi");
    $("#createDecisionDraftBtn").onclick = handleCreateDraftFromOverview;
  } catch (error) {
    console.error("读取决策总览 NDVI 数据失败：", error);
    renderDecisionError();
  }
}

async function ensureSelectedPastureId() {
  if (!state.ndvi.selectedPastureId) await loadPastures();
  return state.ndvi.selectedPastureId || DEFAULT_PASTURE_ID;
}

async function loadDecisionData(selectedPastureId) {
  // ✅ 绕过坏视图 v_latest_ndvi，直接从原表取最新一周
const { data: latest, error: latestError } = await supabase
  .from(NDVI_TABLE)                          // 用原表
  .select("*")
  .eq("pasture_id", selectedPastureId)
  .not("ndvi_mean", "is", null)              // 排除空值
  .order("week_start", { ascending: false }) // 按周倒序
  .limit(1)                                   // 只要最新一行
  .maybeSingle();
if (latestError) throw latestError;
if (!latest) return { latest: null, q: null, history: [] };

  // ✅ 分位数查询单独做，失败也不影响 history
let q = null;
try {
  const { data: qData, error: qError } = await supabase
    .from(PASTURE_QUANTILES_VIEW)
    .select("*")
    .eq("pasture_id", selectedPastureId)
    .eq("week_of_year", latest.week_of_year)
    .maybeSingle();
  if (qError) {
    console.warn("分位数视图查询失败，跳过：", qError.message);
  } else {
    q = qData;
  }
} catch (e) {
  console.warn("分位数视图异常，跳过：", e);
}

// ✅ 历史数据单独查（这个本身没问题）
const { data: history, error: historyError } = await supabase
  .from(NDVI_TABLE)
  .select("week_start,week_end,year,week_of_year,doy,ndvi_mean,ndvi_std")
  .eq("pasture_id", selectedPastureId)
  .not("ndvi_mean", "is", null)
  .order("week_start", { ascending: true });

if (historyError) throw historyError;
return { latest, q, history: history || [] };
}

function renderDecisionLoading() {
  $("#decisionMainCard").className = "rounded-xl shadow-md p-6 mb-6 transition-all bg-white";
  $("#decisionMainCard").innerHTML = spinnerHtml("正在读取 NDVI 数据并生成放牧建议...");
  $("#metricCurrentNDVI").textContent = "--";
  $("#metricCurrentLabel").textContent = "--";
  $("#metricPredictedNDVI").textContent = "--";
  $("#metricTrend").textContent = "--";
  $("#metricRiskLevel").textContent = "--";
  $("#metricRiskLevel").className = "text-3xl font-bold";
  $("#metricConfidence").textContent = "--";
  $("#metricConfidenceBar").style.width = "0%";
  resetCapacityCard();
  $("#decisionMiniChart").innerHTML = `<div class="grid h-full place-items-center rounded-md bg-slate-50">${spinnerHtml("正在准备预测图...")}</div>`;
  $("#decisionTriggers").innerHTML = "";
}

function renderDecisionEmpty() {
  $("#decisionMainCard").className = "rounded-xl shadow-md p-6 mb-6 transition-all bg-white";
  $("#decisionMainCard").innerHTML = `<p class="text-gray-500">暂无 NDVI 数据，暂时无法生成放牧建议。</p>`;
}

function renderDecisionError() {
  $("#decisionMainCard").className = "rounded-xl shadow-md p-6 mb-6 transition-all bg-red-50 border border-red-200";
  $("#decisionMainCard").innerHTML = `<p class="font-bold text-red-700">决策数据读取失败，请检查网络或 Supabase 权限后重试。</p>`;
}

function resetCapacityCard() {
  latestCapacity = null;
  $("#capacityAgb").textContent = "-- kg/ha";
  $("#capacityUsableAgb").textContent = "-- kg/ha";
  $("#capacityMonthly").textContent = "-- 羊单位/月";
  $("#overstockRatio").textContent = "--";
  $("#overstockMessage").textContent = "--";
  $("#capacityStatusBadge").textContent = "待计算";
  $("#capacityStatusBadge").className = "rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600";
}

function renderCapacityCard(ndvi) {
  latestCapacity = computeCapacityFromNDVI(ndvi);
  $("#capacityAgb").textContent = `${latestCapacity.agb} kg/ha`;
  $("#capacityUsableAgb").textContent = `${latestCapacity.usableAGB} kg/ha`;
  $("#capacityMonthly").textContent = `${latestCapacity.monthlyCapacity} 羊单位/月`;
  renderOverstocking();
}

function renderOverstocking() {
  if (!latestCapacity) return;
  const actualStocking = Number($("#actualStockingInput").value || 0);
  const theoreticalCapacity = Number(latestCapacity.monthlyCapacity);
  const result = evaluateOverstocking(actualStocking, theoreticalCapacity);
  const styles = {
    healthy: {
      text: "text-green-700",
      badge: "rounded-full bg-green-100 px-3 py-1 text-xs font-black text-green-800",
      label: "合理"
    },
    warning: {
      text: "text-orange-700",
      badge: "rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-800",
      label: "超载"
    },
    critical: {
      text: "text-red-700",
      badge: "rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-800",
      label: "严重"
    },
    underused: {
      text: "text-blue-700",
      badge: "rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-800",
      label: "偏低"
    }
  };
  const style = styles[result.status];
  $("#overstockRatio").textContent = Number.isFinite(result.ratio) ? `${Math.round(result.ratio * 100)}%` : "∞";
  $("#overstockRatio").className = `text-2xl font-black ${style.text}`;
  $("#overstockMessage").textContent = result.message;
  $("#overstockMessage").className = `text-base font-black ${style.text}`;
  $("#capacityStatusBadge").textContent = style.label;
  $("#capacityStatusBadge").className = style.badge;
}

function renderDecisionMainCard(decision) {
  const card = $("#decisionMainCard");
  const config = {
    rest: { bg: "bg-gradient-to-r from-red-100 to-red-200", icon: "🚨", text: "建议谨慎", textColor: "text-red-800" },
    observe: { bg: "bg-gradient-to-r from-yellow-100 to-yellow-200", icon: "⚠️", text: "注意观察", textColor: "text-yellow-800" },
    continue: { bg: "bg-gradient-to-r from-green-100 to-green-200", icon: "✅", text: "可继续放牧", textColor: "text-green-800" }
  };
  const c = config[decision.action];
  card.className = `rounded-xl shadow-md p-6 mb-6 transition-all ${c.bg}`;
  card.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-4">
      <div class="flex items-center gap-4">
        <div class="text-5xl">${c.icon}</div>
        <div>
          <div class="text-2xl font-bold ${c.textColor}">${c.text}</div>
          <div class="text-sm ${c.textColor} opacity-75 mt-1">基于 NDVI 趋势分析的智能决策</div>
        </div>
      </div>
      ${decision.restDays > 0 ? `
        <div class="text-right">
          <div class="text-4xl font-bold ${c.textColor}">${decision.restDays}<span class="text-lg ml-1">天</span></div>
          <div class="text-sm ${c.textColor} opacity-75">建议休牧</div>
        </div>
      ` : ""}
      <button id="createDecisionDraftBtn" class="h-10 rounded-md border border-red-600 bg-white px-4 text-sm font-black text-red-700 hover:bg-red-50">📝 生成决策草稿</button>
    </div>
    <p class="mt-4 ${c.textColor} text-sm leading-relaxed">${esc(decision.reason)}</p>
  `;
}

function renderDecisionMetrics(current, predicted, slope, decision) {
  $("#metricCurrentNDVI").textContent = formatNdvi(current);
  const labelEl = $("#metricCurrentLabel");
  labelEl.textContent = `本地等级：${decision.health.label}`;
  labelEl.className = "text-xs mt-1 font-semibold";
  labelEl.style.color = decision.health.color;

  $("#metricPredictedNDVI").textContent = formatNdvi(predicted);
  const trendIcon = slope > 0.01 ? "↑ 上升" : slope < -0.01 ? "↓ 下降" : "→ 平稳";
  const trendColor = slope > 0.01 ? "text-green-600" : slope < -0.01 ? "text-red-600" : "text-gray-600";
  const trendEl = $("#metricTrend");
  trendEl.textContent = trendIcon;
  trendEl.className = `text-xs mt-1 font-semibold ${trendColor}`;

  const riskMap = {
    high: { text: "高", color: "text-red-600" },
    medium: { text: "中", color: "text-yellow-600" },
    low: { text: "低", color: "text-green-600" }
  };
  const risk = riskMap[decision.level] || { text: "无", color: "text-slate-500" };
  const riskEl = $("#metricRiskLevel");
  riskEl.textContent = risk.text;
  riskEl.className = `text-3xl font-bold ${risk.color}`;

  const confPct = Math.round(decision.confidence * 100);
  $("#metricConfidence").textContent = `${confPct}%`;
  $("#metricConfidenceBar").style.width = `${confPct}%`;
}

function renderMiniChart(history, predictions, decision) {
  const el = $("#decisionMiniChart");
  if (decisionChartInstance) decisionChartInstance.dispose();
  decisionChartInstance = echarts.init(el);

  const recentHistory = history.slice(-8);
  const histData = recentHistory.map((d) => [d.week_start, Number(d.ndvi_mean)]);
  const predData = predictions.map((d) => [d.week_start, Number(d.ndvi_predicted)]);
  if (histData.length > 0) predData.unshift(histData[histData.length - 1]);
  const q = decision.baselines;

  decisionChartInstance.setOption({
    grid: { left: 40, right: 20, top: 30, bottom: 30 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "time" },
    yAxis: { type: "value", min: 0, max: 0.7 },
    series: [
      {
        name: "历史 NDVI",
        type: "line",
        data: histData,
        smooth: true,
        itemStyle: { color: "#10b981" },
        lineStyle: { width: 2 },
        markLine: {
          silent: true,
          symbol: "none",
          data: [
            { yAxis: q.p75, lineStyle: { color: "#16a34a", type: "dashed", opacity: 0.6 }, label: { formatter: `本地 P75 ${Number(q.p75).toFixed(2)}`, position: "insideEndTop" } },
            { yAxis: q.p50, lineStyle: { color: "#ca8a04", type: "dashed", opacity: 0.6 }, label: { formatter: `本地 P50 ${Number(q.p50).toFixed(2)}`, position: "insideEndTop" } },
            { yAxis: q.p25, lineStyle: { color: "#dc2626", type: "dashed", opacity: 0.6 }, label: { formatter: `本地 P25 ${Number(q.p25).toFixed(2)}`, position: "insideEndTop" } }
          ]
        }
      },
      {
        name: "预测 NDVI",
        type: "line",
        data: predData,
        smooth: true,
        itemStyle: { color: "#f59e0b" },
        lineStyle: { width: 2, type: "dashed" }
      }
    ]
  });
}

function renderTriggers(triggers) {
  $("#decisionTriggers").innerHTML = triggers.map((trigger) => `
    <li class="flex items-start gap-2 text-gray-700">
      <span class="text-green-500 font-bold">✓</span>
      <span>${esc(trigger)}</span>
    </li>
  `).join("");
}

async function initNdviTab() {
  if (state.ndvi.initialized || state.ndvi.loading) {
    resizeNdviChart();
    return;
  }
  state.ndvi.loading = true;
  setNdviLoading(true);
  setNdviError("");

  try {
    await loadPastures();
    state.ndvi.rows = state.ndvi.selectedPastureId ? await loadNdviRows(state.ndvi.selectedPastureId) : [];
    state.ndvi.initialized = true;
    renderNdviPastureSelect();
    renderSelectedNdvi();
  } catch (error) {
    console.error("读取 Supabase ndvi_weekly 失败：", error);
    setNdviError("NDVI 数据读取失败，请检查网络或 Supabase 权限后重试。");
  } finally {
    state.ndvi.loading = false;
    setNdviLoading(false);
  }
}

async function loadPastures() {
  const { data, error } = await supabase
    .from(NDVI_TABLE)
    .select("pasture_id")
    .not("pasture_id", "is", null);

  if (error) {
    console.error("读取牧场列表失败：", error);
    state.ndvi.pastures = [];
    return;
  }

  const uniqueIds = [...new Set((data || []).map((row) => row.pasture_id).filter(Boolean))].sort();
  state.ndvi.pastures = uniqueIds.map((id) => ({
    id,
    name: `牧场 ${id}`
  }));

  // 只有一个牧场时自动选中；多个牧场时默认选第一个，后续由下拉框切换。
  if (uniqueIds.length > 0 && (!state.ndvi.selectedPastureId || !uniqueIds.includes(state.ndvi.selectedPastureId))) {
    state.ndvi.selectedPastureId = uniqueIds[0];
  }
}

async function loadNdviRows(pastureId) {
  const { data, error } = await supabase
    .from(NDVI_TABLE)
    .select("pasture_id,week_start,week_end,year,week_of_year,doy,ndvi_mean,ndvi_std,pixel_count,image_count,created_at")
    .eq("pasture_id", pastureId)
    .not("ndvi_mean", "is", null)
    .order("week_start", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function reloadNdviTab() {
  state.ndvi.initialized = false;
  state.ndvi.rows = [];
  state.ndvi.pastures = [];
  await initNdviTab();
}

function setNdviLoading(isLoading) {
  if (!isLoading) return;
  $("#ndviUpdatedAt").textContent = "正在读取 NDVI 数据...";
  $("#ndviStatus").className = "mb-5 rounded-lg bg-white p-4 shadow-panel";
  $("#ndviStatus").innerHTML = spinnerHtml("正在连接 Supabase 并读取 ndvi_weekly...");
  resetNdviKpis();
  $("#ndviChart").innerHTML = `
    <div class="grid h-full place-items-center rounded-md bg-slate-50">
      ${spinnerHtml("正在准备趋势图...")}
    </div>`;
  $("#ndviRanking").innerHTML = skeletonRows(4);
  $("#ndviTableBody").innerHTML = ndviTableSkeletonRows();
}

function setNdviError(message) {
  if (!message) {
    $("#ndviStatus").className = "mb-5 hidden";
    $("#ndviStatus").innerHTML = "";
    return;
  }
  $("#ndviStatus").className = "mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800";
  $("#ndviStatus").innerHTML = `
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <p class="font-bold">${esc(message)}</p>
      <button id="ndviRetryBtn" class="h-10 rounded-md bg-red-700 px-4 text-sm font-black text-white">重试</button>
    </div>`;
  $("#ndviRetryBtn").addEventListener("click", () => {
    state.ndvi.initialized = false;
    initNdviTab();
  });
}

function resetNdviKpis() {
  $("#ndviCurrent").textContent = "--";
  $("#ndviChange").textContent = "--";
  $("#ndviChange").className = "mt-3 block text-4xl font-black tracking-normal text-slate-950";
  $("#ndviAverage").textContent = "--";
  $("#ndviHealth").innerHTML = `<span class="inline-flex rounded-full bg-slate-100 px-4 py-2 text-sm font-black text-slate-500">暂无</span>`;
}

function renderNdviPastureSelect() {
  const select = $("#ndviPastureSelect");
  select.innerHTML = state.ndvi.pastures.length
    ? state.ndvi.pastures.map((pasture) => `<option value="${esc(pasture.id)}">${esc(pasture.name)}</option>`).join("")
    : `<option value="">暂无牧场</option>`;
  select.value = state.ndvi.selectedPastureId;
  select.disabled = state.ndvi.pastures.length <= 1;
  select.classList.toggle("cursor-not-allowed", select.disabled);
  select.classList.toggle("opacity-70", select.disabled);
}

function selectedNdviRows() {
  return state.ndvi.rows
    .filter((row) => row.pasture_id === state.ndvi.selectedPastureId)
    .sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
}

function renderSelectedNdvi() {
  const rows = selectedNdviRows();
  $("#ndviUpdatedAt").textContent = `更新时间：${formatDateTime(new Date().toISOString())}`;

  if (!rows.length) {
    resetNdviKpis();
    $("#ndviStatus").className = "mb-5 rounded-lg border border-slate-200 bg-white p-4 text-slate-600";
    $("#ndviStatus").innerHTML = `<p class="font-bold">当前牧场暂无 NDVI 数据。</p>`;
    $("#ndviChart").innerHTML = `<div class="grid h-full place-items-center rounded-md bg-slate-50 text-sm font-bold text-slate-500">暂无趋势数据</div>`;
    $("#ndviTableBody").innerHTML = `<tr><td colspan="4" class="px-5 py-6 text-center font-bold text-slate-500">暂无明细数据</td></tr>`;
    return;
  }

  setNdviError("");
  renderNdviKpis(rows);
  renderNdviChart(rows);
  renderNdviRanking();
  renderNdviTable(rows);
  resizeNdviChart();
}

function renderNdviKpis(rows) {
  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  const current = Number(latest.ndvi_mean);
  const previousValue = previous ? Number(previous.ndvi_mean) : null;
  const change = previousValue == null ? null : current - previousValue;
  const average = rows.reduce((sum, row) => sum + Number(row.ndvi_mean || 0), 0) / rows.length;

  $("#ndviCurrent").textContent = formatNdvi(current);
  $("#ndviAverage").textContent = formatNdvi(average);
  if (change == null) {
    $("#ndviChange").textContent = "--";
    $("#ndviChange").className = "mt-3 block text-4xl font-black tracking-normal text-slate-950";
  } else {
    const rising = change >= 0;
    $("#ndviChange").textContent = `${rising ? "↑" : "↓"} ${Math.abs(change).toFixed(3)}`;
    $("#ndviChange").className = `mt-3 block text-4xl font-black tracking-normal ${rising ? "text-grass-700" : "text-red-700"}`;
  }
  $("#ndviHealth").innerHTML = healthBadge(current);
}

function healthBadge(value) {
  const level = ndviHealthLevel(value);
  const styles = {
    优: "bg-grass-100 text-grass-800",
    良: "bg-sky-100 text-sky-800",
    中: "bg-amber-100 text-amber-800",
    差: "bg-red-100 text-red-800",
    无数据: "bg-slate-100 text-slate-500"
  };
  return `<span class="inline-flex rounded-full px-4 py-2 text-sm font-black ${styles[level]}">${level}</span>`;
}

function ndviHealthLevel(value) {
  const rows = selectedNdviRows();
  const values = rows.map((row) => Number(row.ndvi_mean)).filter((item) => Number.isFinite(item)).sort((a, b) => a - b);
  if (!values.length) return "无数据";
  const p = (ratio) => {
    const index = (values.length - 1) * ratio;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    return low === high ? values[low] : values[low] + (index - low) * (values[high] - values[low]);
  };
  if (value >= p(0.75)) return "优";
  if (value >= p(0.5)) return "良";
  if (value >= p(0.25)) return "中";
  return "差";
}

function formatNdvi(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(3) : "--";
}

function renderNdviChart(data) {
  const chartEl = $("#ndviChart");
  if (!ndviChart) {
    ndviChart = echarts.init(chartEl);
    window.addEventListener("resize", resizeNdviChart);
  }

  const realPoints = data.map((row) => [row.week_start, Number(row.ndvi_mean), row]);

  ndviChart.setOption({
    color: ["#064e3b", "#16a34a"],
    tooltip: {
      trigger: "axis",
      formatter(params) {
        const weekStart = params[0]?.axisValue;
        const row = data.find((item) => item.week_start === weekStart) || data[params[0]?.dataIndex || 0];
        return [
          `<b>${esc(row.week_start)} 至 ${esc(row.week_end)}</b>`,
          `NDVI：${formatNdvi(row.ndvi_mean)}`
        ].join("<br>");
      }
    },
    legend: {
      top: 0,
      data: ["有效观测点"]
    },
    grid: {
      left: 48,
      right: 24,
      top: 48,
      bottom: 74
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: data.map((row) => row.week_start),
      axisLabel: {
        color: "#64748b"
      },
      axisLine: {
        lineStyle: { color: "#cbd5e1" }
      }
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 1,
      axisLabel: {
        color: "#64748b",
        formatter: (value) => Number(value).toFixed(1)
      },
      splitLine: {
        lineStyle: { color: "#e2e8f0" }
      }
    },
    dataZoom: [
      { type: "inside", start: 0, end: 100 },
      { type: "slider", height: 24, bottom: 24, start: 0, end: 100 }
    ],
    series: [
      {
        name: "NDVI",
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 3, color: "#16a34a" },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(22, 163, 74, 0.28)" },
            { offset: 1, color: "rgba(22, 163, 74, 0.02)" }
          ])
        },
        data: data.map((row) => Number(row.ndvi_mean))
      },
      {
        name: "有效观测点",
        type: "scatter",
        symbol: "circle",
        symbolSize: 9,
        itemStyle: { color: "#064e3b" },
        data: realPoints
      }
    ]
  }, true);
}

function renderNdviRanking() {
  const latestByPasture = new Map();
  for (const row of state.ndvi.rows) {
    const current = latestByPasture.get(row.pasture_id);
    if (!current || String(row.week_start).localeCompare(String(current.week_start)) > 0) {
      latestByPasture.set(row.pasture_id, row);
    }
  }

  const rows = [...latestByPasture.values()]
    .sort((a, b) => Number(b.ndvi_mean) - Number(a.ndvi_mean));
  const max = Math.max(1, ...rows.map((row) => Number(row.ndvi_mean)));

  $("#ndviRanking").innerHTML = rows.length ? rows.map((row) => {
    const width = Math.max(8, Math.round((Number(row.ndvi_mean) / max) * 100));
    return `
      <div>
        <div class="mb-2 flex items-center justify-between gap-3 text-sm">
          <span class="font-black text-slate-700">${esc(row.pasture_id)}</span>
          <span class="font-black text-slate-950">${formatNdvi(row.ndvi_mean)}</span>
        </div>
        <div class="h-8 overflow-hidden rounded-md bg-slate-100">
          <div class="grid h-full place-items-end rounded-md bg-gradient-to-r from-grass-600 to-sky-500 pr-3 text-right text-xs font-black text-white" style="width:${width}%">${ndviHealthLevel(Number(row.ndvi_mean))}</div>
        </div>
      </div>`;
  }).join("") : `<p class="rounded-md bg-slate-50 p-4 text-sm font-bold text-slate-500">暂无牧场对比数据</p>`;
}

function resizeNdviChart() {
  if (ndviChart && !$("#ndviPage").classList.contains("hidden")) {
    ndviChart.resize();
  }
}

function renderNdviTable(rows) {
  const descRows = [...rows].sort((a, b) => String(b.week_start).localeCompare(String(a.week_start)));
  $("#ndviTableBody").innerHTML = descRows.map((row) => `
    <tr class="hover:bg-slate-50">
      <td class="px-5 py-3 font-bold text-slate-900">${esc(row.week_start)}</td>
      <td class="px-5 py-3 text-slate-700">${esc(row.week_end)}</td>
      <td class="px-5 py-3 text-slate-700">${row.ndvi_mean == null ? "空" : formatNdvi(row.ndvi_mean)}</td>
      <td class="px-5 py-3 text-slate-700">${row.ndvi_std == null ? "空" : formatNdvi(row.ndvi_std)}</td>
    </tr>`).join("");
}

function ndviTableSkeletonRows() {
  return Array.from({ length: 6 }, () => `
    <tr class="animate-pulse">
      <td class="px-5 py-3"><div class="h-4 rounded bg-slate-100"></div></td>
      <td class="px-5 py-3"><div class="h-4 rounded bg-slate-100"></div></td>
      <td class="px-5 py-3"><div class="h-4 rounded bg-slate-100"></div></td>
      <td class="px-5 py-3"><div class="h-4 rounded bg-slate-100"></div></td>
    </tr>`).join("");
}

function renderVillageChart() {
  const counts = state.rankingRows.reduce((map, row) => {
    const { location } = parseDescription(row.description);
    map[location] = (map[location] || 0) + 1;
    return map;
  }, {});
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map((x) => x[1]));
  $("#villageChart").innerHTML = rows.length ? rows.map(([name, count]) => {
    const width = Math.max(8, Math.round((count / max) * 100));
    return `
      <div>
        <div class="mb-2 flex items-center justify-between gap-3 text-sm">
          <span class="font-black text-slate-700">${esc(name)}</span>
          <span class="font-black text-slate-950">${count}</span>
        </div>
        <div class="h-8 overflow-hidden rounded-md bg-slate-100">
          <div class="grid h-full place-items-end rounded-md bg-gradient-to-r from-grass-600 to-sky-500 pr-3 text-right text-xs font-black text-white" style="width:${width}%">${count}</div>
        </div>
      </div>`;
  }).join("") : `<p class="rounded-md bg-slate-50 p-4 text-sm font-bold text-slate-500">暂无上报排行数据</p>`;
}

function renderRecentList() {
  $("#recentList").innerHTML = state.observations.length ? state.observations.map((item) => `
    <article class="grid cursor-pointer grid-cols-[72px_1fr] gap-3 rounded-md border border-slate-200 p-3 hover:border-grass-500 hover:bg-grass-50" data-observation-id="${esc(item.id)}">
      ${thumbHtml(item)}
      <div class="min-w-0">
        <div class="flex items-start justify-between gap-3">
          <b class="truncate text-sm text-slate-950">${esc(item.location)}</b>
          <span class="shrink-0 text-xs font-bold text-slate-500">${relativeTime(item.created_at)}</span>
        </div>
        <p class="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">${esc(truncateText(item.pureDescription, 30))}</p>
        <p class="mt-2 text-xs font-bold text-slate-500">上报人：${esc(item.reporter)}</p>
      </div>
    </article>`).join("") : `<p class="rounded-md bg-slate-50 p-4 text-sm font-bold text-slate-500">暂无观察记录</p>`;

  document.querySelectorAll("[data-observation-id]").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.observationId));
  });
}

function thumbHtml(item) {
  if (!item.photo_url) {
    return `<div class="grid h-[72px] w-[72px] place-items-center rounded-md bg-slate-100 text-xs font-black text-slate-400">无图</div>`;
  }
  return `
    <div class="relative h-[72px] w-[72px] overflow-hidden rounded-md bg-slate-100">
      <img class="h-full w-full object-cover" src="${esc(item.photo_url)}" alt="观察照片" loading="lazy" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden');">
      <div class="hidden grid h-full w-full place-items-center text-center text-[11px] font-black leading-4 text-slate-400">图片<br>加载失败</div>
    </div>`;
}

function openDetail(id) {
  const item = state.observations.find((x) => String(x.id) === String(id));
  if (!item) return;
  $("#detailContent").innerHTML = `
    <div class="grid gap-5 md:grid-cols-[1fr_320px]">
      <div class="overflow-hidden rounded-lg bg-slate-100">
        ${detailImageHtml(item)}
      </div>
      <div class="space-y-4">
        ${detailRow("位置", item.location)}
        ${detailRow("上报人", item.reporter)}
        ${detailRow("时间", formatDateTime(item.created_at))}
        <div>
          <p class="text-sm font-black text-slate-500">描述</p>
          <p class="mt-2 rounded-md bg-slate-50 p-3 leading-7 text-slate-800">${esc(item.pureDescription)}</p>
        </div>
      </div>
    </div>`;
  $("#detailModal").classList.remove("hidden");
  $("#detailModal").classList.add("flex");
}

function detailImageHtml(item) {
  if (!item.photo_url) return `<div class="grid min-h-80 place-items-center text-sm font-black text-slate-400">暂无照片</div>`;
  return `
    <div class="relative min-h-80">
      <img class="max-h-[70vh] w-full object-contain" src="${esc(item.photo_url)}" alt="观察大图" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden');">
      <div class="hidden grid min-h-80 place-items-center text-sm font-black text-slate-400">图片加载失败</div>
    </div>`;
}

function detailRow(label, value) {
  return `<div><p class="text-sm font-black text-slate-500">${label}</p><p class="mt-1 text-base font-bold text-slate-900">${esc(value)}</p></div>`;
}

function truncateText(text, maxLength) {
  const value = String(text || "");
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} 小时前`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} 天前`;
  return formatDateTime(value);
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function initApp() {
  applyAdminModeFromUrl();
  updateAdminUi();
  loadDashboardData();
  switchPage("decision");
}

function switchPage(page) {
  currentPage = page;
  ["decision", "decisions", "ndvi", "overview", "map"].forEach((name) => {
    $(`#${name}Page`).classList.toggle("hidden", name !== page);
    const btn = document.querySelector(`[data-page="${name}"]`);
    btn.classList.toggle("bg-grass-600", name === page);
    btn.classList.toggle("text-white", name === page);
    btn.classList.toggle("text-slate-700", name !== page);
    btn.classList.toggle("hover:bg-slate-100", name !== page);
  });
  if (page === "decision") initDecisionTab();
  if (page === "decisions") initDecisionsTab();
  if (page === "ndvi") initNdviTab();
}

$("#refreshBtn").addEventListener("click", () => {
  if (currentPage === "ndvi") {
    reloadNdviTab();
  } else if (currentPage === "decision") {
    initDecisionTab();
  } else if (currentPage === "decisions") {
    loadDecisionsList();
  } else {
    loadDashboardData();
  }
});
$("#refreshDecisionsBtn").addEventListener("click", loadDecisionsList);
$("#generateDraftsBtn").addEventListener("click", handleGenerateDrafts);
document.querySelectorAll("[data-decision-status-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    state.decisions.statusFilter = btn.dataset.decisionStatusFilter;
    renderDecisionsList();
    renderDecisionCounts();
  });
});
$("#ndviPastureSelect").addEventListener("change", async (event) => {
  state.ndvi.selectedPastureId = event.target.value;
  setNdviLoading(true);
  setNdviError("");
  try {
    state.ndvi.rows = state.ndvi.selectedPastureId ? await loadNdviRows(state.ndvi.selectedPastureId) : [];
    renderSelectedNdvi();
  } catch (error) {
    console.error("切换牧场 NDVI 数据失败：", error);
    setNdviError("NDVI 数据读取失败，请检查网络或 Supabase 权限后重试。");
  } finally {
    setNdviLoading(false);
  }
});
$("#actualStockingInput").addEventListener("input", renderOverstocking);
$("#closeModalBtn").addEventListener("click", () => {
  $("#detailModal").classList.add("hidden");
  $("#detailModal").classList.remove("flex");
});
$("#detailModal").addEventListener("click", (event) => {
  if (event.target === $("#detailModal")) $("#closeModalBtn").click();
});
$("#adminSettingsBtn").addEventListener("click", () => {
  $("#adminSettingsPanel").classList.toggle("hidden");
});
$("#adminModeToggle").addEventListener("change", (event) => {
  localStorage.setItem("grassland_admin", event.target.checked ? "true" : "false");
  updateAdminUi();
  if (currentPage === "decisions") loadDecisionsList();
});
document.querySelectorAll("[data-page], [data-page-link]").forEach((btn) => {
  btn.addEventListener("click", () => switchPage(btn.dataset.page || btn.dataset.pageLink));
});
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.classList.add("h-11", "rounded-md", "px-4", "text-left", "text-sm", "font-black");
});

// 当前阶段取消密码拦截，打开页面直接进入管理端。
initApp();
