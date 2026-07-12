import { useState, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { 
  BarChart2, 
  Database, 
  LayoutDashboard, 
  LineChart, 
  Network, 
  Search, 
  Sparkles, 
  Target,
  FileDown
} from "lucide-react";
import { useGetDataset } from "@workspace/api-client-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  
  // Extract dataset ID if we are in a dataset route
  const match = location.match(/\/datasets\/([^\/]+)/);
  const datasetId = match ? match[1] : null;
  
  const { data: datasetDetail } = useGetDataset(datasetId || "", {
    query: {
      enabled: !!datasetId,
      queryKey: ["getDataset", datasetId || ""],
    }
  });

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <Link href="/">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 cursor-pointer text-sidebar-primary-foreground">
              <Database className="h-5 w-5" />
              DataCanvas
            </h1>
          </Link>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-2">
            <li>
              <Link href="/">
                <span className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${location === "/" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
                  <LayoutDashboard className="h-4 w-4" />
                  Dashboard
                </span>
              </Link>
            </li>
            
            {datasetId && datasetDetail && (
              <div className="mt-6">
                <div className="px-3 mb-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                  {datasetDetail.dataset.name}
                </div>
                <li>
                  <Link href={`/datasets/${datasetId}`}>
                    <span className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${location === `/datasets/${datasetId}` ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
                      <TableProperties className="h-4 w-4" />
                      Overview
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`/datasets/${datasetId}/eda`}>
                    <span className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${location.includes("/eda") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
                      <BarChart2 className="h-4 w-4" />
                      EDA Explorer
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`/datasets/${datasetId}/correlation`}>
                    <span className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${location.includes("/correlation") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
                      <Network className="h-4 w-4" />
                      Correlation Matrix
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`/datasets/${datasetId}/outliers`}>
                    <span className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${location.includes("/outliers") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
                      <Target className="h-4 w-4" />
                      Outlier Detection
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`/datasets/${datasetId}/ai`}>
                    <span className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${location.includes("/ai") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
                      <Sparkles className="h-4 w-4" />
                      AI Snapshot
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`/datasets/${datasetId}/query`}>
                    <span className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${location.includes("/query") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
                      <Search className="h-4 w-4" />
                      Query Builder
                    </span>
                  </Link>
                </li>
                <li>
                  <Link href={`/datasets/${datasetId}/export`}>
                    <span className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors ${location.includes("/export") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"}`}>
                      <FileDown className="h-4 w-4" />
                      Export Center
                    </span>
                  </Link>
                </li>
              </div>
            )}
          </ul>
        </nav>
      </aside>
      
      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}

// Add the missing icon
function TableProperties(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 3v18" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M21 9H3" />
      <path d="M21 15H3" />
    </svg>
  );
}
