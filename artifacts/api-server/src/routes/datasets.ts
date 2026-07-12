import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { db, datasetsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { parseFile, runFullEda, computeCorrelationMatrix, detectOutliers, generateAiSnapshot } from "../lib/eda-engine";
import { generateMarkdownReport } from "../lib/report-generator";

const router = Router();

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();

const uploadsDir = path.resolve(workspaceRoot, "artifacts/api-server/uploads");
const cacheDir = path.resolve(workspaceRoot, "artifacts/api-server/cache");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => cb(null, `${randomUUID()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

function getCachePath(id: string, key: string) {
  return path.join(cacheDir, `${id}-${key}.json`);
}
function readCache<T>(id: string, key: string): T | null {
  const p = getCachePath(id, key);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, "utf-8")) as T; } catch { return null; }
  }
  return null;
}
function writeCache(id: string, key: string, data: unknown) {
  fs.writeFileSync(getCachePath(id, key), JSON.stringify(data));
}

function mapDataset(d: typeof datasetsTable.$inferSelect) {
  return {
    id: d.id,
    name: d.name,
    originalName: d.originalName,
    rowCount: d.rowCount,
    columnCount: d.columnCount,
    fileSizeBytes: d.fileSizeBytes,
    fileType: d.fileType,
    uploadedAt: d.uploadedAt,
    columns: JSON.parse(d.columnsJson) as string[],
  };
}

router.get("/datasets/summary", async (req, res) => {
  try {
    const datasets = await db.select().from(datasetsTable).orderBy(desc(datasetsTable.uploadedAt)).limit(5);
    const allDatasets = await db.select().from(datasetsTable);
    const totalRows = allDatasets.reduce((a, d) => a + d.rowCount, 0);
    const totalColumns = allDatasets.reduce((a, d) => a + d.columnCount, 0);
    res.json({
      totalDatasets: allDatasets.length,
      totalRows,
      totalColumns,
      lastUploadedAt: datasets[0]?.uploadedAt ?? null,
      recentDatasets: datasets.map(mapDataset),
    });
  } catch (err) {
    req.log.error({ err }, "summary error");
    res.status(500).json({ error: "Failed to get summary" });
  }
});

router.get("/datasets", async (req, res) => {
  try {
    const datasets = await db.select().from(datasetsTable).orderBy(desc(datasetsTable.uploadedAt));
    res.json(datasets.map(mapDataset));
  } catch (err) {
    req.log.error({ err }, "list datasets error");
    res.status(500).json({ error: "Failed to list datasets" });
  }
});

router.post("/datasets", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large. Maximum upload size is 200 MB." });
      return;
    }
    if (err) { next(err); return; }
    next();
  });
}, async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const ext = path.extname(req.file.originalname).toLowerCase().replace(".", "");
  const fileType = ["csv", "xlsx", "xls"].includes(ext) ? ext : "csv";
  const id = randomUUID();
  const customName = (req.body as Record<string, string>).name || req.file.originalname.replace(/\.[^.]+$/, "");

  try {
    const parsed = parseFile(req.file.path, fileType);
    const memorySizeMb = parseFloat(((JSON.stringify(parsed.rows).length * 2) / 1024 / 1024).toFixed(2));

    await db.insert(datasetsTable).values({
      id,
      name: customName,
      originalName: req.file.originalname,
      rowCount: parsed.rows.length,
      columnCount: parsed.columns.length,
      fileSizeBytes: req.file.size,
      fileType,
      storagePath: req.file.path,
      columnsJson: JSON.stringify(parsed.columns),
      memorySizeMb,
    });

    writeCache(id, "parsed", { rows: parsed.rows, columns: parsed.columns, columnTypes: parsed.columnTypes });

    const dataset = await db.select().from(datasetsTable).where(eq(datasetsTable.id, id)).limit(1);
    res.status(201).json(mapDataset(dataset[0]));
  } catch (err) {
    req.log.error({ err }, "upload error");
    fs.unlinkSync(req.file.path);
    res.status(500).json({ error: "Failed to process file" });
  }
});

router.get("/datasets/:id", async (req, res) => {
  try {
    const dataset = await db.select().from(datasetsTable).where(eq(datasetsTable.id, req.params.id)).limit(1);
    if (!dataset[0]) { res.status(404).json({ error: "Not found" }); return; }

    const cached = readCache<{ rows: Record<string, unknown>[]; columns: string[]; columnTypes: Record<string, string> }>(req.params.id, "parsed");
    let previewRows: Record<string, unknown>[] = [];
    let columnTypes: Record<string, string> = {};
    let nullCounts: Record<string, number> = {};

    if (cached) {
      previewRows = cached.rows.slice(0, 50);
      columnTypes = cached.columnTypes;
      for (const col of cached.columns) {
        nullCounts[col] = cached.rows.filter((r) => r[col] === null || r[col] === undefined || r[col] === "").length;
      }
    }

    res.json({
      dataset: mapDataset(dataset[0]),
      previewRows,
      columnTypes,
      nullCounts,
      memorySizeMb: dataset[0].memorySizeMb,
    });
  } catch (err) {
    req.log.error({ err }, "get dataset error");
    res.status(500).json({ error: "Failed to get dataset" });
  }
});

router.delete("/datasets/:id", async (req, res) => {
  try {
    const dataset = await db.select().from(datasetsTable).where(eq(datasetsTable.id, req.params.id)).limit(1);
    if (!dataset[0]) { res.status(404).json({ error: "Not found" }); return; }
    if (fs.existsSync(dataset[0].storagePath)) fs.unlinkSync(dataset[0].storagePath);
    for (const key of ["parsed", "eda", "correlation", "outliers", "ai-snapshot"]) {
      const p = getCachePath(req.params.id, key);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    await db.delete(datasetsTable).where(eq(datasetsTable.id, req.params.id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "delete dataset error");
    res.status(500).json({ error: "Failed to delete dataset" });
  }
});

router.get("/datasets/:id/eda", async (req, res) => {
  try {
    const dataset = await db.select().from(datasetsTable).where(eq(datasetsTable.id, req.params.id)).limit(1);
    if (!dataset[0]) { res.status(404).json({ error: "Not found" }); return; }

    const cached = readCache(req.params.id, "eda");
    if (cached) { res.json(cached); return; }

    const parsed = readCache<{ rows: Record<string, unknown>[]; columns: string[]; columnTypes: Record<string, string> }>(req.params.id, "parsed");
    if (!parsed) { res.status(400).json({ error: "Dataset data not available — re-upload the file" }); return; }

    const eda = runFullEda(parsed.rows, parsed.columns, parsed.columnTypes);
    const result = { datasetId: req.params.id, ...eda };
    writeCache(req.params.id, "eda", result);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "eda error");
    res.status(500).json({ error: "EDA computation failed" });
  }
});

router.get("/datasets/:id/columns/:column", async (req, res) => {
  try {
    const parsed = readCache<{ rows: Record<string, unknown>[]; columns: string[]; columnTypes: Record<string, string> }>(req.params.id, "parsed");
    if (!parsed) { res.status(404).json({ error: "Dataset not found" }); return; }

    const col = req.params.column;
    if (!parsed.columns.includes(col)) { res.status(404).json({ error: "Column not found" }); return; }

    const dtype = parsed.columnTypes[col] || "categorical";
    const values = parsed.rows.map((r) => r[col]);
    const nullCount = values.filter((v) => v === null || v === undefined || v === "").length;
    const nullPct = parseFloat(((nullCount / values.length) * 100).toFixed(2));
    const sampleValues = [...new Set(values.filter((v) => v !== null && v !== undefined && v !== "").map(String))].slice(0, 10);
    const uniqueCount = new Set(values.filter((v) => v !== null && v !== undefined && v !== "").map(String)).size;

    let numericStats = null;
    let categoricalStats = null;
    let distributionData: unknown[] = [];

    if (dtype === "numeric") {
      const nums = values.map(Number).filter((v) => !isNaN(v));
      const { computeNumericStats } = await import("../lib/eda-engine");
      numericStats = computeNumericStats(nums, col);
      if (numericStats) distributionData = numericStats.histogram;
    } else {
      const { computeCategoricalStats } = await import("../lib/eda-engine");
      categoricalStats = computeCategoricalStats(values as (string | null)[], col);
      distributionData = categoricalStats.topValues;
    }

    res.json({ column: col, dtype, nullCount, nullPct, uniqueCount, sampleValues, numericStats, categoricalStats, distributionData });
  } catch (err) {
    req.log.error({ err }, "column analysis error");
    res.status(500).json({ error: "Column analysis failed" });
  }
});

router.get("/datasets/:id/correlation", async (req, res) => {
  try {
    const cached = readCache(req.params.id, "correlation");
    if (cached) { res.json(cached); return; }

    const parsed = readCache<{ rows: Record<string, unknown>[]; columns: string[]; columnTypes: Record<string, string> }>(req.params.id, "parsed");
    if (!parsed) { res.status(404).json({ error: "Dataset not found" }); return; }

    const numericCols = parsed.columns.filter((c) => parsed.columnTypes[c] === "numeric");
    if (numericCols.length < 2) { res.json({ columns: numericCols, matrix: [], pairs: [] }); return; }

    const result = computeCorrelationMatrix(parsed.rows, numericCols);
    writeCache(req.params.id, "correlation", result);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "correlation error");
    res.status(500).json({ error: "Correlation computation failed" });
  }
});

router.get("/datasets/:id/outliers", async (req, res) => {
  try {
    const cached = readCache(req.params.id, "outliers");
    if (cached) { res.json(cached); return; }

    const parsed = readCache<{ rows: Record<string, unknown>[]; columns: string[]; columnTypes: Record<string, string> }>(req.params.id, "parsed");
    if (!parsed) { res.status(404).json({ error: "Dataset not found" }); return; }

    const numericCols = parsed.columns.filter((c) => parsed.columnTypes[c] === "numeric");
    const result = detectOutliers(parsed.rows, numericCols);
    writeCache(req.params.id, "outliers", result);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "outliers error");
    res.status(500).json({ error: "Outlier detection failed" });
  }
});

router.post("/datasets/:id/ai-snapshot", async (req, res) => {
  try {
    const cached = readCache(req.params.id, "ai-snapshot");
    if (cached) { res.json(cached); return; }

    const parsed = readCache<{ rows: Record<string, unknown>[]; columns: string[]; columnTypes: Record<string, string> }>(req.params.id, "parsed");
    if (!parsed) { res.status(404).json({ error: "Dataset not found" }); return; }

    let edaResult = readCache<ReturnType<typeof runFullEda>>(req.params.id, "eda");
    if (!edaResult) {
      edaResult = runFullEda(parsed.rows, parsed.columns, parsed.columnTypes);
      writeCache(req.params.id, "eda", { datasetId: req.params.id, ...edaResult });
    }

    // Try Grok AI first, fall back to rule-based engine
    let snapshot: ReturnType<typeof generateAiSnapshot>;
    const grokKey = process.env.GROK_API_KEY;
    if (grokKey) {
      try {
        const numSummary = edaResult.numericColumns.slice(0, 8).map(c =>
          `  ${c.column}: mean=${c.mean.toFixed(2)}, std=${c.std.toFixed(2)}, min=${c.min.toFixed(2)}, max=${c.max.toFixed(2)}, skewness=${c.skewness.toFixed(2)}, nulls=${c.nullCount}`
        ).join("\n");
        const catSummary = edaResult.categoricalColumns.slice(0, 8).map(c =>
          `  ${c.column}: unique=${c.uniqueCount}, nulls=${c.nullCount}, top="${c.topValues[0]?.value}" (${c.topValues[0]?.pct}%)`
        ).join("\n");
        const missSummary = edaResult.missingValues.slice(0, 8).map(m =>
          `  ${m.column}: ${m.count} missing (${m.pct}%)`
        ).join("\n") || "  None";

        const prompt = `You are a senior data scientist. Analyze this dataset and return a JSON object.

Dataset: ${parsed.rows.length.toLocaleString()} rows × ${parsed.columns.length} columns
Numeric columns (${edaResult.numericColumns.length}):
${numSummary || "  None"}
Categorical columns (${edaResult.categoricalColumns.length}):
${catSummary || "  None"}
Missing values:
${missSummary}
Duplicate rows: ${edaResult.duplicateRows}

Return ONLY valid JSON with this exact shape:
{
  "executiveSummary": "2-3 sentence professional summary",
  "keyFindings": ["finding1", "finding2", "finding3", "finding4"],
  "dataQualityScore": <integer 0-100>,
  "dataQualityIssues": ["issue1"],
  "patternInsights": [
    {"title": "...", "description": "...", "severity": "info|warning|critical", "affectedColumns": ["col1"]}
  ],
  "recommendations": ["rec1", "rec2", "rec3", "rec4"],
  "unusualFindings": ["finding1"],
  "businessImplications": "2-3 sentences on business relevance",
  "suggestedAnalyses": ["analysis1", "analysis2", "analysis3"]
}`;

        const grokRes = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${grokKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "grok-3-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
            max_tokens: 1200,
          }),
          signal: AbortSignal.timeout(25000),
        });

        if (grokRes.ok) {
          const grokData = await grokRes.json() as { choices: { message: { content: string } }[] };
          const raw = grokData.choices[0]?.message?.content ?? "";
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            snapshot = JSON.parse(jsonMatch[0]) as ReturnType<typeof generateAiSnapshot>;
            req.log.info("AI snapshot generated via Grok");
          } else throw new Error("No JSON in Grok response");
        } else throw new Error(`Grok API ${grokRes.status}`);
      } catch (grokErr) {
        req.log.warn({ err: grokErr }, "Grok AI failed, falling back to rule-based engine");
        snapshot = generateAiSnapshot(parsed.rows, parsed.columns, parsed.columnTypes, edaResult);
      }
    } else {
      snapshot = generateAiSnapshot(parsed.rows, parsed.columns, parsed.columnTypes, edaResult);
    }

    writeCache(req.params.id, "ai-snapshot", snapshot);
    res.json(snapshot);
  } catch (err) {
    req.log.error({ err }, "ai snapshot error");
    res.status(500).json({ error: "AI snapshot generation failed" });
  }
});

router.post("/datasets/:id/query", async (req, res) => {
  try {
    const parsed = readCache<{ rows: Record<string, unknown>[]; columns: string[]; columnTypes: Record<string, string> }>(req.params.id, "parsed");
    if (!parsed) { res.status(404).json({ error: "Dataset not found" }); return; }

    const start = Date.now();
    const { filters = [], groupBy, aggregation, aggColumn, limit = 500, sortBy, sortDir = "asc" } = req.body as {
      filters?: { column: string; operator: string; value?: string }[];
      groupBy?: string;
      aggregation?: string;
      aggColumn?: string;
      limit?: number;
      sortBy?: string;
      sortDir?: string;
    };

    let rows = [...parsed.rows];

    for (const f of filters) {
      rows = rows.filter((r) => {
        const v = r[f.column];
        const fv = f.value;
        switch (f.operator) {
          case "eq": return String(v) === fv;
          case "neq": return String(v) !== fv;
          case "gt": return Number(v) > Number(fv);
          case "gte": return Number(v) >= Number(fv);
          case "lt": return Number(v) < Number(fv);
          case "lte": return Number(v) <= Number(fv);
          case "contains": return String(v).toLowerCase().includes((fv || "").toLowerCase());
          case "not_contains": return !String(v).toLowerCase().includes((fv || "").toLowerCase());
          case "is_null": return v === null || v === undefined || v === "";
          case "not_null": return v !== null && v !== undefined && v !== "";
          default: return true;
        }
      });
    }

    let resultRows: Record<string, unknown>[] = rows;
    let resultColumns = parsed.columns;

    if (groupBy && parsed.columns.includes(groupBy)) {
      const groups: Record<string, Record<string, unknown>[]> = {};
      for (const r of rows) {
        const key = String(r[groupBy] ?? "__null__");
        groups[key] = groups[key] || [];
        groups[key].push(r);
      }
      resultRows = Object.entries(groups).map(([key, group]) => {
        const row: Record<string, unknown> = { [groupBy]: key === "__null__" ? null : key, count: group.length };
        if (aggregation && aggColumn && parsed.columns.includes(aggColumn)) {
          const nums = group.map((r) => Number(r[aggColumn])).filter((v) => !isNaN(v));
          if (aggregation === "sum") row[`sum_${aggColumn}`] = nums.reduce((a, b) => a + b, 0);
          if (aggregation === "mean") row[`mean_${aggColumn}`] = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
          if (aggregation === "min") row[`min_${aggColumn}`] = nums.length ? Math.min(...nums) : null;
          if (aggregation === "max") row[`max_${aggColumn}`] = nums.length ? Math.max(...nums) : null;
        }
        return row;
      });
      resultColumns = Object.keys(resultRows[0] || {});
    }

    if (sortBy && resultRows.length > 0 && sortBy in (resultRows[0] || {})) {
      resultRows.sort((a, b) => {
        const av = a[sortBy], bv = b[sortBy];
        const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
        return sortDir === "desc" ? -cmp : cmp;
      });
    }

    const totalCount = resultRows.length;
    const limitedRows = resultRows.slice(0, Math.min(limit, 1000));

    res.json({ rows: limitedRows, totalCount, columns: resultColumns, executionTimeMs: Date.now() - start });
  } catch (err) {
    req.log.error({ err }, "query error");
    res.status(500).json({ error: "Query execution failed" });
  }
});

router.post("/datasets/:id/export/report", async (req, res) => {
  try {
    const dataset = await db.select().from(datasetsTable).where(eq(datasetsTable.id, req.params.id)).limit(1);
    if (!dataset[0]) { res.status(404).json({ error: "Not found" }); return; }

    const eda = readCache<Record<string, unknown>>(req.params.id, "eda");
    const ai = readCache<Record<string, unknown>>(req.params.id, "ai-snapshot");
    const options = req.body as { title?: string; includeAi?: boolean; includeRawStats?: boolean };

    const content = generateMarkdownReport(dataset[0], eda || {}, options.includeAi !== false ? ai : null, options);
    const filename = `${dataset[0].name.replace(/\s+/g, "_")}_report_${Date.now()}.md`;

    res.json({ format: "markdown", content, filename, generatedAt: new Date().toISOString() });
  } catch (err) {
    req.log.error({ err }, "export report error");
    res.status(500).json({ error: "Export failed" });
  }
});

router.post("/datasets/:id/export/pdf", async (req, res) => {
  try {
    const dataset = await db.select().from(datasetsTable).where(eq(datasetsTable.id, req.params.id)).limit(1);
    if (!dataset[0]) { res.status(404).json({ error: "Not found" }); return; }

    const eda = readCache<Record<string, unknown>>(req.params.id, "eda") as {
      numericColumns?: { column: string; mean: number; std: number; min: number; max: number; median: number; q25: number; q75: number; skewness: number; kurtosis: number; nullCount: number }[];
      categoricalColumns?: { column: string; uniqueCount: number; nullCount: number; topValues: { value: string; count: number; pct: number }[]; entropy: number }[];
      missingValues?: { column: string; count: number; pct: number }[];
      duplicateRows?: number;
      shape?: { rows: number; cols: number };
      memoryUsageMb?: number;
    } | null;
    const ai = readCache<Record<string, unknown>>(req.params.id, "ai-snapshot") as {
      executiveSummary?: string; keyFindings?: string[]; dataQualityScore?: number;
      dataQualityIssues?: string[]; patternInsights?: { title: string; description: string; severity: string; affectedColumns: string[] }[];
      recommendations?: string[]; unusualFindings?: string[]; businessImplications?: string; suggestedAnalyses?: string[];
    } | null;
    const corr = readCache<Record<string, unknown>>(req.params.id, "correlation") as {
      columns?: string[]; pairs?: { col1: string; col2: string; r: number }[];
    } | null;
    const outliersRaw = readCache<{ columns: { column: string; count: number; pct: number; lowerBound: number; upperBound: number }[] }>(req.params.id, "outliers");
    const outliers = outliersRaw?.columns ?? [];

    const d = dataset[0];
    const now = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const numCols = eda?.numericColumns ?? [];
    const catCols = eda?.categoricalColumns ?? [];
    const missingVals = eda?.missingValues ?? [];
    const score = ai?.dataQualityScore ?? 0;
    const scoreColor = score >= 80 ? "#217346" : score >= 60 ? "#e1700e" : "#d13438";

    const tableStyle = `border-collapse:collapse;width:100%;font-size:11px;margin-bottom:20px`;
    const thStyle = `background:#1e3a5f;color:#fff;padding:6px 10px;text-align:left;font-weight:600;font-size:10px;`;
    const tdStyle = `padding:5px 10px;border-bottom:1px solid #e5e7eb;`;
    const td2Style = `padding:5px 10px;border-bottom:1px solid #e5e7eb;background:#f9fafb;`;

    const makeTable = (headers: string[], rows: string[][]): string => {
      const head = headers.map(h => `<th style="${thStyle}">${h}</th>`).join("");
      const body = rows.map((r, ri) => `<tr>${r.map(c => `<td style="${ri % 2 === 0 ? tdStyle : td2Style}">${c}</td>`).join("")}</tr>`).join("");
      return `<table style="${tableStyle}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    };

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${d.name} — DataCanvas Analysis Report</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',sans-serif;color:#1a1a2e;background:#fff;font-size:13px;line-height:1.6}
  .page{max-width:900px;margin:0 auto;padding:40px 48px}
  h1{font-size:26px;font-weight:700;color:#1e3a5f;margin-bottom:4px}
  h2{font-size:17px;font-weight:700;color:#1e3a5f;margin:32px 0 12px;padding-bottom:6px;border-bottom:2px solid #0078d4}
  h3{font-size:13px;font-weight:600;color:#0078d4;margin:18px 0 8px}
  p{margin-bottom:12px;color:#374151}
  ul{margin:8px 0 12px 20px} li{margin-bottom:5px;color:#374151}
  .header{background:#1e3a5f;color:#fff;padding:32px 48px 24px;margin-bottom:0}
  .header h1{color:#fff;font-size:28px} .header .sub{color:#aabbcc;font-size:12px;margin-top:4px}
  .chips{display:flex;gap:16px;margin:20px 0;flex-wrap:wrap}
  .chip{background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;padding:12px 20px;min-width:120px;text-align:center}
  .chip .label{font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px}
  .chip .val{font-size:22px;font-weight:700;color:#1e3a5f;margin-top:2px}
  .quality-bar{background:#e5e7eb;border-radius:4px;height:10px;width:200px;margin-top:6px}
  .quality-fill{height:10px;border-radius:4px;background:${scoreColor}}
  .insight{border-left:3px solid #0078d4;padding:8px 14px;margin-bottom:10px;background:#f8faff}
  .insight.warning{border-color:#e1700e;background:#fff8f0}
  .insight.critical{border-color:#d13438;background:#fff0f0}
  .insight h4{font-size:11px;font-weight:700;margin-bottom:4px}
  .rec{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #f3f4f6}
  .rec .num{font-size:15px;font-weight:700;color:#0078d4;min-width:24px}
  .footer{margin-top:40px;padding-top:16px;border-top:2px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center}
  @media print{.page{padding:20px 30px} h2{page-break-before:auto}}
</style></head><body>
<div class="header">
  <div style="font-size:11px;color:#aabbcc;margin-bottom:8px">DataCanvas Analytics Platform</div>
  <h1>${d.name}</h1>
  <div class="sub">Data Analysis Report &nbsp;·&nbsp; Generated ${now} &nbsp;·&nbsp; ${d.originalName}</div>
</div>
<div class="page">
<h2>1. Introduction</h2>
<div class="chips">
  <div class="chip"><div class="label">Rows</div><div class="val">${d.rowCount.toLocaleString()}</div></div>
  <div class="chip"><div class="label">Columns</div><div class="val">${d.columnCount}</div></div>
  <div class="chip"><div class="label">File Type</div><div class="val">${d.fileType.toUpperCase()}</div></div>
  <div class="chip"><div class="label">Size</div><div class="val">${(d.fileSizeBytes / 1024).toFixed(0)} KB</div></div>
  <div class="chip"><div class="label">Numeric Cols</div><div class="val">${numCols.length}</div></div>
  <div class="chip"><div class="label">Categorical</div><div class="val">${catCols.length}</div></div>
</div>
${ai?.executiveSummary ? `<p>${ai.executiveSummary}</p>` : ""}
${ai?.dataQualityScore !== undefined ? `<h3>Data Quality Score</h3><div style="font-size:28px;font-weight:700;color:${scoreColor}">${score}/100</div><div class="quality-bar"><div class="quality-fill" style="width:${score}%"></div></div>` : ""}
${ai?.keyFindings?.length ? `<h3>Key Findings</h3><ul>${ai.keyFindings.map(f => `<li>${f}</li>`).join("")}</ul>` : ""}

<h2>2. Body — Analysis</h2>
<h3>2.1 Data Composition</h3>
${makeTable(["Metric", "Value"], [
  ["Total Rows", d.rowCount.toLocaleString()],
  ["Total Columns", String(d.columnCount)],
  ["Numeric Columns", String(numCols.length)],
  ["Categorical Columns", String(catCols.length)],
  ["Duplicate Rows", String(eda?.duplicateRows ?? 0)],
  ["Missing Value Columns", String(missingVals.length)],
  ["Memory Usage", `${eda?.memoryUsageMb ?? "—"} MB`],
])}

${missingVals.length > 0 ? `<h3>2.2 Missing Values</h3>${makeTable(["Column", "Missing Count", "Missing %"], missingVals.map(m => [m.column, String(m.count), m.pct.toFixed(1) + "%"]))}` : "<h3>2.2 Missing Values</h3><p>No missing values detected — data completeness is 100%.</p>"}

${numCols.length > 0 ? `<h3>2.3 Numeric Statistics</h3>${makeTable(
  ["Column", "Mean", "Std Dev", "Min", "Q25", "Median", "Q75", "Max", "Skewness", "Kurtosis"],
  numCols.map(c => [c.column, (c.mean??0).toFixed(3), (c.std??0).toFixed(3), (c.min??0).toFixed(3), (c.q25??0).toFixed(3), (c.median??0).toFixed(3), (c.q75??0).toFixed(3), (c.max??0).toFixed(3), (c.skewness??0).toFixed(3), (c.kurtosis??0).toFixed(3)])
)}` : ""}

${catCols.length > 0 ? `<h3>2.4 Categorical Statistics</h3>${makeTable(
  ["Column", "Unique Values", "Null Count", "Top Value", "Top Value %", "Entropy"],
  catCols.map(c => [c.column, String(c.uniqueCount??0), String(c.nullCount??0), c.topValues?.[0]?.value ?? "—", c.topValues?.[0] ? c.topValues[0].pct.toFixed(1) + "%" : "—", (c.entropy??0).toFixed(3)])
)}` : ""}

${outliers && outliers.length > 0 ? `<h3>2.5 Outlier Detection (IQR Method)</h3>${makeTable(
  ["Column", "Outlier Count", "Outlier %", "Lower Bound", "Upper Bound"],
  outliers.map(o => [o.column, String(o.count), o.pct.toFixed(2) + "%", o.lowerBound.toFixed(3), o.upperBound.toFixed(3)])
)}` : ""}

${corr?.pairs && corr.pairs.length > 0 ? `<h3>2.6 Top Correlations</h3>${makeTable(
  ["Column A", "Column B", "Pearson r", "Strength"],
  corr.pairs.slice(0, 10).map(p => {
    const rv = (p as { value?: number; r?: number }).value ?? (p as { value?: number; r?: number }).r ?? 0;
    return [p.col1, p.col2, rv.toFixed(4), Math.abs(rv) >= 0.7 ? "Strong" : Math.abs(rv) >= 0.4 ? "Moderate" : "Weak"];
  })
)}` : ""}

${ai?.patternInsights?.length ? `<h3>2.7 Pattern Insights</h3>${ai.patternInsights.map(ins => `<div class="insight ${ins.severity}"><h4>${ins.title} <span style="font-weight:400;font-size:10px;text-transform:uppercase">[${ins.severity}]</span></h4><p style="margin:0;font-size:11px">${ins.description}</p></div>`).join("")}` : ""}

<h2>3. Conclusions &amp; Recommendations</h2>
${ai?.recommendations?.length ? ai.recommendations.map((r, i) => `<div class="rec"><div class="num">${i + 1}</div><div>${r}</div></div>`).join("") : ""}
${ai?.businessImplications ? `<h3>Business Implications</h3><p>${ai.businessImplications}</p>` : ""}

<h2>4. Appendix</h2>
<h3>Unusual Findings</h3>
${ai?.unusualFindings?.length ? `<ul>${ai.unusualFindings.map(f => `<li>${f}</li>`).join("")}</ul>` : "<p>No anomalous patterns detected.</p>"}
<h3>Suggested Next Analyses</h3>
${ai?.suggestedAnalyses?.length ? `<ul>${ai.suggestedAnalyses.map(s => `<li>${s}</li>`).join("")}</ul>` : ""}
<h3>Column Directory</h3>
${makeTable(["Column", "Type", "Null Count", "Unique Values"], [
  ...numCols.map(c => [c.column, "Numeric", String(c.nullCount), "—"]),
  ...catCols.map(c => [c.column, "Categorical", String(c.nullCount), String(c.uniqueCount)]),
])}

<div class="footer">Report generated by DataCanvas Analytics Platform &nbsp;·&nbsp; ${now} &nbsp;·&nbsp; To save as PDF: File → Print → Save as PDF</div>
</div></body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${d.name.replace(/\s+/g, "_")}_report.html"`);
    res.send(html);
  } catch (err) {
    req.log.error({ err }, "export html report error");
    res.status(500).json({ error: "HTML report export failed" });
  }
});

