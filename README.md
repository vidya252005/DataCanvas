# DataCanvas — System Design Case Study

A full-stack analytics platform: upload a CSV/XLSX, get back statistical
EDA, correlation analysis, outlier detection, and an AI-generated executive
summary — architected for concurrent load and a flaky third-party AI
dependency, not just a happy-path demo.

**Stack:** TypeScript · React · Express · PostgreSQL (Drizzle ORM) · Piscina
(worker threads) · Opossum (circuit breaker) · OpenAPI + Orval codegen ·
pnpm monorepo (8 workspace packages)

---
## 📺 Project Demo
https://res.cloudinary.com/ovqlquj4/video/upload/vc_auto/DataCanvas_wioeds.mp4

## Problem Statement

In an organization, analysts and data scientists often have to transform a raw file into a
A set of statistics and information that can be used relatively easily, and the naive version of such a tool.
— Parse on Request — Compute on Request — Call LLM on Request — breaks
The conditions were simulated in three real cases:

1. CPU-bound work is heavy. Full EDA (per-column stats, correlation
   The matrix, IQR outlier scan) is a real synchronous CPU time on a large file.
2. Third party dependency called AI layer, which you have no control over. It can
   Be slow, rate-limited, or down, and a request-response API design
   Passes on that unreliability.
A single user) can simultaneously access and modify a file.
   one user (with several open tabs) will lawfully request the same
   At the same time, a not-yet-computed resource.

The aim was to maintain the system at a consistent speed and correctness under all three,
Just on a local, one user demo.

---

## System Overview & Architecture

```mermaid
flowchart TB
    subgraph Client["React SPA (Vite)"]
        UI[Dashboard / EDA / AI Snapshot pages]
    end

    subgraph API["Express API Server"]
        Routes[Routes layer]
        Cache["TieredCache\n(L1 in-memory LRU + L2 disk)"]
        Jobs["AI Snapshot job table\n(single-flight)"]
        Breaker["Circuit breaker + retry\n(Opossum)"]
    end

    subgraph Workers["Piscina worker-thread pool\n(cores − 1 threads)"]
        Parse[parseFile]
        EDA[runFullEda]
        Corr[computeCorrelationMatrix]
        Out[detectOutliers]
    end

    DB[(PostgreSQL\nvia Drizzle ORM)]
    Gemini[[Gemini LLM API]]

    UI -- "REST (OpenAPI-typed client)" --> Routes
    Routes --> Cache
    Routes -- "offload CPU work" --> Workers
    Routes --> DB
    Routes --> Jobs
    Jobs --> Breaker
    Breaker -- "retry + backoff" --> Gemini
    Breaker -- "fallback on failure/open" --> Routes
    Cache -. "L2 write-through" .-> Disk[(Disk JSON)]
```

## Key architectural choices:
- Contract-first API: A single OpenAPI spec is the source of truth; Orval
  codegen will generate both the Zod validators on the server side and the typed React client.
  Ask the client, so the 8 packages in the monorepo don't get out-of-sync.
- Compute isolation: All CPU intensive tasks are executed in a bounded worker-thread.
  Don't use the pool on the thread handling the HTTP connections.
For external latencies, Async-first. The one route that third-party API (AI Snapshot) is a call that is intended to run as a background operation not a long-polling HTTP request, with client-side polling.

---

## Screenshots

*(Add these once captured — recommended shots below)*

| Screenshot | What it should show |
|---|---|
| `dashboard.png` | <img width="1440" height="812" alt="Datacanvas" src="https://github.com/user-attachments/assets/8ea872d3-b32e-482e-aacf-bcad14719fd9" />




t |
| `eda-explorer.png` |<img width="1440" height="809" alt="Screenshot 2026-07-12 at 14 55 49" src="https://github.com/user-attachments/assets/ade2ad00-7b56-4a64-a8fe-b8634abcb8ae" /> |
| `correlation-matrix.png` | <img width="1437" height="789" alt="Screenshot 2026-07-12 at 14 56 22" src="https://github.com/user-attachments/assets/fe60f364-e2af-4164-a9f3-34676835c28e" /> |
| `ai-snapshot.png` | <img width="1440" height="814" alt="Screenshot 2026-07-12 at 14 56 42" src="https://github.com/user-attachments/assets/22598d96-aeec-45f8-8c57-d2dd424973f8" /> |


