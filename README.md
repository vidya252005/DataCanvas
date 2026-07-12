# DataCanvas — Analytics Platform

A one-stop data analytics workbench. Upload a CSV or Excel file and get instant
full exploratory data analysis (EDA), column-wise deep dives, correlation
matrices, outlier detection, rule-based AI insights, and export to
PPTX/Markdown — all without switching tools.

## Stack

- **Monorepo:** pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend:** React 19 + Vite + Tailwind CSS + Recharts + Framer Motion
- **API:** Express 5 + Multer (file upload)
- **Database:** PostgreSQL + Drizzle ORM (stores dataset metadata only)
- **EDA engine:** pure TypeScript (papaparse + xlsx) — no Python dependency
- **AI Snapshot:** deterministic rule-based statistical engine — no external LLM API needed
- **Export:** pptxgenjs (PPTX), Markdown report generator
- **Validation:** Zod, drizzle-zod
- **API codegen:** Orval, generating typed hooks + Zod schemas from an OpenAPI spec

## Prerequisites

- Node.js 24+
- [pnpm](https://pnpm.io/) (`corepack enable` will give you the right version automatically)
- A PostgreSQL database (local, Docker, or a hosted instance like Neon/Supabase/RDS)

## Getting started

```bash
git clone <this-repo-url>
cd datacanvas
pnpm install
```

Set the required environment variable(s) — most deploy platforms (Vercel, Render, Railway, Docker, etc.) let you set these in their dashboard/config directly. For **local development**, this project does not auto-load a `.env` file (there's no `dotenv` dependency wired in), so export them in your shell:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/datacanvas
```

`.env.example` at the repo root documents every variable the app reads — copy it to `.env` for reference, or use a tool like [`direnv`](https://direnv.net/) or `dotenv-cli` if you'd rather have it loaded automatically.

Push the database schema:

```bash
pnpm --filter @workspace/db run push
```

Run the app in two terminals:

```bash
# Terminal 1 — API server (defaults to port 8080)
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend (defaults to port 5173)
pnpm --filter @workspace/datacanvas run dev
```

Open `http://localhost:5173`.

### Environment variables

| Variable            | Where             | Required | Default                              | Purpose                                                 |
| ------------------- | ----------------- | -------- | ------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`      | api-server, db     | Yes      | —                                      | Postgres connection string                              |
| `PORT`              | api-server         | No       | `8080`                                | Port the Express API listens on                         |
| `PORT`              | frontend (Vite)    | No       | `5173`                                | Port the Vite dev server listens on                      |
| `BASE_PATH`         | frontend (Vite)    | No       | `/`                                    | Base path to serve the app under (for subpath deploys)  |
| `API_PROXY_TARGET`  | frontend (Vite)    | No       | `http://localhost:${API_PORT\|8080}`   | Where `/api` requests are proxied to in dev              |

## Available scripts

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec (run after editing `lib/api-spec/openapi.yaml`)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/db run push-force` — same, but force through destructive changes

## Project structure

```
artifacts/
  datacanvas/        # React + Vite frontend
  api-server/         # Express API
lib/
  api-spec/           # OpenAPI contract (source of truth)
  api-zod/             # Generated Zod schemas from the spec
  api-client-react/   # Generated React Query hooks from the spec
  db/                 # Drizzle schema + Postgres client
scripts/               # One-off / maintenance scripts
```

Key files:

- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/datasets.ts` — DB schema (metadata only; raw data is cached as JSON on disk)
- `artifacts/api-server/src/lib/eda-engine.ts` — EDA, correlation, outlier, and AI snapshot logic
- `artifacts/api-server/src/lib/report-generator.ts` — Markdown report generator
- `artifacts/api-server/src/routes/datasets.ts` — dataset/EDA/export route handlers
- `artifacts/api-server/uploads/` — uploaded files (gitignored)
- `artifacts/api-server/cache/` — per-dataset parsed data and EDA results, cached as JSON (gitignored)

## Architecture notes

- Raw file data is stored on disk, not in the DB — the DB holds only metadata, and parsed JSON is cached per dataset for fast re-analysis without re-parsing.
- The EDA engine is 100% TypeScript, no Python/pandas dependency, and runs in-process with Express for low latency.
- AI Snapshot uses a deterministic rule-based engine rather than an LLM API — no external API key or network dependency required.
- File uploads use Multer with a 50MB limit; CSV parsing via papaparse (streaming-safe), Excel via the `xlsx` library.
- PPTX export uses `pptxgenjs` server-side to produce a real `.pptx` binary with styled slides.

## Features

- Upload CSV or Excel → instant dataset card on the dashboard
- Dataset detail view → full metadata header with status chips (rows × cols, size, type)
- EDA Explorer → numeric + categorical stats, histograms, missing-value charts
- Column Deep Dive → single-column stats + distribution chart
- Correlation Matrix → interactive color-coded heatmap + sorted pair list
- Outlier Detection → IQR-based per-column outlier counts
- AI Snapshot → executive summary, data quality score, severity-rated insights, recommendations
- Query Builder → filter + group-by + aggregation with live results
- Export Center → download a PPTX presentation or Markdown report

## Known limitations

- The `/export/pdf` route currently produces a `.pptx` file (named for API simplicity) — there is no PDF export path yet.
- The file cache in `artifacts/api-server/cache/` is not cleared on server restart; delete it manually if you suspect stale data.
- After any OpenAPI spec change, run the `api-spec` codegen command before touching route or frontend code, and run `pnpm run typecheck:libs` after any `lib/*` change before checking the leaf packages.

## License

MIT
