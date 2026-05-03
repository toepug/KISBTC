# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

| Artifact | Path | Stack | Description |
|---|---|---|---|
| `btc-dashboard` | `/` | React + Vite + Recharts | Live BTC strategy dashboard (Questrade V3.1) |
| `api-server` | `/api` | Express 5 | Kraken data fetch + indicator calculations |
| `btc-backtest` | `/btc-backtest/` | Python 3.11 + Streamlit | Historical backtest calculator with Plotly charts |

### btc-backtest (Streamlit)
- **Location**: `artifacts/btc-backtest/`
- **Pages**: `app.py` (landing), `pages/2_Backtest_Calculator.py` (full backtest)
- **Python deps**: streamlit, yfinance, plotly, pandas, numpy
- **Workflow**: `artifacts/btc-backtest: web` — `streamlit run app.py --server.port 5000 --server.baseUrlPath /btc-backtest`
- **Port**: 5000

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
