import Papa from "papaparse";
import * as XLSX from "xlsx";
import fs from "fs";

// ─── Constants ────────────────────────────────────────────────────────────────
const SAMPLE_THRESHOLD = 50_000;
const HISTOGRAM_BINS = 20;

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ParsedDataset {
  rows: Record<string, unknown>[];
  columns: string[];
  columnTypes: Record<string, "numeric" | "categorical" | "date" | "boolean">;
}

export interface NumericStatsResult {
  column: string; mean: number; median: number; std: number;
  min: number; max: number; q25: number; q75: number;
  skewness: number; kurtosis: number; nullCount: number;
  histogram: { rangeStart: number; rangeEnd: number; count: number; label: string }[];
}

export interface CategoricalStatsResult {
  column: string; uniqueCount: number; nullCount: number;
  topValues: { value: string; count: number; pct: number }[];
  entropy: number;
}

// ─── File Parsing ─────────────────────────────────────────────────────────────
export function parseFile(filePath: string, fileType: string): ParsedDataset {
  let rows: Record<string, unknown>[] = [];

  if (fileType === "csv") {
    const content = fs.readFileSync(filePath, "utf-8");
    const result = Papa.parse<Record<string, unknown>>(content, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
    });
    rows = result.data;
  } else if (fileType === "xlsx" || fileType === "xls") {
    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  } else {
    throw new Error(`Unsupported file type: ${fileType}`);
  }

  if (rows.length === 0) return { rows: [], columns: [], columnTypes: {} };

  const columns = Object.keys(rows[0]);
  const columnTypes = inferColumnTypes(rows, columns);
  return { rows, columns, columnTypes };
}

// ─── Sampling ─────────────────────────────────────────────────────────────────
function sampleRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (rows.length <= SAMPLE_THRESHOLD) return rows;
  // Systematic sample preserving distribution
  const step = rows.length / SAMPLE_THRESHOLD;
  const sampled: Record<string, unknown>[] = [];
  for (let i = 0; i < SAMPLE_THRESHOLD; i++) {
    sampled.push(rows[Math.floor(i * step)]);
  }
  return sampled;
}

// ─── Type Inference ───────────────────────────────────────────────────────────
function inferColumnTypes(
  rows: Record<string, unknown>[],
  columns: string[]
): Record<string, "numeric" | "categorical" | "date" | "boolean"> {
  const result: Record<string, "numeric" | "categorical" | "date" | "boolean"> = {};
  const sample = rows.slice(0, Math.min(1000, rows.length));

  for (const col of columns) {
    const nonNull = sample.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
    if (nonNull.length === 0) { result[col] = "categorical"; continue; }

    const numericCount = nonNull.filter((v) => typeof v === "number" || (!isNaN(Number(v)) && v !== "")).length;
    const boolCount = nonNull.filter((v) => v === true || v === false || v === "true" || v === "false").length;

    if (boolCount / nonNull.length > 0.9) result[col] = "boolean";
    else if (numericCount / nonNull.length > 0.8) result[col] = "numeric";
    else result[col] = "categorical";
  }
  return result;
}

// ─── Histogram — O(n) single-pass ─────────────────────────────────────────────
function computeHistogram(sorted: number[], min: number, max: number, bins: number) {
  const range = max - min;
  if (range === 0) {
    return [{ rangeStart: min, rangeEnd: max, count: sorted.length, label: String(min) }];
  }
  const binWidth = range / bins;
  const counts = new Array(bins).fill(0);
  for (const v of sorted) {
    const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
    counts[idx]++;
  }
  return counts.map((count, i) => ({
    rangeStart: parseFloat((min + i * binWidth).toFixed(4)),
    rangeEnd: parseFloat((min + (i + 1) * binWidth).toFixed(4)),
    count,
    label: `${(min + i * binWidth).toFixed(2)}–${(min + (i + 1) * binWidth).toFixed(2)}`,
  }));
}

