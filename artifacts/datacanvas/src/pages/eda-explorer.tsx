import { useParams } from "wouter";
import { useGetEda, getGetEdaQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

export default function EdaExplorer() {
  const { id } = useParams<{ id: string }>();
  const { data: eda, isLoading } = useGetEda(id, {
    query: {
      enabled: !!id,
      queryKey: getGetEdaQueryKey(id)
    }
  });

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!eda) return <div className="p-8">EDA not available</div>;

  return (
    <div className="p-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">EDA Explorer</h1>
        <p className="text-muted-foreground text-sm">Exploratory Data Analysis across numeric and categorical features.</p>
      </header>

      <Tabs defaultValue="numeric" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="numeric">Numeric Columns ({eda.numericColumns.length})</TabsTrigger>
          <TabsTrigger value="categorical">Categorical Columns ({eda.categoricalColumns.length})</TabsTrigger>
          <TabsTrigger value="missing">Missing Values</TabsTrigger>
        </TabsList>
        
        <TabsContent value="numeric" className="space-y-6">
          {eda.numericColumns.map(col => (
            <Card key={col.column}>
              <CardHeader>
                <CardTitle>{col.column}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Mean</span><span className="font-semibold text-base">{col.mean.toFixed(2)}</span></div>
                  <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Median</span><span className="font-semibold text-base">{col.median.toFixed(2)}</span></div>
                  <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Min</span><span className="font-semibold text-base">{col.min.toFixed(2)}</span></div>
                  <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Max</span><span className="font-semibold text-base">{col.max.toFixed(2)}</span></div>
                  <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Std Dev</span><span className="font-semibold text-base">{col.std.toFixed(2)}</span></div>
                  <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Missing</span><span className="font-semibold text-base">{col.nullCount.toLocaleString()}</span></div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={col.histogram}>
                      <XAxis dataKey="label" fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{fill: 'rgba(0,0,0,0.05)'}} />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="categorical" className="space-y-6">
          {eda.categoricalColumns.map(col => (
            <Card key={col.column}>
              <CardHeader>
                <CardTitle>{col.column}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Unique Values</span><span className="font-semibold text-base">{col.uniqueCount.toLocaleString()}</span></div>
                  <div className="flex flex-col border rounded-md p-3"><span className="text-muted-foreground text-xs">Missing</span><span className="font-semibold text-base">{col.nullCount.toLocaleString()}</span></div>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={col.topValues} layout="vertical" margin={{ left: 50 }}>
                      <XAxis type="number" fontSize={10} hide />
                      <YAxis dataKey="value" type="category" fontSize={10} tickLine={false} axisLine={false} width={100} />
                      <Tooltip cursor={{fill: 'rgba(0,0,0,0.05)'}} />
                      <Bar dataKey="count" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
