import { useListDatasets, getListDatasetsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Database, FileSpreadsheet, HardDrive, TableProperties, UploadCloud } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export default function Dashboard() {
  const { data: rawDatasets, isLoading } = useListDatasets();
  // Defensive: the hook can return null on 304-cached responses; always coerce to array
  const datasets = Array.isArray(rawDatasets) ? rawDatasets : [];
  const [, setLocation] = useLocation();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const res = await fetch("/api/datasets", {
        method: "POST",
        body: formData,
      });
      
      if (!res.ok) {
        let msg = "There was an error uploading your file.";
        try {
          const body = await res.json() as { error?: string };
          if (body.error) msg = body.error;
        } catch { /* ignore parse error */ }
        throw new Error(msg);
      }
      
      const newDataset = await res.json() as { id: string; name: string };
      await queryClient.invalidateQueries({ queryKey: getListDatasetsQueryKey() });
      toast({ title: "Dataset uploaded", description: `${newDataset.name} is ready for analysis.` });
      setLocation(`/datasets/${newDataset.id}`);
    } catch (err) {
      toast({ title: "Upload Failed", description: err instanceof Error ? err.message : "Upload error", variant: "destructive" });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="p-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm">Upload, explore, and analyze your datasets with precision.</p>
      </header>
      
      <main className="flex-1">
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Datasets</CardTitle>
              <Database className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{isLoading ? <Skeleton className="h-8 w-16" /> : datasets?.length || 0}</div>
            </CardContent>
          </Card>

          <Card className="md:col-span-3 border-dashed border-2 border-muted hover:border-primary transition-colors bg-muted/20">
            <CardContent className="flex flex-col items-center justify-center h-full p-6 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv,.xlsx,.xls" className="hidden" />
              {isUploading ? (
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
                  <span className="text-sm font-medium">Uploading dataset...</span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <UploadCloud className="h-6 w-6 text-primary" />
                  <span className="text-sm font-medium">Click to upload or drag and drop a CSV/Excel file</span>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="h-[150px]">
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-1/2 mb-2" />
                  <Skeleton className="h-4 w-1/3" />
                </CardContent>
              </Card>
            ))
          ) : datasets?.map((ds) => (
            <Card key={ds.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setLocation(`/datasets/${ds.id}`)}>
              <CardHeader>
                <CardTitle className="text-lg truncate">{ds.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <TableProperties className="h-4 w-4 text-muted-foreground/70" />
                    <span>{ds.rowCount.toLocaleString()} rows × {ds.columnCount} cols</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-muted-foreground/70" />
                    <span>{(ds.fileSizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {datasets?.length === 0 && !isLoading && (
            <div className="col-span-full flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-lg border-muted">
              <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No datasets found</h3>
              <p className="text-sm text-muted-foreground mb-4">Upload a CSV or Excel file to get started.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
