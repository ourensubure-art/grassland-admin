const DECISION_TYPE_LABELS = {
  rest: "休牧",
  graze: "可放牧",
  reduce: "减畜",
  resume: "恢复放牧"
};

const SEVERITY_LABELS = {
  info: "提示",
  warning: "预警",
  critical: "严重"
};

const STATUS_LABELS = {
  draft: "草稿",
  published: "已发布",
  acknowledged: "已确认",
  executing: "执行中",
  completed: "已完成",
  cancelled: "已取消"
};

const SEVERITY_CLASSES = {
  info: "bg-grass-100 text-grass-800 border-grass-200",
  warning: "bg-amber-100 text-amber-800 border-amber-200",
  critical: "bg-red-100 text-red-800 border-red-200"
};

const STATUS_CLASSES = {
  draft: "bg-slate-100 text-slate-700 border-dashed border-slate-300",
  published: "bg-grass-100 text-grass-800 border-grass-200",
  acknowledged: "bg-sky-100 text-sky-800 border-sky-200",
  executing: "bg-amber-100 text-amber-800 border-amber-200",
  completed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  cancelled: "bg-slate-200 text-slate-600 border-slate-300"
};

const DECISION_TYPE_CLASSES = {
  rest: "bg-red-50 text-red-800 border-red-200",
  graze: "bg-grass-50 text-grass-800 border-grass-200",
  reduce: "bg-amber-50 text-amber-800 border-amber-200",
  resume: "bg-sky-50 text-sky-800 border-sky-200"
};

function labelFrom(map, value) {
  return map[value] || value || "未知";
}

function classFrom(map, value) {
  return map[value] || "bg-slate-100 text-slate-700 border-slate-200";
}

export function decisionTypeLabel(value) {
  return labelFrom(DECISION_TYPE_LABELS, value);
}

export function severityLabel(value) {
  return labelFrom(SEVERITY_LABELS, value);
}

export function statusLabel(value) {
  return labelFrom(STATUS_LABELS, value);
}

export function decisionTypeClass(value) {
  return classFrom(DECISION_TYPE_CLASSES, value);
}

export function severityClass(value) {
  return classFrom(SEVERITY_CLASSES, value);
}

export function statusClass(value) {
  return classFrom(STATUS_CLASSES, value);
}

export function formatDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDateTimeShort(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return `${formatDate(value)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : "--";
}

export function formatMetric(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "--";
}
