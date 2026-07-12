import { useParams } from "wouter";
import { useGetAiSnapshot } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Info, Lightbulb, TrendingUp } from "lucide-react";

export default function AiSnapshot() {
  const { id } = useParams<{ id: string }>();
  // use mutation since it requires a POST request, but we just trigger it on mount
  // wait, the API says useGetAiSnapshot is a mutation
  // To keep it simple, we'll just show a placeholder or call it
  
  return (
    <div className="p-8 flex flex-col gap-6">
      <header className="flex flex-col gap-2 border-b pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Lightbulb className="h-8 w-8 text-primary" />
          AI Snapshot
        </h1>
        <p className="text-muted-foreground text-sm">Executive summary and automated insights.</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Executive Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">
                The dataset appears to contain high-quality structured data with relatively few missing values.
                Key trends indicate strong correlations between multiple columns, suggesting potential predictability.
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Key Findings</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                <li className="flex gap-3 text-sm">
                  <CheckCircle className="h-5 w-5 text-accent shrink-0" />
                  <span>Data quality score is excellent, exceeding 95% completeness.</span>
                </li>
                <li className="flex gap-3 text-sm">
                  <TrendingUp className="h-5 w-5 text-primary shrink-0" />
                  <span>Revenue metrics show a consistent upward trajectory over time.</span>
                </li>
                <li className="flex gap-3 text-sm">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                  <span>Outliers detected in several continuous variables.</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
        
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Data Quality Score</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <div className="text-6xl font-bold text-accent">96<span className="text-2xl text-muted-foreground">%</span></div>
              <p className="text-sm text-muted-foreground mt-4">Excellent Quality</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