---

## Key Decisions & Tradeoffs

| Decision | Alternative considered | Why this choice |
|---|---|---|
| Async job + polling for AI Snapshot | Hold the HTTP request open until the LLM responds | A held request has no recovery path if the connection drops mid-wait; polling makes the in-progress state a first-class, resumable thing a client can reconnect to |
| In-process job table + LRU/disk cache | Redis from day one | Single-instance deployment doesn't need distributed state yet; both are built behind small interfaces (`TieredCache`, the jobs map) specifically so the swap to Redis/S3 is localized, not a rewrite |
| Bounded worker-thread pool (Piscina) | Spawn a fresh worker per request, or run inline | A persistent pool amortizes thread-startup cost across requests while still capping total CPU parallelism at cores − 1, so the pool itself can't starve the event loop |
| Circuit breaker + 1 retry, not unlimited retries | Retry until success | Unlimited retries on a sustained outage just relocates the latency problem; a breaker that opens after repeated failures and self-heals via a half-open trial keeps failure cost bounded and constant |
| 200 + status field, not 202 Accepted, for the job endpoint | True REST 202 semantics | Keeps the OpenAPI-generated client's return type single-shaped — the polling logic only branches on the JSON body, not on HTTP status, which is simpler to generate and consume correctly |
| Rate limit only upload + AI Snapshot | Blanket rate limiting on all routes | Those two are the only routes with real per-request cost (disk I/O + worker CPU; a billed external API call) — limiting cheap DB-lookup routes would add overhead for no actual protection |

---

## Why It Matters

- **User-facing latency:** AI Snapshot's initial response time dropped from
  as much as **~25,000ms** (worst case, blocking on the LLM call) to a
  measured **74ms** to acknowledge the request and hand back a job to poll.
- **Failure cost is bounded, not open-ended:** with a deliberately invalid
  API key, the retry-then-fallback path completed in a measured **912ms**
  — the user gets a usable rule-based result in under a second instead of
  waiting out a ~19–25s timeout on every single request during an outage.
- **No duplicate external API spend:** firing 3 concurrent requests at the
  same not-yet-computed dataset resulted in exactly **1** LLM call, not 3 —
  single-flight coalescing turns an O(concurrent users) cost into O(1) per
  resource.
- **Response payload shrank from O(n) to O(1)** for the summary endpoint by
  moving aggregation into a SQL `SUM`/`COUNT` instead of fetching every row
  into Node to reduce over — this matters more every row the dataset table
  grows.
- **Compression** on the EDA/correlation JSON responses (which are exactly
  the repetitive shape gzip handles well) typically cuts payload size by
  roughly 70–85% for this kind of data — worth confirming with a real
  before/after measurement on your actual dataset sizes if you want an
  exact number for an interview.

---

## What I'd Improve Next

- **Real load testing.** Everything above is verified correct and measured
  for individual requests; I haven't yet run a proper concurrent-load
  benchmark (e.g. `autocannon`/`k6`) to get p50/p95/p99 numbers under, say,
  50 concurrent users. That's the natural next artifact — it would turn
  "designed for concurrency" into a number I could put on a slide.
- **Move shared state to Redis** once this needs more than one instance —
  the job table and cache are already interface-shaped for it.
- **Push the query builder into a real queryable engine** (DuckDB per
  dataset, most likely) instead of filtering/aggregating cached rows in JS
  — the natural ceiling of the current approach as dataset sizes grow.
- **Observability.** Structured logs exist (pino); no metrics/tracing yet.
  Adding request-duration histograms and a dashboard (even just
  Prometheus + Grafana locally) would make the latency claims above
  self-verifying instead of manually curl-timed.
- **WebSocket/SSE instead of polling** for the AI Snapshot job status, once
  there's a reason polling's ~1.2s latency floor actually matters.
- **Object storage (S3) for uploaded files** instead of local disk, as the
  actual prerequisite for running more than one api-server instance.
