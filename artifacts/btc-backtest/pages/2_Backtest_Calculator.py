import streamlit as st
import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import date, timedelta

st.set_page_config(
    page_title="Backtest Calculator — KISBTC",
    page_icon="📈",
    layout="wide",
)

# ─── Indicator helpers ───────────────────────────────────────────────────────

def calc_sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period, min_periods=period).mean()

def calc_ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()

def calc_wma(series: pd.Series, period: int) -> pd.Series:
    weights = np.arange(1, period + 1, dtype=float)
    return series.rolling(window=period, min_periods=period).apply(
        lambda x: np.dot(x, weights) / weights.sum(), raw=True
    )

# ─── Zone logic ──────────────────────────────────────────────────────────────

ZONE_CONFIG = {
    "Max Accumulation":    {"multiplier": 2.0, "color": "#22c55e"},
    "Aggressive Buy":      {"multiplier": 1.5, "color": "#4ade80"},
    "Standard Buy (Low)":  {"multiplier": 1.0, "color": "#3b82f6"},
    "Standard Buy (High)": {"multiplier": 0.6, "color": "#eab308"},
    "Take Profit":         {"multiplier": 0.0, "color": "#ef4444"},
    "Insufficient Data":   {"multiplier": 1.0, "color": "#6b7280"},
}

def determine_zone(price: float, wma200w: float, ema20w: float, sma200d: float) -> str:
    if np.isnan(wma200w) or np.isnan(ema20w) or np.isnan(sma200d):
        return "Insufficient Data"
    if price <= wma200w:
        return "Max Accumulation"
    if price <= ema20w:
        return "Aggressive Buy"
    if price <= sma200d * 1.25:
        return "Standard Buy (Low)"
    if price < sma200d * 1.50:
        return "Standard Buy (High)"
    return "Take Profit"

# ─── Data loading ─────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600, show_spinner=False)
def load_btc_data(start_str: str) -> pd.DataFrame:
    """Fetch BTC-USD daily OHLCV with 1500-day warmup for 200W WMA."""
    fetch_start = (pd.Timestamp(start_str) - pd.Timedelta(days=1500)).strftime("%Y-%m-%d")
    today_str   = (pd.Timestamp.today() + pd.Timedelta(days=1)).strftime("%Y-%m-%d")

    raw = yf.download(
        "BTC-USD",
        start=fetch_start,
        end=today_str,
        auto_adjust=True,
        progress=False,
    )
    if raw.empty:
        return pd.DataFrame()

    # Flatten MultiIndex columns if present
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.droplevel(1)

    close = raw["Close"].squeeze()
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close = close.dropna().astype(float)
    close.index = pd.to_datetime(close.index)
    return close.to_frame(name="close")

@st.cache_data(ttl=3600, show_spinner=False)
def build_indicators(start_str: str) -> pd.DataFrame:
    """Return a daily DataFrame with price + all three indicators forward-filled."""
    df = load_btc_data(start_str)
    if df.empty:
        return df

    # 200D SMA on daily data
    df["sma200d"] = calc_sma(df["close"], 200)

    # Resample to weekly (last trading day of each week)
    weekly = df["close"].resample("W").last().dropna()
    wma_weekly = calc_wma(weekly, 200)
    ema_weekly = calc_ema(weekly, 20)

    # Map weekly indicators back to daily via forward-fill
    df["wma200w"] = wma_weekly.reindex(df.index, method="ffill")
    df["ema20w"]  = ema_weekly.reindex(df.index, method="ffill")

    return df

# ─── Backtest engine ──────────────────────────────────────────────────────────

