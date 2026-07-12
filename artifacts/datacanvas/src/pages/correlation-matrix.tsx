import { useParams } from "wouter";
import { useGetCorrelation, getGetCorrelationQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function CorrelationMatrix() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useGetCorrelation(id, {
    query: {
      enabled: !!id,
      queryKey: getGetCorrelationQueryKey(id)
    }
  });

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-[600px] w-full" /></div>;
  }

  if (!data) return <div className="p-8">No correlation data available</div>;

  return (
    <div className="p-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Correlation Matrix</h1>
        <p className="text-muted-foreground text-sm">Pearson correlation coefficients between numeric variables.</p>
      </header>

      <Card>
        <CardContent className="p-6 overflow-x-auto">
          <table className="w-full text-sm text-center">
            <thead>
              <tr>
                <th className="p-2 border"></th>
                {data.columns.map(col => (
                  <th key={col} className="p-2 border font-medium bg-muted/30">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.columns.map((rowCol, i) => (
                <tr key={rowCol}>
                  <th className="p-2 border font-medium bg-muted/30 text-left">{rowCol}</th>
                  {data.columns.map((_, j) => {
                    const val = data.matrix[i][j];
                    const absVal = Math.abs(val);
                    const color = val > 0 
                      ? `rgba(0, 120, 212, ${absVal * 0.8})` // Primary blue
                      : `rgba(209, 52, 56, ${absVal * 0.8})`; // Destructive red
                    const textColor = absVal > 0.5 ? 'white' : 'inherit';
                    
                    return (
                      <td key={j} className="p-2 border font-mono text-xs transition-colors hover:ring-2 hover:ring-inset hover:ring-primary hover:z-10 relative cursor-pointer" style={{ backgroundColor: color, color: textColor }}>
                        {val.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Strongest Pairs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {data.pairs.slice(0, 10).map((pair, i) => (
              <div key={i} className="flex items-center justify-between p-3 border rounded-md">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{pair.col1}</Badge>
                  <span className="text-muted-foreground text-xs">↔</span>
                  <Badge variant="secondary">{pair.col2}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={pair.strength === 'strong' ? 'default' : 'outline'}>{pair.strength}</Badge>
                  <span className="font-mono text-sm font-semibold">{pair.value.toFixed(3)}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
