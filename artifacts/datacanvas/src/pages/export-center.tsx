import { useState } from "react";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { FileText, Presentation, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Status = "idle" | "loading" | "done" | "error";

export default function ExportCenter() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const set = (k: string, s: Status) => setStatuses((p) => ({ ...p, [k]: s }));

  const download = async (key: string, url: string, method: string, filename: string, openInTab = false) => {
    set(key, "loading");
    try {
      const res = await fetch(url, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : {},
        body: method === "POST" ? JSON.stringify({}) : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (openInTab) {
        const html = await res.text();
        const blob = new Blob([html], { type: "text/html" });
        const objUrl = URL.createObjectURL(blob);
        window.open(objUrl, "_blank");
        setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
        toast({ title: "Report opened", description: "Use File → Print → Save as PDF in the new tab." });
      } else {
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: objUrl, download: filename });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objUrl);
        toast({ title: "Downloaded", description: filename });
      }
      set(key, "done");
    } catch {
      set(key, "error");
      toast({ title: "Export failed", description: "Check that EDA and AI Snapshot have been run first.", variant: "destructive" });
    }
  };

  const Icon = ({ k }: { k: string }) => {
    if (statuses[k] === "loading") return <Loader2 className="h-4 w-4 animate-spin" />;
    if (statuses[k] === "done") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    return null;
  };

  return (
    <div className="p-8 max-w-2xl">
      <header className="mb-8 border-b pb-5">
        <h1 className="text-3xl font-bold tracking-tight">Export Center</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Run EDA and AI Snapshot first to maximise report content.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {/* HTML Report */}
        <div className="flex items-center justify-between rounded-xl border p-5">
          <div className="flex items-center gap-4">
            <div className="bg-red-50 p-3 rounded-xl">
              <FileText className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <div className="font-semibold">HTML Report</div>
              <div className="text-sm text-muted-foreground">
                Full structured report — open in browser and print as PDF
              </div>
            </div>
          </div>
          <Button
            className="bg-red-600 hover:bg-red-700 text-white min-w-[140px]"
            disabled={statuses["html"] === "loading"}
            onClick={() => download("html", `/api/datasets/${id}/export/pdf`, "POST", "", true)}
          >
            <Icon k="html" />
            {statuses["html"] === "loading" ? "Generating…" : "Open Report"}
          </Button>
        </div>

        {/* PowerPoint */}
        <div className="flex items-center justify-between rounded-xl border p-5">
          <div className="flex items-center gap-4">
            <div className="bg-orange-50 p-3 rounded-xl">
              <Presentation className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <div className="font-semibold">PowerPoint Deck</div>
              <div className="text-sm text-muted-foreground">
                10-slide executive presentation — all analysis sections included
              </div>
            </div>
          </div>
          <Button
            className="bg-orange-600 hover:bg-orange-700 text-white min-w-[140px]"
            disabled={statuses["pptx"] === "loading"}
            onClick={() => download("pptx", `/api/datasets/${id}/export/pptx`, "POST", "analysis.pptx")}
          >
            <Icon k="pptx" />
            {statuses["pptx"] === "loading" ? "Generating…" : "Download PPTX"}
          </Button>
        </div>
      </div>
    </div>
  );
}