def run_backtest(
    df: pd.DataFrame,
    start_date: pd.Timestamp,
    base_installment: float,
    starting_cash: float,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Returns:
        history    — daily portfolio snapshot
        trades     — each contribution / sell event
        dca_history— Simple DCA daily snapshot (always buys base_installment)
    """
    # Work only from start_date onwards
    sim = df.loc[start_date:].copy()
    if sim.empty:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()

    sim["zone"] = sim.apply(
        lambda r: determine_zone(r["close"], r["wma200w"], r["ema20w"], r["sma200d"]),
        axis=1,
    )

    DAILY_RATE = 0.04 / 365
    SELL_TRANCHE = 0.20

    # Strategy state
    btc_holdings = 0.0
    cash_balance = float(starting_cash)
    total_invested = 0.0
    tp1 = tp2 = tp3 = False

    # Simple DCA state
    dca_btc = 0.0
    dca_invested = 0.0

    history_rows   = []
    trades_rows    = []
    dca_rows       = []
    prev_date      = sim.index[0]

    for day, row in sim.iterrows():
        price    = float(row["close"])
        sma200d  = float(row["sma200d"]) if not np.isnan(row["sma200d"]) else np.nan
        zone     = row["zone"]

        # Daily interest on cash
        days_elapsed = max((day - prev_date).days, 1)
        cash_balance *= (1 + DAILY_RATE) ** days_elapsed
        prev_date = day

        # ── Take-profit sell checks (process TP3 → TP2 → TP1 in order) ──
        if not np.isnan(sma200d):
            for (flag, attr, mult, label) in [
                (tp3, "tp3", 2.00, "TP3 +100%"),
                (tp2, "tp2", 1.80, "TP2 +80%"),
                (tp1, "tp1", 1.50, "TP1 +50%"),
            ]:
                if not flag and price >= sma200d * mult:
                    sell_btc   = btc_holdings * SELL_TRANCHE
                    proceeds   = sell_btc * price
                    btc_holdings  -= sell_btc
                    cash_balance  += proceeds
                    if attr == "tp1": tp1 = True
                    elif attr == "tp2": tp2 = True
                    else: tp3 = True
                    trades_rows.append({
                        "date": day, "type": "SELL", "label": label,
                        "zone": zone, "price": price,
                        "btc_delta": -sell_btc, "cash_delta": proceeds,
                        "total_invested": total_invested,
                    })
                    break  # one TP event per day

        # ── Bi-monthly contribution (1st and 15th) ──
        if day.day in (1, 15) and zone != "Insufficient Data":
            multiplier   = ZONE_CONFIG[zone]["multiplier"]
            contribution = base_installment * multiplier

            if contribution > 0:
                btc_bought      = contribution / price
                btc_holdings   += btc_bought
                total_invested += contribution
                trades_rows.append({
                    "date": day, "type": "BUY", "label": zone,
                    "zone": zone, "price": price,
                    "btc_delta": btc_bought, "cash_delta": -contribution,
                    "total_invested": total_invested,
                })

            # Simple DCA (always buy base)
            dca_btc     += base_installment / price
            dca_invested += base_installment
            dca_rows.append({
                "date": day, "dca_btc": dca_btc,
                "dca_invested": dca_invested,
                "dca_value": dca_btc * price + starting_cash,
            })

        portfolio_value = btc_holdings * price + cash_balance
        history_rows.append({
            "date": day, "price": price, "zone": zone,
            "btc_holdings": btc_holdings,
            "btc_value": btc_holdings * price,
            "cash_balance": cash_balance,
            "portfolio_value": portfolio_value,
            "total_invested": total_invested,
        })

    history = pd.DataFrame(history_rows).set_index("date")
    trades  = pd.DataFrame(trades_rows) if trades_rows else pd.DataFrame()
    dca_ref = (
        pd.DataFrame(dca_rows).set_index("date")
        if dca_rows else pd.DataFrame()
    )

    # Forward-fill DCA to every day for charting
    if not dca_ref.empty:
        dca_daily = dca_ref.reindex(history.index, method="ffill")
        dca_daily["dca_value"] = dca_daily["dca_btc"] * history["price"] + starting_cash
    else:
        dca_daily = pd.DataFrame(index=history.index)
        dca_daily["dca_value"] = np.nan

    return history, trades, dca_daily

# ─── Stats helpers ────────────────────────────────────────────────────────────

def max_drawdown(series: pd.Series) -> float:
    peak = series.cummax()
    dd   = (series - peak) / peak
    return float(dd.min())

# ─── Chart ────────────────────────────────────────────────────────────────────

ZONE_COLORS_ALPHA = {
    "Max Accumulation":    "rgba(34,197,94,0.10)",
    "Aggressive Buy":      "rgba(74,222,128,0.08)",
    "Standard Buy (Low)":  "rgba(59,130,246,0.08)",
    "Standard Buy (High)": "rgba(234,179,8,0.08)",
    "Take Profit":         "rgba(239,68,68,0.10)",
    "Insufficient Data":   "rgba(107,114,128,0.05)",
}

def build_chart(history: pd.DataFrame, dca_daily: pd.DataFrame, trades: pd.DataFrame) -> go.Figure:
    fig = make_subplots(
        rows=2, cols=1,
        shared_xaxes=True,
        row_heights=[0.72, 0.28],
        vertical_spacing=0.04,
        subplot_titles=("Portfolio Value", "BTC Price & Indicators"),
    )

    # ── Background zone bands ──
    if "zone" in history.columns:
        zone_col = history["zone"]
        changes  = zone_col.ne(zone_col.shift()).cumsum()
        for _, grp in history.groupby(changes):
            z = grp["zone"].iloc[0]
            fig.add_vrect(
                x0=grp.index[0], x1=grp.index[-1],
                fillcolor=ZONE_COLORS_ALPHA.get(z, "rgba(0,0,0,0)"),
                layer="below", line_width=0,
                row=1, col=1,
            )

    # ── Strategy portfolio area ──
    fig.add_trace(go.Scatter(
        x=history.index, y=history["portfolio_value"],
        name="KISBTC Strategy",
        mode="lines",
        line=dict(color="#f97316", width=2),
        fill="tozeroy",
        fillcolor="rgba(249,115,22,0.12)",
    ), row=1, col=1)

    # ── Simple DCA line ──
    if not dca_daily.empty and "dca_value" in dca_daily.columns:
        fig.add_trace(go.Scatter(
            x=dca_daily.index, y=dca_daily["dca_value"],
            name="Simple DCA",
            mode="lines",
            line=dict(color="#94a3b8", width=1.5, dash="dash"),
        ), row=1, col=1)

    # ── Trade markers on portfolio chart ──
    if not trades.empty:
        buys  = trades[trades["type"] == "BUY"]
        sells = trades[trades["type"] == "SELL"]

        if not buys.empty:
            buy_vals = history["portfolio_value"].reindex(buys["date"].values, method="nearest")
            fig.add_trace(go.Scatter(
                x=buys["date"].values, y=buy_vals.values,
                name="Contribution",
                mode="markers",
                marker=dict(
                    symbol="triangle-up",
                    size=8,
                    color=[ZONE_CONFIG.get(z, {}).get("color", "#94a3b8") for z in buys["zone"]],
                    line=dict(width=1, color="white"),
                ),
                hovertemplate="<b>%{customdata[0]}</b><br>$%{customdata[1]:,.0f} @ $%{customdata[2]:,.0f}<extra></extra>",
                customdata=list(zip(
                    buys["label"],
                    (buys["btc_delta"] * buys["price"]).round(0),
                    buys["price"].round(0),
                )),
            ), row=1, col=1)

        if not sells.empty:
            sell_vals = history["portfolio_value"].reindex(sells["date"].values, method="nearest")
            fig.add_trace(go.Scatter(
                x=sells["date"].values, y=sell_vals.values,
                name="Take Profit Sell",
                mode="markers",
                marker=dict(symbol="triangle-down", size=10, color="#ef4444",
                            line=dict(width=1, color="white")),
                hovertemplate="<b>%{customdata}</b><extra></extra>",
                customdata=sells["label"].values,
            ), row=1, col=1)

    # ── BTC price (lower panel) ──
    fig.add_trace(go.Scatter(
        x=history.index, y=history["price"],
        name="BTC Price",
        mode="lines",
        line=dict(color="#ffffff", width=1.5),
        showlegend=True,
    ), row=2, col=1)

    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor="#0f172a",
        plot_bgcolor="#0f172a",
        height=680,
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        margin=dict(l=0, r=0, t=40, b=0),
        hovermode="x unified",
        xaxis2=dict(showgrid=False),
        yaxis=dict(tickprefix="$", showgrid=True, gridcolor="#1e293b"),
        yaxis2=dict(tickprefix="$", showgrid=True, gridcolor="#1e293b"),
    )
    return fig

# ─── UI ───────────────────────────────────────────────────────────────────────

st.title("📈 Backtest Calculator")
st.caption("Replay the KISBTC V3.1 strategy over a historical period and compare against simple DCA.")

with st.sidebar:
    st.header("⚙️ Parameters")

    default_start = date.today() - timedelta(days=365 * 2)
    start_date_input = st.date_input(
        "Start Date",
        value=default_start,
        min_value=date(2015, 1, 1),
        max_value=date.today() - timedelta(days=90),
        help="Backtest begins on this date. At least 90 days recommended.",
    )

    base_installment = st.number_input(
        "Base Bi-Monthly Installment ($)",
        min_value=50,
        max_value=50_000,
        value=500,
        step=50,
        help="Standard Buy (Low) contribution. Other zones scale relative to this.",
    )

    starting_cash = st.number_input(
        "Starting CASH.to Balance ($)",
        min_value=0,
        max_value=500_000,
        value=0,
        step=500,
        help="Initial cash parked in CASH.to at the start of the backtest.",
    )

    st.markdown("---")
    st.markdown("**Zone → Contribution**")
    for zone, cfg in ZONE_CONFIG.items():
        if zone == "Insufficient Data":
            continue
        amt = base_installment * cfg["multiplier"]
        st.markdown(
            f'<span style="color:{cfg["color"]}">● {zone}</span> → **${amt:,.0f}**',
            unsafe_allow_html=True,
        )

    st.markdown("---")
    run_btn = st.button("▶ Run Backtest", type="primary", use_container_width=True)

# ── Run backtest ──────────────────────────────────────────────────────────────

if run_btn:
    start_ts = pd.Timestamp(start_date_input)

    with st.spinner("Loading BTC data and computing indicators…"):
        df = build_indicators(str(start_date_input))

    if df.empty or start_ts not in df.index:
        # Snap to nearest available date
        df = build_indicators(str(start_date_input))
        if df.empty:
            st.error("Could not load BTC data. Please try again.")
            st.stop()
        available = df.index[df.index >= start_ts]
        if available.empty:
            st.error("No data available from that start date.")
            st.stop()
        start_ts = available[0]

    with st.spinner("Running backtest…"):
        history, trades, dca_daily = run_backtest(df, start_ts, base_installment, starting_cash)

    if history.empty:
        st.error("Backtest produced no data. Try an earlier start date.")
        st.stop()

    # ── Summary metrics ──────────────────────────────────────────────────────
    final_val     = history["portfolio_value"].iloc[-1]
    total_inv     = history["total_invested"].iloc[-1]
    cash_now      = history["cash_balance"].iloc[-1]
    btc_val_now   = history["btc_value"].iloc[-1]
    profit_pct    = ((final_val - total_inv - starting_cash) / max(total_inv + starting_cash, 1)) * 100
    mdd           = max_drawdown(history["portfolio_value"]) * 100

    dca_final = float(dca_daily["dca_value"].iloc[-1]) if not dca_daily.empty else 0.0
    dca_invested_total = base_installment * len(trades[trades["type"] == "BUY"]) if not trades.empty else 0
    outperformance = final_val - dca_final

    num_contributions = len(history.index[(history.index.day == 1) | (history.index.day == 15)])

    st.markdown("---")
    col1, col2, col3, col4 = st.columns(4)
    col1.metric(
        "Final Portfolio Value",
        f"${final_val:,.0f}",
        f"vs ${dca_final:,.0f} Simple DCA",
        delta_color="normal",
    )
    col2.metric(
        "Total Invested",
        f"${total_inv:,.0f}",
        f"{num_contributions} contributions",
        delta_color="off",
    )
    col3.metric(
        "Total Return",
        f"{profit_pct:+.1f}%",
        f"${final_val - total_inv - starting_cash:+,.0f} profit",
        delta_color="normal",
    )
    col4.metric(
        "Max Drawdown",
        f"{mdd:.1f}%",
        f"Strategy vs DCA: ${outperformance:+,.0f}",
        delta_color="inverse",
    )

    # ── Portfolio split ───────────────────────────────────────────────────────
    st.markdown("---")
    c1, c2, c3 = st.columns(3)
    c1.metric("BTC Holdings Value", f"${btc_val_now:,.0f}")
    c2.metric("CASH.to Balance", f"${cash_now:,.0f}")
    btc_pct = (btc_val_now / max(final_val, 1)) * 100
    c3.metric("BTC Allocation", f"{btc_pct:.1f}%")

    # ── Growth chart ─────────────────────────────────────────────────────────
    st.markdown("#### Portfolio Growth")
    fig = build_chart(history, dca_daily, trades)
    st.plotly_chart(fig, use_container_width=True)

    # ── Zone distribution ─────────────────────────────────────────────────────
    if not trades.empty:
        buy_trades = trades[trades["type"] == "BUY"]
        if not buy_trades.empty:
            st.markdown("#### Zone Distribution")
            zone_counts = buy_trades["zone"].value_counts()
            zone_amounts = buy_trades.groupby("zone").apply(
                lambda g: (g["btc_delta"] * g["price"]).sum()
            )

            fig_zone = go.Figure()
            for zone in zone_counts.index:
                cfg = ZONE_CONFIG.get(zone, {"color": "#94a3b8"})
                fig_zone.add_trace(go.Bar(
                    name=zone,
                    x=[zone],
                    y=[zone_amounts.get(zone, 0)],
                    marker_color=cfg["color"],
                    text=[f"${zone_amounts.get(zone, 0):,.0f}<br>{zone_counts.get(zone, 0)} buys"],
                    textposition="auto",
                ))
            fig_zone.update_layout(
                template="plotly_dark",
                paper_bgcolor="#0f172a",
                plot_bgcolor="#0f172a",
                showlegend=False,
                height=280,
                margin=dict(l=0, r=0, t=10, b=0),
                yaxis=dict(tickprefix="$", title="Capital Deployed"),
                xaxis=dict(title="Zone"),
            )
            st.plotly_chart(fig_zone, use_container_width=True)

    # ── KISBTC vs Simple DCA comparison table ─────────────────────────────────
    st.markdown("#### Strategy Comparison")
    num_dca_contributions = len(history.index[(history.index.day == 1) | (history.index.day == 15)])
    dca_total_invested    = base_installment * num_dca_contributions

    comparison = pd.DataFrame({
        "": ["Total Invested", "Final Portfolio Value", "Net Profit", "Return %", "Max Drawdown"],
        "KISBTC Strategy": [
            f"${total_inv:,.0f}",
            f"${final_val:,.0f}",
            f"${final_val - total_inv - starting_cash:+,.0f}",
            f"{profit_pct:+.1f}%",
            f"{mdd:.1f}%",
        ],
        "Simple DCA ($500 always)": [
            f"${dca_total_invested:,.0f}",
            f"${dca_final:,.0f}",
            f"${dca_final - dca_total_invested - starting_cash:+,.0f}",
            f"{((dca_final - dca_total_invested - starting_cash) / max(dca_total_invested + starting_cash, 1)) * 100:+.1f}%",
            "—",
        ],
    })
    st.dataframe(comparison, use_container_width=True, hide_index=True)

    # ── Trade log ─────────────────────────────────────────────────────────────
    if not trades.empty:
        with st.expander("📋 Full Trade Log", expanded=False):
            display_trades = trades.copy()
            display_trades["date"] = display_trades["date"].dt.strftime("%Y-%m-%d")
            display_trades["price"] = display_trades["price"].map("${:,.0f}".format)
            display_trades["amount"] = (display_trades["btc_delta"].abs() * display_trades["price"].str.replace("$", "").str.replace(",", "").astype(float)).map("${:,.0f}".format)
            display_trades["btc_delta"] = display_trades["btc_delta"].map("{:+.6f} BTC".format)
            display_trades["total_invested"] = display_trades["total_invested"].map("${:,.0f}".format)
            display_trades = display_trades[["date", "type", "label", "price", "amount", "btc_delta", "total_invested"]]
            display_trades.columns = ["Date", "Type", "Zone / Event", "BTC Price", "Amount", "BTC Δ", "Cumulative Invested"]
            st.dataframe(display_trades, use_container_width=True, hide_index=True)

else:
    st.info("Configure the parameters in the sidebar and click **▶ Run Backtest** to begin.")

    st.markdown("---")
    st.markdown("#### How the Simulation Works")

    col1, col2 = st.columns(2)
    with col1:
        st.markdown("""
**Contribution Logic (1st & 15th of each month)**
- Calculates 200D SMA, 20W EMA, and 200W WMA at that date
- Determines zone using strict threshold math
- Buys BTC with the zone-appropriate amount

**Take-Profit Triggers (daily check)**
- TP1 (price ≥ 1.5× SMA): sell 20% of BTC → cash
- TP2 (price ≥ 1.8× SMA): sell another 20% → cash
- TP3 (price ≥ 2.0× SMA): sell another 20% → cash
- Each tranche fires at most once
""")
    with col2:
        st.markdown("""
**Cash Management**
- CASH.to balance earns **4% annual interest** (compounded daily)
- Take-profit proceeds go directly to CASH.to
- Starting Cash begins earning interest immediately

**Simple DCA Benchmark**
- Always buys the base installment on every 1st & 15th
- No zone-based scaling, no take-profit selling
- Same starting cash, same starting date
""")