// ─── Numeric Stats ────────────────────────────────────────────────────────────
export function computeNumericStats(
  values: number[],
  colName: string
): Omit<NumericStatsResult, "nullCount"> | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const q25 = sorted[Math.floor(n * 0.25)];
  const q75 = sorted[Math.floor(n * 0.75)];
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[n - 1];

  const skewness = std === 0 ? 0 : values.reduce((acc, v) => acc + ((v - mean) / std) ** 3, 0) / n;
  const kurtosis = std === 0 ? 0 : values.reduce((acc, v) => acc + ((v - mean) / std) ** 4, 0) / n - 3;
  const histogram = computeHistogram(sorted, min, max, HISTOGRAM_BINS);

  return { column: colName, mean, median, std, min, max, q25, q75, skewness, kurtosis, histogram };
}

// ─── Categorical Stats ────────────────────────────────────────────────────────
export function computeCategoricalStats(
  values: (string | null | undefined)[],
  colName: string
): Omit<CategoricalStatsResult, "nullCount"> {
  const freq: Record<string, number> = {};
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    const key = String(v);
    freq[key] = (freq[key] || 0) + 1;
  }

  const nonNullCount = Object.values(freq).reduce((a, b) => a + b, 0);
  const topValues = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([value, count]) => ({
      value,
      count,
      pct: parseFloat(((count / values.length) * 100).toFixed(2)),
    }));

  const uniqueCount = Object.keys(freq).length;
  const entropy = computeEntropy(Object.values(freq), nonNullCount);
  return { column: colName, uniqueCount, topValues, entropy };
}

function computeEntropy(counts: number[], total: number): number {
  if (total === 0) return 0;
  return parseFloat((-counts.reduce((acc, c) => {
    const p = c / total;
    return acc + (p > 0 ? p * Math.log2(p) : 0);
  }, 0)).toFixed(4));
}

// ─── Correlation Matrix ───────────────────────────────────────────────────────
export function computeCorrelationMatrix(rows: Record<string, unknown>[], numericCols: string[]) {
  // Pre-extract column arrays for efficiency
  const data: Record<string, number[]> = {};
  for (const col of numericCols) {
    data[col] = rows.map((r) => Number(r[col])).filter((v) => !isNaN(v) && isFinite(v));
  }

  const matrix: number[][] = [];
  const pairs: { col1: string; col2: string; value: number; r: number; strength: string }[] = [];

  for (let i = 0; i < numericCols.length; i++) {
    matrix[i] = [];
    for (let j = 0; j < numericCols.length; j++) {
      const c = pearsonCorrelation(data[numericCols[i]], data[numericCols[j]]);
      matrix[i][j] = parseFloat(c.toFixed(4));
      if (i < j) {
        pairs.push({
          col1: numericCols[i],
          col2: numericCols[j],
          value: matrix[i][j],
          r: matrix[i][j],          // r alias for backward compat
          strength: correlationStrength(c),
        });
      }
    }
  }

  pairs.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { columns: numericCols, matrix, pairs };
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  const denom = Math.sqrt(dx * dy);
  return denom === 0 ? 0 : num / denom;
}

function correlationStrength(c: number): string {
  const abs = Math.abs(c);
  if (abs >= 0.8) return "Very Strong";
  if (abs >= 0.6) return "Strong";
  if (abs >= 0.4) return "Moderate";
  if (abs >= 0.2) return "Weak";
  return "Negligible";
}

