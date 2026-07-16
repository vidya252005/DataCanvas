# DataCanvas — System Design Case Study

Upload a CSV/XLSX, get back statistical EDA, correlation analysis, outlier detection, and an AI-generated executive summary. I built this to survive concurrent load and a flaky third-party AI dependency, not just to work as a single-user demo.

**Stack:** TypeScript · React · Express · PostgreSQL (Drizzle ORM) · Piscina (worker threads) · Opossum (circuit breaker) · OpenAPI + Orval codegen · pnpm monorepo (8 workspace packages)

## Demo

https://res.cloudinary.com/ovqlquj4/video/upload/vc_auto/DataCanvas_wioeds.mp4

## Why I built it this way

The naive version of this — parse on request, compute on request, call an LLM on request — breaks under three conditions I wanted the system to actually handle:

1. **EDA is real CPU work.** Per-column stats, a correlation matrix, and an IQR outlier scan on a large file is synchronous CPU time, and I didn't want that blocking the server.
2. **The AI layer isn't mine to control.** It can be slow, rate-limited, or down, and a plain request-response design inherits that unreliability directly.
3. **Concurrency is normal, not an edge case.** Multiple users — or one user with two open tabs — will legitimately hit the same not-yet-computed resource at the same time.

## Architecture

```
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

**A few decisions worth explaining:**

- **Contract-first API.** One OpenAPI spec is the source of truth. Orval generates both the server-side Zod validators and the typed React Query client, so the 8 packages can't drift out of sync with each other.
- **Compute isolation.** All CPU-bound work runs in a bounded worker-thread pool — never on the thread handling HTTP connections.
- **Async by default for anything with external latency.** The one route that calls a third-party API (AI Snapshot) runs as a background job with client-side polling instead of holding an HTTP connection open.

## Key decisions and tradeoffs

| Decision | Alternative I considered | Why I went this way |
|---|---|---|
| Async job + polling for AI Snapshot | Hold the HTTP request open until the LLM responds | A held request has no recovery path if the connection drops mid-wait. Polling makes "in progress" a first-class state a client can reconnect to. |
| In-process job table + LRU/disk cache | Redis from day one | Single-instance deployment doesn't need distributed state yet, but I built both behind small interfaces (`TieredCache`, the jobs map) so swapping to Redis/S3 later is localized, not a rewrite. |
| Bounded worker-thread pool (Piscina) | Spawn a fresh worker per request, or run inline | A persistent pool amortizes thread-startup cost across requests while capping total CPU parallelism at cores − 1, so the pool can't starve the event loop. |
| Circuit breaker + 1 retry, not unlimited retries | Retry until success | Unlimited retries during a sustained outage just relocates the latency problem. A breaker that opens and self-heals via a half-open trial keeps failure cost bounded. |
| 200 + status field instead of true 202 semantics | Real REST 202 Accepted | Keeps the OpenAPI-generated client's return type single-shaped — polling logic only branches on the JSON body, which is simpler to generate and consume correctly. |
| Rate limiting only on upload + AI Snapshot | Blanket rate limiting on all routes | Those two are the only routes with real per-request cost (disk I/O + worker CPU, or a billed external API call). Limiting cheap DB-lookup routes adds overhead for no real protection. |

## Results

- **AI Snapshot's initial response time** dropped from as much as ~25,000ms (worst case, blocking on the LLM call) to a measured **74ms** to acknowledge the request and hand back a pollable job.
- **Failure cost is bounded, not open-ended.** With a deliberately invalid API key, the retry-then-fallback path completed in **912ms** — a usable rule-based result in under a second instead of a 19–25s timeout on every request during an outage.
- **No duplicate external API spend.** Firing 3 concurrent requests at the same not-yet-computed dataset resulted in exactly **1** LLM call, not 3 — single-flight coalescing turns an O(concurrent users) cost into O(1) per resource.
- **Response payload for the summary endpoint** moved from O(n) to O(1) by aggregating with SQL `SUM`/`COUNT` instead of pulling every row into Node.
- **Gzip compression** on the EDA/correlation JSON typically cuts payload size 70–85% for this kind of repetitive data (worth re-measuring on real dataset sizes rather than treating this as a fixed number).

## Screenshots
| Screenshot | What it should show |
|---|---|
| `dashboard.png` | <img width="1440" height="812" alt="Datacanvas" src="https://github.com/user-attachments/assets/8ea872d3-b32e-482e-aacf-bcad14719fd9" />




t |
| `eda-explorer.png` |<img width="1440" height="809" alt="Screenshot 2026-07-12 at 14 55 49" src="https://github.com/user-attachments/assets/ade2ad00-7b56-4a64-a8fe-b8634abcb8ae" /> |
| `correlation-matrix.png` | <img width="1437" height="789" alt="Screenshot 2026-07-12 at 14 56 22" src="https://github.com/user-attachments/assets/fe60f364-e2af-4164-a9f3-34676835c28e" /> |
| `ai-snapshot.png` | <img width="1440" height="814" alt="Screenshot 2026-07-12 at 14 56 42" src="https://github.com/user-attachments/assets/22598d96-aeec-45f8-8c57-d2dd424973f8" /> |

## What I'd improve next

- **Real load testing.** Everything above is correct and measured for individual requests, but I haven't run a proper concurrent-load benchmark (`autocannon`/`k6`) to get p50/p95/p99 under, say, 50 concurrent users. That's the natural next step.
- **Move shared state to Redis** once this needs more than one instance — the job table and cache are already interface-shaped for the swap.
- **Push the query builder into a real queryable engine** (DuckDB per dataset, most likely) instead of filtering/aggregating cached rows in JS — that's the natural ceiling of the current approach as datasets grow.
- **Add observability.** Structured logs exist (pino), but there's no metrics/tracing yet. Request-duration histograms and a basic Prometheus + Grafana setup would make the latency numbers above self-verifying instead of manually timed.
- **Switch AI Snapshot to WebSocket/SSE** instead of polling once the ~1.2s polling latency floor actually starts to matter.
- **Move uploaded files to S3** instead of local disk — the real prerequisite for running more than one API server instance.

