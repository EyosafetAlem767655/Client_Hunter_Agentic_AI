"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

export function RefreshButton() {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  function handleRefresh() {
    setSpinning(true);
    router.refresh();
    setTimeout(() => setSpinning(false), 1200);
  }

  return (
    <button
      onClick={handleRefresh}
      title="Refresh dashboard data"
      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-900/15 bg-white/50 px-3 py-1.5 text-xs font-medium text-foreground/70 backdrop-blur transition hover:border-amber-900/30 hover:text-foreground"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} />
      Refresh
    </button>
  );
}
