import { useParams } from "wouter";
import { useGetOutliers, getGetOutliersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

export default function OutlierDetection() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useGetOutliers(id, {
    query: {
      enabled: !!id,
      queryKey: getGetOutliersQueryKey(id)
    }
  });

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!data) return <div className="p-8">No outlier data available</div>;

  return (
    <div className="p-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Outlier Detection</h1>
        <p className="text-muted-foreground text-sm">Identifying anomalies using IQR methodology.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Total Outliers: {data.totalOutlierRows.toLocaleString()} rows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {data.columns.map((col, i) => (
            <div key={i} className="flex flex-col gap-2 border-b last:border-b-0 pb-4 last:pb-0">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{col.column}</span>
                <span className="text-sm font-mono">{col.count.toLocaleString()} ({col.pct.toFixed(2)}%)</span>
              </div>
              <Progress value={col.pct} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>Lower Bound: {col.lowerBound.toFixed(2)}</span>
                <span>Upper Bound: {col.upperBound.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
