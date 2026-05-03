import streamlit as st

st.set_page_config(
    page_title="KISBTC Strategy Simulator",
    page_icon="₿",
    layout="wide",
)

st.title("₿ KISBTC Strategy Simulator")
st.markdown("**Questrade V3.1 — Zone-Based Bitcoin DCA**")

st.markdown("---")

col1, col2, col3 = st.columns(3)

with col1:
    st.markdown("### 📊 Backtest Calculator")
    st.markdown(
        "Replay the KISBTC strategy over any historical period. "
        "See exactly how much you would have made vs. simple DCA."
    )
    st.page_link("pages/2_Backtest_Calculator.py", label="Open Backtest Calculator →")

with col2:
    st.markdown("### 🗺️ Zone Rules")
    st.markdown("""
| Zone | Condition | Contribution |
|------|-----------|-------------|
| Max Accumulation | Price ≤ 200W WMA | 2× base |
| Aggressive Buy | Price ≤ 20W EMA | 1.5× base |
| Standard Buy (Low) | ≤ 25% above 200D SMA | 1× base |
| Standard Buy (High) | 25–50% above 200D SMA | 0.6× base |
| Take Profit | ≥ 50% above 200D SMA | $0 |
""")

with col3:
    st.markdown("### 💰 Take-Profit Ladder")
    st.markdown("""
| Tranche | Trigger | Action |
|---------|---------|--------|
| TP1 | Price ≥ 1.5× 200D SMA | Sell 20% of BTC |
| TP2 | Price ≥ 1.8× 200D SMA | Sell 20% of BTC |
| TP3 | Price ≥ 2.0× 200D SMA | Sell 20% of BTC |
""")
    st.caption("Proceeds park in CASH.to (4% interest). Re-enter on Aggressive Buy or better.")

st.markdown("---")
st.caption("Data: Yahoo Finance (BTC-USD). All results are hypothetical and for educational purposes only.")