// ─── Outlier Detection (IQR) ──────────────────────────────────────────────────
export function detectOutliers(rows: Record<string, unknown>[], numericCols: string[]) {
  const columns = numericCols.map((col) => {
    const values = rows.map((r) => Number(r[col])).filter((v) => !isNaN(v) && isFinite(v));
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) return { column: col, method: "IQR", count: 0, pct: 0, lowerBound: 0, upperBound: 0 };
    const q25 = sorted[Math.floor(n * 0.25)];
    const q75 = sorted[Math.floor(n * 0.75)];
    const iqr = q75 - q25;
    const lower = q25 - 1.5 * iqr;
    const upper = q75 + 1.5 * iqr;
    const count = values.filter((v) => v < lower || v > upper).length;
    return {
      column: col, method: "IQR", count,
      pct: parseFloat(((count / values.length) * 100).toFixed(2)),
      lowerBound: parseFloat(lower.toFixed(4)),
      upperBound: parseFloat(upper.toFixed(4)),
    };
  });
  return { columns, totalOutlierRows: columns.reduce((a, r) => a + r.count, 0) };
}

// ─── Full EDA — with sampling for large datasets ──────────────────────────────
export function runFullEda(
  rows: Record<string, unknown>[],
  columns: string[],
  columnTypes: Record<string, string>
) {
  const totalRows = rows.length;
  const sampled = sampleRows(rows);
  const wasSampled = sampled.length < totalRows;

  const numericColumns: NumericStatsResult[] = [];
  const categoricalColumns: CategoricalStatsResult[] = [];

  for (const col of columns) {
    if (columnTypes[col] === "numeric") {
      const values = sampled.map((r) => Number(r[col])).filter((v) => !isNaN(v) && isFinite(v));
      const nullCount = rows.filter((r) => r[col] === null || r[col] === undefined || r[col] === "").length;
      const stats = computeNumericStats(values, col);
      if (stats) numericColumns.push({ ...stats, nullCount } as NumericStatsResult);
    } else {
      const values = sampled.map((r) => r[col] as string | null | undefined);
      const nullCount = rows.filter((r) => r[col] === null || r[col] === undefined || r[col] === "").length;
      const stats = computeCategoricalStats(values, col);
      categoricalColumns.push({ ...stats, nullCount } as CategoricalStatsResult);
    }
  }

  const missingValues = columns
    .map((col) => {
      const count = rows.filter((r) => r[col] === null || r[col] === undefined || r[col] === "").length;
      return { column: col, count, pct: parseFloat(((count / totalRows) * 100).toFixed(2)) };
    })
    .filter((m) => m.count > 0)
    .sort((a, b) => b.pct - a.pct);

  // Duplicate detection on sampled data to keep it fast
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const row of sampled) {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicateRows++;
    else seen.add(key);
  }
  if (wasSampled) duplicateRows = Math.round((duplicateRows / sampled.length) * totalRows);

  const memoryUsageMb = parseFloat(((JSON.stringify(rows).length * 2) / 1024 / 1024).toFixed(2));

  return {
    shape: { rows: totalRows, cols: columns.length },
    numericColumns,
    categoricalColumns,
    missingValues,
    duplicateRows,
    memoryUsageMb,
    wasSampled,
    sampleSize: wasSampled ? sampled.length : totalRows,
  };
}

