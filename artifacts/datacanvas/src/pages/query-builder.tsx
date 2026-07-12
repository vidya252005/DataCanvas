import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Play, Plus, Trash2, Loader2 } from "lucide-react";

type Filter = { column: string; operator: string; value: string };

const OPERATORS = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "is_null", label: "is null" },
  { value: "not_null", label: "is not null" },
];

const AGGREGATIONS = [
  { value: "sum", label: "SUM" },
  { value: "mean", label: "MEAN (avg)" },
  { value: "min", label: "MIN" },
  { value: "max", label: "MAX" },
];

export default function QueryBuilder() {
  const { id } = useParams<{ id: string }>();
  const [columns, setColumns] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<Filter[]>([]);
  const [groupBy, setGroupBy] = useState("");
  const [aggFn, setAggFn] = useState("");
  const [aggCol, setAggCol] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState("500");
  const [result, setResult] = useState<{ rows: Record<string, unknown>[]; totalCount: number; columns: string[]; executionTimeMs: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/datasets/${id}`)
      .then(r => r.json())
      .then((d: { dataset?: { columns?: string[] }; columnTypes?: Record<string, string> }) => {
        setColumns(d.dataset?.columns ?? []);
        setColumnTypes(d.columnTypes ?? {});
      })
      .catch(() => {});
  }, [id]);

  const addFilter = () => setFilters(f => [...f, { column: columns[0] ?? "", operator: "eq", value: "" }]);
  const removeFilter = (i: number) => setFilters(f => f.filter((_, j) => j !== i));
  const updateFilter = (i: number, patch: Partial<Filter>) =>
    setFilters(f => f.map((r, j) => j === i ? { ...r, ...patch } : r));

  const numericCols = columns.filter(c => columnTypes[c] === "numeric");

  const run = async () => {
    setLoading(true);
    setError("");
    try {
      const body = {
        filters: filters.filter(f => f.column),
        groupBy: groupBy || undefined,
        aggregation: aggFn || undefined,
        aggColumn: aggCol || undefined,
        sortBy: sortBy || undefined,
        sortDir,
        limit: parseInt(limit) || 500,
      };
      const res = await fetch(`/api/datasets/${id}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json() as typeof result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 flex flex-col gap-6">
      <header className="border-b pb-5">
        <h1 className="text-3xl font-bold tracking-tight">Query Builder</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Filter, group, and aggregate your dataset — no SQL needed.
        </p>
      </header>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Filters</CardTitle>
            <Button size="sm" variant="outline" onClick={addFilter} disabled={columns.length === 0}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add filter
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {filters.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No filters — all rows will be returned.</p>
          )}
          {filters.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={f.column} onValueChange={v => updateFilter(i, { column: v })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{columns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={f.operator} onValueChange={v => updateFilter(i, { operator: v })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>{OPERATORS.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}</SelectContent>
              </Select>
              {!["is_null", "not_null"].includes(f.operator) && (
                <Input
                  className="w-40"
                  placeholder="value"
                  value={f.value}
                  onChange={e => updateFilter(i, { value: e.target.value })}
                />
              )}
              <Button size="icon" variant="ghost" onClick={() => removeFilter(i)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Group By & Aggregation */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Group By & Aggregate</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-medium">GROUP BY</span>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="w-40"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {columns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {groupBy && groupBy !== "__none__" && (
              <>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground font-medium">FUNCTION</span>
                  <Select value={aggFn} onValueChange={setAggFn}>
                    <SelectTrigger className="w-36"><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>{AGGREGATIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground font-medium">ON COLUMN</span>
                  <Select value={aggCol} onValueChange={setAggCol}>
                    <SelectTrigger className="w-40"><SelectValue placeholder="Select column" /></SelectTrigger>
                    <SelectContent>{numericCols.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Sort & Limit */}
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground font-medium">SORT BY</span>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-40"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {columns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground font-medium">DIRECTION</span>
          <Select value={sortDir} onValueChange={v => setSortDir(v as "asc" | "desc")}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground font-medium">LIMIT</span>
          <Input className="w-24" value={limit} onChange={e => setLimit(e.target.value)} />
        </div>
        <Button onClick={run} disabled={loading} className="flex items-center gap-2 mb-0.5">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run Query
        </Button>
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 rounded p-3">{error}</p>}

      {result && (
        <Card>
          <CardHeader className="py-3 px-4 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">
                {result.totalCount.toLocaleString()} rows
                {result.rows.length < result.totalCount && ` (showing ${result.rows.length})`}
              </CardTitle>
              <span className="text-xs text-muted-foreground">{result.executionTimeMs}ms</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="w-full max-h-[440px]">
              <Table>
                <TableHeader className="bg-muted/40 sticky top-0 z-10">
                  <TableRow>
                    {result.columns.map(c => (
                      <TableHead key={c} className="text-xs font-semibold whitespace-nowrap px-3 py-2">{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, i) => (
                    <TableRow key={i} className="hover:bg-muted/30">
                      {result.columns.map(c => (
                        <TableCell key={c} className="text-xs px-3 py-1.5 whitespace-nowrap max-w-[200px] truncate">
                          {row[c] === null || row[c] === undefined ? <span className="text-muted-foreground italic">null</span> : String(row[c])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
