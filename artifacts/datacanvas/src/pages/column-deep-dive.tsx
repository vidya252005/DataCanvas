import { useParams } from "wouter";
import { useGetColumnAnalysis, getGetColumnAnalysisQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function ColumnDeepDive() {
  const { id, column } = useParams<{ id: string, column: string }>();
  const { data, isLoading } = useGetColumnAnalysis(id, column, {
    query: {
      enabled: !!id && !!column,
      queryKey: getGetColumnAnalysisQueryKey(id, column)
    }
  });

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!data) return <div className="p-8">Column not found</div>;

  return (
    <div className="p-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b pb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{data.column}</h1>
          <Badge variant="outline">{data.dtype}</Badge>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Visual placeholder for distribution */}
            <div className="h-64 bg-muted/20 rounded-md border border-dashed flex items-center justify-center text-muted-foreground">
              Distribution Chart
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Null Count</span><span className="font-semibold text-base">{data.nullCount}</span></div>
              <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Unique Count</span><span className="font-semibold text-base">{data.uniqueCount}</span></div>
            </div>
            
            <div>
              <h4 className="text-sm font-medium mb-2">Sample Values</h4>
              <div className="flex flex-wrap gap-2">
                {data.sampleValues.map((val, i) => (
                  <Badge key={i} variant="secondary">{val}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