// ─── AI Snapshot (rule-based, used as fallback) ───────────────────────────────
export function generateAiSnapshot(
  rows: Record<string, unknown>[],
  columns: string[],
  _columnTypes: Record<string, string>,
  edaResult: ReturnType<typeof runFullEda>
) {
  const totalRows = rows.length;
  const totalCols = columns.length;
  const numericCols = edaResult.numericColumns;
  const catCols = edaResult.categoricalColumns;
  const missingVals = edaResult.missingValues;

  const totalNulls = missingVals.reduce((a, b) => a + b.count, 0);
  const totalCells = totalRows * totalCols;
  const nullPct = totalCells > 0 ? (totalNulls / totalCells) * 100 : 0;
  const dataQualityScore = Math.max(
    0,
    Math.min(100, Math.round(100 - nullPct * 2 - (edaResult.duplicateRows / totalRows) * 20))
  );

  const dataQualityIssues: string[] = [];
  const highNullCols = missingVals.filter((m) => m.pct > 10);
  if (highNullCols.length > 0)
    dataQualityIssues.push(`${highNullCols.length} column(s) have >10% missing values: ${highNullCols.map((c) => c.column).join(", ")}`);
  if (edaResult.duplicateRows > 0)
    dataQualityIssues.push(`${edaResult.duplicateRows.toLocaleString()} duplicate rows (${((edaResult.duplicateRows / totalRows) * 100).toFixed(1)}%)`);
  const highCardCols = catCols.filter((c) => c.uniqueCount > totalRows * 0.9);
  if (highCardCols.length > 0)
    dataQualityIssues.push(`${highCardCols.length} column(s) appear to be IDs/free-text with very high cardinality`);

  const keyFindings: string[] = [
    `Dataset: ${totalRows.toLocaleString()} rows × ${totalCols} columns (${numericCols.length} numeric, ${catCols.length} categorical)`,
  ];
  const highSkewCols = numericCols.filter((c) => Math.abs(c.skewness) > 1);
  if (highSkewCols.length > 0)
    keyFindings.push(`${highSkewCols.length} highly skewed column(s) (|skewness|>1): ${highSkewCols.map((c) => c.column).slice(0, 3).join(", ")}`);
  const zeroVarianceCols = numericCols.filter((c) => c.std === 0);
  if (zeroVarianceCols.length > 0)
    keyFindings.push(`${zeroVarianceCols.length} constant column(s) (zero variance) — candidates for removal`);
  const highNullPctCols = missingVals.filter((m) => m.pct > 50);
  if (highNullPctCols.length > 0)
    keyFindings.push(`${highNullPctCols.length} column(s) >50% null — consider imputation or removal`);
  if (numericCols.length > 0) {
    const ranges = numericCols.map((c) => ({ col: c.column, range: c.max - c.min })).sort((a, b) => b.range - a.range);
    keyFindings.push(`Widest range: "${ranges[0].col}" spans ${ranges[0].range.toLocaleString()} units`);
  }

  const patternInsights: { title: string; description: string; severity: "info" | "warning" | "critical"; affectedColumns: string[] }[] = [];
  if (highSkewCols.length > 0) {
    patternInsights.push({
      title: "Skewed Distributions",
      description: `${highSkewCols.length} column(s) have significant skewness. Log or Box-Cox transformation recommended before parametric modeling.`,
      severity: "warning",
      affectedColumns: highSkewCols.map((c) => c.column),
    });
  }
  if (highNullCols.length > 0) {
    patternInsights.push({
      title: "Missing Value Patterns",
      description: `${highNullCols.length} column(s) have significant missing data (>10%). Choose imputation strategy based on missingness mechanism (MCAR/MAR/MNAR).`,
      severity: highNullCols.some((c) => c.pct > 40) ? "critical" : "warning",
      affectedColumns: highNullCols.map((c) => c.column),
    });
  }
  if (edaResult.duplicateRows > totalRows * 0.01) {
    patternInsights.push({
      title: "Duplicate Rows Detected",
      description: `${edaResult.duplicateRows.toLocaleString()} duplicate rows found. May indicate ETL issues or valid repeated observations.`,
      severity: edaResult.duplicateRows > totalRows * 0.05 ? "critical" : "warning",
      affectedColumns: [],
    });
  }
  const lowVariance = numericCols.filter((c) => c.std < (c.max - c.min) * 0.01 && c.max !== c.min);
  if (lowVariance.length > 0) {
    patternInsights.push({
      title: "Low Variance Columns",
      description: `${lowVariance.length} numeric column(s) have very low variance relative to their range — limited predictive value.`,
      severity: "info",
      affectedColumns: lowVariance.map((c) => c.column),
    });
  }
  if (numericCols.length >= 2) {
    patternInsights.push({
      title: "Multivariate Relationships",
      description: `${numericCols.length} numeric columns → ${(numericCols.length * (numericCols.length - 1)) / 2} pairwise relationships to explore. Run Correlation Matrix analysis.`,
      severity: "info",
      affectedColumns: numericCols.map((c) => c.column),
    });
  }

  const recommendations: string[] = [
    nullPct > 5
      ? `Address ${missingVals.length} column(s) with missing data before modeling`
      : "Missing value rate is acceptable — minimal imputation needed",
    highSkewCols.length > 0
      ? `Apply log1p/Box-Cox to: ${highSkewCols.map((c) => c.column).slice(0, 3).join(", ")}`
      : "Numeric distributions are reasonably symmetric",
    edaResult.duplicateRows > 0
      ? "De-duplicate before analysis using a dedup pipeline step"
      : "No duplicates — data integrity is clean",
    numericCols.length > 1
      ? "Run correlation analysis to identify multicollinear features"
      : "Single numeric column — no multicollinearity concern",
    catCols.some((c) => c.uniqueCount > 100)
      ? "High-cardinality categoricals → use target encoding or hashing instead of one-hot"
      : "Categorical cardinality is manageable for one-hot encoding",
    "Validate data types: ensure numeric columns parsed correctly",
  ];

  const unusualFindings: string[] = [];
  const extremeKurtosis = numericCols.filter((c) => Math.abs(c.kurtosis) > 5);
  if (extremeKurtosis.length > 0)
    unusualFindings.push(`Heavy-tailed distributions: ${extremeKurtosis.map((c) => c.column).join(", ")} — extreme outliers likely`);
  const dominantCats = catCols.filter((c) => c.topValues[0]?.pct > 90);
  if (dominantCats.length > 0)
    unusualFindings.push(`Near-constant categoricals (>90% one value): ${dominantCats.map((c) => c.column).join(", ")}`);
  if (unusualFindings.length === 0) unusualFindings.push("No strongly anomalous patterns detected");

  const businessImplications = `This ${totalRows.toLocaleString()}-row dataset with ${totalCols} features is ${dataQualityScore >= 80 ? "well-suited" : dataQualityScore >= 60 ? "adequately suited" : "marginally suited"} for downstream analysis (quality score: ${dataQualityScore}/100). ${numericCols.length > 0 ? `${numericCols.length} numeric feature(s) provide a solid quantitative foundation.` : ""} ${catCols.length > 0 ? `${catCols.length} categorical feature(s) will require encoding for ML pipelines.` : ""}`;

  const suggestedAnalyses: string[] = [
    "Correlation matrix to identify strongest pairwise numeric relationships",
    "Outlier detection to flag and review extreme values",
    highSkewCols.length > 0 ? "Transformation analysis: compare model performance before/after log-transform" : "Normality tests (Shapiro-Wilk)",
    catCols.length > 0 ? "Group-by analysis: segment numeric metrics by categorical dimensions" : "Time-series decomposition if a date column exists",
    "Feature importance via Random Forest or mutual information scan",
    "Cluster analysis (k-means/DBSCAN) to discover natural segments",
  ];

  return {
    executiveSummary: `${totalRows.toLocaleString()}-row dataset, ${totalCols} variables (${numericCols.length} quantitative, ${catCols.length} categorical). Data quality: ${dataQualityScore}/100. ${dataQualityIssues.length > 0 ? `Key concern: ${dataQualityIssues[0]}.` : "Data integrity appears sound."} ${highSkewCols.length > 0 ? `${highSkewCols.length} column(s) warrant transformation before parametric modeling.` : "Distributions broadly symmetric."}${edaResult.wasSampled ? ` Note: EDA computed on ${edaResult.sampleSize.toLocaleString()}-row sample of ${totalRows.toLocaleString()} total rows.` : ""}`,
    keyFindings, dataQualityScore, dataQualityIssues, patternInsights,
    recommendations, unusualFindings, businessImplications, suggestedAnalyses,
  };
}
