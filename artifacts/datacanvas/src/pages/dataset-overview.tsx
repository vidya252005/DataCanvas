import { useParams } from "wouter";
import { useGetDataset, getGetDatasetQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function DatasetOverview() {
  const { id } = useParams<{ id: string }>();
  const { data: detail, isLoading } = useGetDataset(id, {
    query: {
      enabled: !!id,
      queryKey: getGetDatasetQueryKey(id)
    }
  });

  if (isLoading) {
    return <div className="p-8 space-y-6"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  if (!detail) return <div className="p-8">Dataset not found</div>;

  return (
    <div className="p-8 flex flex-col gap-6">
      <header className="flex flex-col gap-4 border-b pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{detail.dataset.name}</h1>
          <div className="flex gap-2 mt-2 items-center text-sm text-muted-foreground">
            <Badge variant="outline">{detail.dataset.rowCount.toLocaleString()} rows</Badge>
            <Badge variant="outline">{detail.dataset.columnCount} cols</Badge>
            <Badge variant="outline">{detail.dataset.fileType.toUpperCase()}</Badge>
            <Badge variant="outline">{(detail.dataset.fileSizeBytes / 1024 / 1024).toFixed(2)} MB</Badge>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Card className="flex flex-col h-full shadow-sm">
          <CardHeader>
            <CardTitle>Data Preview</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-hidden flex-1 flex flex-col">
            <ScrollArea className="w-full max-h-[600px] border-t">
              <Table>
                <TableHeader className="bg-muted/50 sticky top-0 z-10 shadow-sm">
                  <TableRow>
                    {detail.dataset.columns.map(col => (
                      <TableHead key={col} className="whitespace-nowrap font-semibold text-foreground py-3 border-r last:border-r-0">
                        <div className="flex flex-col gap-1">
                          <span>{col}</span>
                          <span className="text-xs font-normal text-muted-foreground flex gap-1">
                            <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px]">{detail.columnTypes[col] || 'unknown'}</span>
                          </span>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.previewRows.map((row: any, i) => (
                    <TableRow key={i} className="hover:bg-muted/30 transition-colors even:bg-muted/10">
                      {detail.dataset.columns.map(col => (
                        <TableCell key={col} className="max-w-[300px] truncate border-r last:border-r-0 py-2.5">
                          {row[col] !== null && row[col] !== undefined ? String(row[col]) : <span className="text-muted-foreground/50 italic">null</span>}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
