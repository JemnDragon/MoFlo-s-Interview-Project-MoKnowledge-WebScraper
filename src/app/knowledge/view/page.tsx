import { Suspense } from "react";
import { KnowledgeExplorer } from "@/components/view/KnowledgeExplorer";

export const dynamic = "force-dynamic";

export default function KnowledgeViewPage() {
  return (
    <Suspense
      fallback={
        <div className="card p-6 text-center">
          <p className="hint">Loading saved knowledge bases…</p>
        </div>
      }
    >
      <KnowledgeExplorer />
    </Suspense>
  );
}
