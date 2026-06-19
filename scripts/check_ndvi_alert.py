"""
NDVI 偏离度告警 - Step 2
对比当前 NDVI 与历史基线，输出红黄绿状态
"""
import json
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib
matplotlib.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'PingFang SC', 'Heiti TC']
matplotlib.rcParams['axes.unicode_minus'] = False

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / "outputs" / "baseline.csv"
CURRENT = ROOT / "data" / "ndvi_current.csv"
OUT_DIR = ROOT / "outputs"
OUT_DIR.mkdir(exist_ok=True)


def classify(ndvi, p10, p30, p70):
    """红黄绿分级：只看偏低，偏高不报警（草更旺反而是好事）"""
    if pd.isna(ndvi) or pd.isna(p10):
        return "no_data", "⚪️"
    if ndvi < p10:
        return "severe_low", "🔴"
    if ndvi < p30:
        return "mild_low", "🟡"
    return "normal", "🟢"


def main():
    # 1. 读基线
    base = pd.read_csv(BASELINE)
    print(f"基线: {len(base)} 行, 牧场={base['pasture_id'].unique().tolist()}")

    # 2. 读当前数据，按时间升序
    cur = pd.read_csv(CURRENT)
    cur["week_end"] = pd.to_datetime(cur["week_end"])
    cur = cur.sort_values("week_end").reset_index(drop=True)
    cur["week_of_year"] = cur["week_end"].dt.isocalendar().week.astype(int)

    # 3. 4 周滑动平均（抗噪+填补 NaN 空缺）
    cur["ndvi_smooth"] = (
        cur.groupby("pasture_id")["ndvi_mean"]
        .transform(lambda s: s.rolling(window=4, min_periods=2).mean())
    )

    # 4. 按 (pasture, week_of_year) 匹配基线（最近邻，因为基线是隔周）
    results = []
    for _, row in cur.iterrows():
        pid = row["pasture_id"]
        woy = row["week_of_year"]
        sub = base[base["pasture_id"] == pid].copy()
        if sub.empty:
            continue
        sub["dist"] = (sub["week_of_year"] - woy).abs()
        nearest = sub.loc[sub["dist"].idxmin()]
        status, emoji = classify(
            row["ndvi_smooth"], nearest["p10"], nearest["p30"], nearest["p70"]
        )
        results.append({
            "pasture_id": pid,
            "week_start": row["week_start"],
            "week_end": row["week_end"].strftime("%Y-%m-%d"),
            "week_of_year": woy,
            "ndvi_raw": round(row["ndvi_mean"], 4) if pd.notna(row["ndvi_mean"]) else None,
            "ndvi_smooth": round(row["ndvi_smooth"], 4) if pd.notna(row["ndvi_smooth"]) else None,
            "baseline_p10": round(nearest["p10"], 4),
            "baseline_p30": round(nearest["p30"], 4),
            "baseline_p50": round(nearest["p50"], 4),
            "baseline_p70": round(nearest["p70"], 4),
            "status": status,
            "emoji": emoji,
        })

    df = pd.DataFrame(results)
    csv_path = OUT_DIR / "ndvi_alert.csv"
    df.to_csv(csv_path, index=False)
    print(f"全量告警表: {csv_path} ({len(df)} 行)")

    # 5. 最新快照（每个牧场最后一条有数据的）
    latest_rows = []
    for pid in df["pasture_id"].unique():
        sub = df[(df["pasture_id"] == pid) & df["ndvi_smooth"].notna()]
        if sub.empty:
            continue
        last = sub.iloc[-1].to_dict()
        latest_rows.append(last)
    json_path = OUT_DIR / "ndvi_alert_latest.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(latest_rows, f, ensure_ascii=False, indent=2)
    print(f"最新告警: {json_path}")

    # 6. 终端打印漂亮表
    print("\n========== 最新状态 ==========")
    for r in latest_rows:
        print(f"{r['emoji']} {r['pasture_id']} | 截至 {r['week_end']} | "
              f"NDVI={r['ndvi_smooth']} (基线P50={r['baseline_p50']}, "
              f"P10={r['baseline_p10']}) → {r['status']}")

    # 7. 画图：当前曲线 vs 基线走廊
    plot_overlay(base, df)


def plot_overlay(base, alert):
    pid = alert["pasture_id"].iloc[0]
    b = base[base["pasture_id"] == pid].sort_values("week_of_year")
    a = alert[alert["pasture_id"] == pid].copy()
    a["week_end_dt"] = pd.to_datetime(a["week_end"])

    fig, ax = plt.subplots(figsize=(13, 6))
    # 基线走廊用 week_of_year 拉到当前数据的时间轴上
    # 简化：在最近 1 年内每个 woy 找对应日期画
    a["base_p10"] = a["baseline_p10"]
    a["base_p90_approx"] = a["baseline_p70"]  # 用p70近似上沿
    a_sorted = a.sort_values("week_end_dt")

    ax.fill_between(a_sorted["week_end_dt"], a_sorted["baseline_p10"],
                    a_sorted["baseline_p70"], color="lightgray", alpha=0.6,
                    label="健康走廊 P10-P70")
    ax.plot(a_sorted["week_end_dt"], a_sorted["baseline_p50"],
            color="gray", linestyle="--", label="基线 P50")
    ax.plot(a_sorted["week_end_dt"], a_sorted["ndvi_smooth"],
            color="#1f77b4", linewidth=2, label="当前 NDVI (4周平滑)")
    # 红点高亮
    sev = a_sorted[a_sorted["status"] == "severe_low"]
    mild = a_sorted[a_sorted["status"] == "mild_low"]
    ax.scatter(sev["week_end_dt"], sev["ndvi_smooth"], color="red", s=60,
               zorder=5, label="🔴 严重偏低")
    ax.scatter(mild["week_end_dt"], mild["ndvi_smooth"], color="orange", s=40,
               zorder=4, label="🟡 轻度偏低")

    ax.set_title(f"{pid} NDVI 当前 vs 基线（近 1 年）")
    ax.set_xlabel("日期")
    ax.set_ylabel("NDVI")
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left")
    ax.grid(alpha=0.3)
    fig.autofmt_xdate()
    fig.tight_layout()
    out = OUT_DIR / "ndvi_alert_chart.png"
    fig.savefig(out, dpi=150)
    print(f"对比图: {out}")


if __name__ == "__main__":
    main()