router.post("/datasets/:id/export/pptx", async (req, res) => {
  try {
    const dataset = await db.select().from(datasetsTable).where(eq(datasetsTable.id, req.params.id)).limit(1);
    if (!dataset[0]) { res.status(404).json({ error: "Not found" }); return; }

    const eda = readCache<Record<string, unknown>>(req.params.id, "eda") as {
      numericColumns?: { column: string; mean: number; std: number; min: number; max: number; median: number; q25: number; q75: number; skewness: number; kurtosis: number; nullCount: number }[];
      categoricalColumns?: { column: string; uniqueCount: number; nullCount: number; topValues: { value: string; count: number; pct: number }[]; entropy: number }[];
      missingValues?: { column: string; count: number; pct: number }[];
      duplicateRows?: number; shape?: { rows: number; cols: number }; memoryUsageMb?: number;
    } | null;
    const ai = readCache<Record<string, unknown>>(req.params.id, "ai-snapshot") as {
      executiveSummary?: string; keyFindings?: string[]; dataQualityScore?: number;
      patternInsights?: { title: string; description: string; severity: string; affectedColumns: string[] }[];
      recommendations?: string[]; unusualFindings?: string[]; businessImplications?: string; suggestedAnalyses?: string[];
    } | null;
    const corr = readCache<Record<string, unknown>>(req.params.id, "correlation") as {
      columns?: string[]; pairs?: { col1: string; col2: string; value: number; r?: number }[];
    } | null;
    const outliersRawPptx = readCache<{ columns: { column: string; count: number; pct: number; lowerBound: number; upperBound: number }[] }>(req.params.id, "outliers");
    const outliersPptx = outliersRawPptx?.columns ?? [];

    const pptxgen = (await import("pptxgenjs")).default;
    const prs = new pptxgen();
    prs.defineLayout({ name: "WIDESCREEN", width: 13.33, height: 7.5 });
    prs.layout = "WIDESCREEN";

    const NAVY = "1E3A5F"; const BLUE = "0078D4"; const GREEN = "217346";
    const WHITE = "FFFFFF"; const LIGHT = "F3F4F6"; const TEXT = "1A1A2E";
    const GRAY = "6B7280"; const ORANGE = "E1700E"; const RED = "D13438";

    const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

    const addSlide = (title: string, sectionLabel = "") => {
      const s = prs.addSlide();
      s.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.72, fill: { color: NAVY } });
      if (sectionLabel) s.addText(sectionLabel, { x: 0.25, y: 0.05, w: 6, h: 0.22, fontSize: 7.5, color: "AAC4E0", bold: false });
      s.addText(title, { x: 0.25, y: sectionLabel ? 0.26 : 0.18, w: 12.5, h: 0.38, fontSize: 19, color: WHITE, bold: true });
      s.addShape(prs.ShapeType.rect, { x: 0, y: 7.32, w: 13.33, h: 0.18, fill: { color: BLUE } });
      s.addText(`DataCanvas  ·  ${dateStr}`, { x: 0.2, y: 7.33, w: 6, h: 0.16, fontSize: 6.5, color: WHITE });
      s.addText(`${dataset[0].name}`, { x: 7, y: 7.33, w: 6.1, h: 0.16, fontSize: 6.5, color: WHITE, align: "right" });
      return s;
    };

    const makeTableData = (headers: string[], rows: string[][], headerFill = NAVY) =>
      [
        headers.map(h => ({ text: h, options: { fontSize: 8, fontFace: "Calibri", color: WHITE, fill: { color: headerFill }, bold: true } })),
        ...rows.map((r, ri) => r.map(c => ({ text: c, options: { fontSize: 8, fontFace: "Calibri", color: TEXT, fill: { color: ri % 2 === 0 ? WHITE : LIGHT } } }))),
      ];

    // ── Slide 1: Title / Introduction ──
    const s1 = prs.addSlide();
    s1.addShape(prs.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: NAVY } });
    s1.addShape(prs.ShapeType.rect, { x: 0, y: 5.5, w: 13.33, h: 2, fill: { color: "162D4A" } });
    s1.addText("DataCanvas Analytics Platform", { x: 0.6, y: 0.9, w: 12, h: 0.4, fontSize: 12, color: "AAC4E0" });
    s1.addText(dataset[0].name, { x: 0.6, y: 1.4, w: 12, h: 1.0, fontSize: 34, color: WHITE, bold: true, wrap: true });
    s1.addText("Data Analysis Report", { x: 0.6, y: 2.55, w: 8, h: 0.4, fontSize: 16, color: "7EC8E3" });
    const chips = [
      { l: "ROWS", v: dataset[0].rowCount.toLocaleString() },
      { l: "COLUMNS", v: String(dataset[0].columnCount) },
      { l: "FILE TYPE", v: dataset[0].fileType.toUpperCase() },
      { l: "SIZE", v: `${(dataset[0].fileSizeBytes / 1024).toFixed(0)} KB` },
    ];
    chips.forEach((c, i) => {
      const x = 0.6 + i * 3.1;
      s1.addShape(prs.ShapeType.rect, { x, y: 3.2, w: 2.8, h: 1.0, fill: { color: "243F60" }, line: { color: "3A6090", pt: 1 } });
      s1.addText(c.l, { x, y: 3.28, w: 2.8, h: 0.22, fontSize: 7.5, color: "AAC4E0", align: "center", bold: true });
      s1.addText(c.v, { x, y: 3.5, w: 2.8, h: 0.52, fontSize: 22, color: WHITE, align: "center", bold: true });
    });
    s1.addText(`Generated: ${dateStr}  ·  Original file: ${dataset[0].originalName}`, { x: 0.6, y: 5.6, w: 12, h: 0.3, fontSize: 9, color: "8BA5C0" });

    // ── Slide 2: Executive Summary ──
    const s2 = addSlide("Executive Summary", "1 · Introduction");
    if (ai?.executiveSummary) {
      s2.addText(ai.executiveSummary, { x: 0.3, y: 0.85, w: 12.7, h: 1.1, fontSize: 9.5, color: TEXT, wrap: true, italic: true });
    }
    // Quality score
    if (ai?.dataQualityScore !== undefined) {
      const sc = ai.dataQualityScore as number;
      const col = sc >= 80 ? GREEN : sc >= 60 ? ORANGE : RED;
      s2.addShape(prs.ShapeType.rect, { x: 0.3, y: 2.0, w: 5.2, h: 2.2, fill: { color: LIGHT }, line: { color: "D1D5DB", pt: 0.5 } });
      s2.addText("Data Quality Score", { x: 0.3, y: 2.1, w: 5.2, h: 0.28, fontSize: 9, color: GRAY, align: "center", bold: true });
      s2.addText(`${sc}`, { x: 0.3, y: 2.35, w: 5.2, h: 0.85, fontSize: 52, color: col, align: "center", bold: true });
      s2.addText("/ 100", { x: 0.3, y: 3.1, w: 5.2, h: 0.28, fontSize: 11, color: GRAY, align: "center" });
      s2.addShape(prs.ShapeType.rect, { x: 0.6, y: 3.7, w: 4.6, h: 0.12, fill: { color: "E5E7EB" } });
      s2.addShape(prs.ShapeType.rect, { x: 0.6, y: 3.7, w: Math.max(0.05, (sc / 100) * 4.6), h: 0.12, fill: { color: col } });
      s2.addShape(prs.ShapeType.rect, { x: 0, y: 4.05, w: 5.8, h: 0.01, fill: { color: "E5E7EB" } });
    }
    // Key findings
    if (ai?.keyFindings?.length) {
      s2.addText("Key Findings", { x: 5.8, y: 2.0, w: 7.3, h: 0.3, fontSize: 10, color: NAVY, bold: true });
      (ai.keyFindings as string[]).slice(0, 6).forEach((f, i) => {
        s2.addShape(prs.ShapeType.rect, { x: 5.8, y: 2.42 + i * 0.68, w: 0.12, h: 0.12, fill: { color: BLUE } });
        s2.addText(f, { x: 6.05, y: 2.38 + i * 0.68, w: 7.0, h: 0.55, fontSize: 8.5, color: TEXT, wrap: true });
      });
    }

    // ── Slide 3: Data Composition ──
    const s3 = addSlide("Data Composition & Quality", "2 · Body — Analysis");
    const numericCols = eda?.numericColumns ?? [];
    const catCols = eda?.categoricalColumns ?? [];
    const missingVals = eda?.missingValues ?? [];
    const compData = makeTableData(
      ["Metric", "Value"],
      [
        ["Total Rows", dataset[0].rowCount.toLocaleString()],
        ["Total Columns", String(dataset[0].columnCount)],
        ["Numeric Columns", String(numericCols.length)],
        ["Categorical Columns", String(catCols.length)],
        ["Duplicate Rows", String(eda?.duplicateRows ?? 0)],
        ["Columns with Missing Data", String(missingVals.length)],
        ["In-Memory Size", `${eda?.memoryUsageMb ?? "—"} MB`],
        ["Upload Date", new Date(dataset[0].uploadedAt).toLocaleDateString()],
      ]
    );
    s3.addTable(compData, { x: 0.3, y: 0.85, w: 6.0, colW: [3.5, 2.5], border: { type: "solid", pt: 0.5, color: "E5E7EB" } });

    if (missingVals.length > 0) {
      s3.addText("Missing Values by Column", { x: 6.6, y: 0.85, w: 6.5, h: 0.3, fontSize: 9.5, color: NAVY, bold: true });
      const mvRows = missingVals.slice(0, 8).map(m => [m.column, String(m.count), `${m.pct.toFixed(1)}%`]);
      const mvData = makeTableData(["Column", "Count", "%"], mvRows);
      s3.addTable(mvData, { x: 6.6, y: 1.2, w: 6.4, colW: [3.8, 1.2, 1.4], border: { type: "solid", pt: 0.5, color: "E5E7EB" } });
    } else {
      s3.addText("✓  No missing values — 100% data completeness", { x: 6.6, y: 1.2, w: 6.4, h: 0.4, fontSize: 10, color: GREEN, bold: true });
    }

    // ── Slide 4: Numeric Statistics ──
    if (numericCols.length > 0) {
      const s4 = addSlide("Numeric Statistics", "2.1 · Quantitative Analysis");
      const numRows = numericCols.slice(0, 12).map(c => [
        c.column, (c.mean??0).toFixed(2), (c.std??0).toFixed(2), (c.min??0).toFixed(2),
        (c.q25??0).toFixed(2), (c.median??0).toFixed(2), (c.q75??0).toFixed(2), (c.max??0).toFixed(2),
        (c.skewness??0).toFixed(3), (c.kurtosis??0).toFixed(3), String(c.nullCount??0),
      ]);
      s4.addTable(makeTableData(["Column", "Mean", "Std Dev", "Min", "Q25", "Median", "Q75", "Max", "Skewness", "Kurtosis", "Nulls"], numRows), {
        x: 0.2, y: 0.85, w: 12.93,
        colW: [2.2, 1.0, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.0, 0.74],
        border: { type: "solid", pt: 0.5, color: "E5E7EB" },
        autoPage: true, autoPageHeaderRows: 1,
      });
      if (numericCols.length > 12) s4.addText(`Showing 12 of ${numericCols.length} numeric columns`, { x: 0.2, y: 7.1, w: 8, h: 0.2, fontSize: 7.5, color: GRAY });
    }

    // ── Slide 5: Categorical Statistics ──
    if (catCols.length > 0) {
      const s5 = addSlide("Categorical Statistics", "2.2 · Qualitative Analysis");
      const catRows = catCols.slice(0, 14).map(c => [
        c.column, String(c.uniqueCount??0), String(c.nullCount??0),
        c.topValues?.[0]?.value ?? "—", c.topValues?.[0] ? `${c.topValues[0].pct.toFixed(1)}%` : "—",
        c.topValues?.[1]?.value ?? "—", c.topValues?.[1] ? `${c.topValues[1].pct.toFixed(1)}%` : "—",
        (c.entropy??0).toFixed(3),
      ]);
      s5.addTable(makeTableData(["Column", "Unique", "Nulls", "Top Value", "Top %", "2nd Value", "2nd %", "Entropy"], catRows), {
        x: 0.2, y: 0.85, w: 12.93,
        colW: [2.2, 0.9, 0.8, 2.0, 0.85, 2.0, 0.85, 1.2],
        border: { type: "solid", pt: 0.5, color: "E5E7EB" },
        autoPage: true, autoPageHeaderRows: 1,
      });
    }

    // ── Slide 6: Outlier Detection ──
    if (outliersPptx.length > 0) {
      const s6 = addSlide("Outlier Detection — IQR Method", "2.3 · Anomaly Analysis");
      const outRows = outliersPptx.slice(0, 14).map(o => [
        o.column, String(o.count), `${(o.pct??0).toFixed(2)}%`,
        (o.lowerBound??0).toFixed(3), (o.upperBound??0).toFixed(3),
        (o.pct??0) > 10 ? "High" : (o.pct??0) > 3 ? "Moderate" : "Low",
      ]);
      s6.addTable(makeTableData(["Column", "Outlier Count", "Outlier %", "Lower Fence", "Upper Fence", "Severity"], outRows), {
        x: 0.3, y: 0.85, w: 12.73,
        colW: [2.5, 1.6, 1.3, 2.2, 2.2, 1.5],
        border: { type: "solid", pt: 0.5, color: "E5E7EB" },
        autoPage: true, autoPageHeaderRows: 1,
      });
      s6.addText("Method: IQR fences defined as Q1 − 1.5×IQR (lower) and Q3 + 1.5×IQR (upper). Values outside these bounds are flagged as outliers.", {
        x: 0.3, y: 7.05, w: 12.73, h: 0.22, fontSize: 7.5, color: GRAY, italic: true,
      });
    }

    // ── Slide 7: Correlation Analysis ──
    if (corr?.pairs && corr.pairs.length > 0) {
      const s7 = addSlide("Correlation Analysis", "2.4 · Relationship Mapping");
      s7.addText("Top Pairwise Pearson Correlations (sorted by |r|)", { x: 0.3, y: 0.85, w: 12.7, h: 0.3, fontSize: 9.5, color: NAVY, bold: true });
      const corrRows = corr.pairs.slice(0, 12).map(p => {
        const rv = p.value ?? p.r ?? 0;
        return [
          p.col1, p.col2, rv.toFixed(4),
          Math.abs(rv) >= 0.7 ? "Strong" : Math.abs(rv) >= 0.4 ? "Moderate" : "Weak",
          rv > 0 ? "Positive" : "Negative",
        ];
      });
      s7.addTable(makeTableData(["Column A", "Column B", "Pearson r", "Strength", "Direction"], corrRows), {
        x: 0.3, y: 1.2, w: 12.73,
        colW: [3.0, 3.0, 1.7, 2.0, 2.0],
        border: { type: "solid", pt: 0.5, color: "E5E7EB" },
        autoPage: true, autoPageHeaderRows: 1,
      });
      s7.addText(`Numeric columns: ${corr.columns?.length ?? 0}  ·  Pairs: ${corr.pairs.length}  ·  Strong (|r|≥0.7): ${corr.pairs.filter(p => Math.abs(p.value ?? p.r ?? 0) >= 0.7).length}`, {
        x: 0.3, y: 7.05, w: 12.73, h: 0.22, fontSize: 7.5, color: GRAY,
      });
    }

    // ── Slide 8: Pattern Insights ──
    if (ai?.patternInsights && (ai.patternInsights as unknown[]).length > 0) {
      const s8 = addSlide("Pattern Insights", "2.5 · Statistical Patterns");
      const insights = ai.patternInsights as { title: string; description: string; severity: string }[];
      insights.slice(0, 5).forEach((ins, i) => {
        const sevColor = ins.severity === "critical" ? RED : ins.severity === "warning" ? ORANGE : BLUE;
        s8.addShape(prs.ShapeType.rect, { x: 0.3, y: 0.9 + i * 1.18, w: 12.73, h: 1.05, fill: { color: LIGHT }, line: { color: "E5E7EB", pt: 0.5 } });
        s8.addShape(prs.ShapeType.rect, { x: 0.3, y: 0.9 + i * 1.18, w: 0.18, h: 1.05, fill: { color: sevColor } });
        s8.addText(`[${ins.severity.toUpperCase()}]  ${ins.title}`, { x: 0.6, y: 0.94 + i * 1.18, w: 12.4, h: 0.28, fontSize: 9.5, color: NAVY, bold: true });
        s8.addText(ins.description, { x: 0.6, y: 1.2 + i * 1.18, w: 12.4, h: 0.62, fontSize: 8.5, color: TEXT, wrap: true });
      });
    }

    // ── Slide 9: Conclusions & Recommendations ──
    if (ai?.recommendations?.length) {
      const s9 = addSlide("Conclusions & Recommendations", "3 · Conclusions");
      (ai.recommendations as string[]).slice(0, 6).forEach((r, i) => {
        s9.addShape(prs.ShapeType.rect, { x: 0.3, y: 0.88 + i * 1.0, w: 12.73, h: 0.88, fill: { color: i % 2 === 0 ? LIGHT : WHITE }, line: { color: "D1D5DB", pt: 0.5 } });
        s9.addShape(prs.ShapeType.rect, { x: 0.3, y: 0.88 + i * 1.0, w: 0.55, h: 0.88, fill: { color: BLUE } });
        s9.addText(String(i + 1), { x: 0.3, y: 0.95 + i * 1.0, w: 0.55, h: 0.56, fontSize: 18, color: WHITE, align: "center", bold: true });
        s9.addText(r, { x: 0.98, y: 0.93 + i * 1.0, w: 11.85, h: 0.68, fontSize: 9, color: TEXT, wrap: true });
      });
    }

    // ── Slide 10: Appendix ──
    const s10 = addSlide("Appendix", "4 · Appendix");
    if (ai?.businessImplications) {
      s10.addText("Business Implications", { x: 0.3, y: 0.88, w: 12.73, h: 0.28, fontSize: 10, color: NAVY, bold: true });
      s10.addText(ai.businessImplications, { x: 0.3, y: 1.18, w: 12.73, h: 0.9, fontSize: 9, color: TEXT, wrap: true });
    }
    if (ai?.unusualFindings?.length) {
      s10.addText("Unusual Findings", { x: 0.3, y: 2.2, w: 6.3, h: 0.28, fontSize: 10, color: NAVY, bold: true });
      (ai.unusualFindings as string[]).forEach((f, i) => {
        s10.addShape(prs.ShapeType.rect, { x: 0.3, y: 2.55 + i * 0.48, w: 0.1, h: 0.1, fill: { color: ORANGE } });
        s10.addText(f, { x: 0.5, y: 2.52 + i * 0.48, w: 5.9, h: 0.38, fontSize: 8.5, color: TEXT, wrap: true });
      });
    }
    if (ai?.suggestedAnalyses?.length) {
      s10.addText("Suggested Next Analyses", { x: 7, y: 2.2, w: 6.0, h: 0.28, fontSize: 10, color: NAVY, bold: true });
      (ai.suggestedAnalyses as string[]).forEach((a, i) => {
        s10.addShape(prs.ShapeType.rect, { x: 7, y: 2.55 + i * 0.55, w: 0.12, h: 0.12, fill: { color: GREEN } });
        s10.addText(a, { x: 7.2, y: 2.52 + i * 0.55, w: 5.8, h: 0.45, fontSize: 8.5, color: TEXT, wrap: true });
      });
    }
    s10.addText("Report generated by DataCanvas Analytics Platform", {
      x: 0.3, y: 6.9, w: 12.73, h: 0.25, fontSize: 8, color: GRAY, align: "center",
    });

    const buffer = await prs.write({ outputType: "nodebuffer" }) as Buffer;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    res.setHeader("Content-Disposition", `attachment; filename="${dataset[0].name.replace(/\s+/g, "_")}_analysis.pptx"`);
    res.send(buffer);
  } catch (err) {
    req.log.error({ err }, "export pptx error");
    res.status(500).json({ error: "PPTX export failed" });
  }
});

router.get("/datasets/:id/export/json", async (req, res) => {
  try {
    const dataset = await db.select().from(datasetsTable).where(eq(datasetsTable.id, req.params.id)).limit(1);
    if (!dataset[0]) { res.status(404).json({ error: "Not found" }); return; }

    const eda = readCache(req.params.id, "eda");
    const ai = readCache(req.params.id, "ai-snapshot");
    const corr = readCache(req.params.id, "correlation");
    const outliers = readCache(req.params.id, "outliers");

    const bundle = {
      meta: { exportedAt: new Date().toISOString(), datasetId: dataset[0].id, datasetName: dataset[0].name, originalName: dataset[0].originalName, rowCount: dataset[0].rowCount, columnCount: dataset[0].columnCount, fileType: dataset[0].fileType },
      eda: eda ?? null,
      aiSnapshot: ai ?? null,
      correlation: corr ?? null,
      outliers: outliers ?? null,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${dataset[0].name.replace(/\s+/g, "_")}_analysis.json"`);
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err) {
    req.log.error({ err }, "export json error");
    res.status(500).json({ error: "JSON export failed" });
  }
});

export default router;
