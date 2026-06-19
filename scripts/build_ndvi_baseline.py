from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
INPUT_PATH = ROOT / "data" / "ndvi_baseline_2020_2025.csv"
OUTPUT_DIR = ROOT / "outputs"
BASELINE_CSV = OUTPUT_DIR / "baseline.csv"
BASELINE_PNG = OUTPUT_DIR / "baseline_envelope.png"


def build_baseline() -> pd.DataFrame:
    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"找不到输入文件：{INPUT_PATH}")

    df = pd.read_csv(INPUT_PATH)
    required = ["pasture_id", "week_of_year", "ndvi_mean", "year"]
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise ValueError(f"CSV 缺少必要字段：{missing}")

    clean = df[required].dropna(subset=required).copy()
    clean["week_of_year"] = clean["week_of_year"].astype(int)
    clean["year"] = clean["year"].astype(int)
    clean["ndvi_mean"] = pd.to_numeric(clean["ndvi_mean"], errors="coerce")
    clean = clean.dropna(subset=["ndvi_mean"])

    grouped = clean.groupby(["pasture_id", "week_of_year"], as_index=False).agg(
        p10=("ndvi_mean", lambda s: s.quantile(0.10)),
        p30=("ndvi_mean", lambda s: s.quantile(0.30)),
        p50=("ndvi_mean", lambda s: s.quantile(0.50)),
        p70=("ndvi_mean", lambda s: s.quantile(0.70)),
        p90=("ndvi_mean", lambda s: s.quantile(0.90)),
        n_years=("year", "nunique"),
    )

    baseline = grouped[grouped["n_years"] >= 3].copy()
    baseline = baseline.sort_values(["pasture_id", "week_of_year"])
    for col in ["p10", "p30", "p50", "p70", "p90"]:
        baseline[col] = baseline[col].round(4)

    return baseline


def plot_baseline(baseline: pd.DataFrame) -> None:
    import matplotlib.pyplot as plt

    pasture_id = "pasture_001"
    plot_df = baseline[baseline["pasture_id"] == pasture_id].sort_values("week_of_year")
    if plot_df.empty:
        raise ValueError(f"没有可绘图的数据：{pasture_id}")

    plt.rcParams["font.sans-serif"] = [
        "Arial Unicode MS",
        "PingFang SC",
        "Heiti SC",
        "SimHei",
        "DejaVu Sans",
    ]
    plt.rcParams["axes.unicode_minus"] = False

    fig, ax = plt.subplots(figsize=(12, 6), dpi=160)
    x = plot_df["week_of_year"].to_numpy()
    ax.fill_between(x, plot_df["p10"], plot_df["p90"], color="#d1d5db", alpha=0.55, label="P10-P90")
    ax.fill_between(x, plot_df["p30"], plot_df["p70"], color="#6b7280", alpha=0.35, label="P30-P70")
    ax.plot(x, plot_df["p50"], color="#2563eb", linewidth=2.5, label="P50 中位数")

    ax.set_title("pasture_001 NDVI 健康基线（2020-2025）", fontsize=16, fontweight="bold")
    ax.set_xlabel("week_of_year")
    ax.set_ylabel("NDVI")
    ax.set_xlim(1, 52)
    ax.set_ylim(0, max(1.0, float(plot_df["p90"].max()) * 1.1))
    ax.grid(True, color="#e5e7eb", linewidth=0.8)
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(BASELINE_PNG)
    plt.close(fig)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    baseline = build_baseline()
    baseline.to_csv(BASELINE_CSV, index=False)
    plot_baseline(baseline)
    print(f"rows={len(baseline)}")
    print(f"csv={BASELINE_CSV}")
    print(f"png={BASELINE_PNG}")


if __name__ == "__main__":
    main()
