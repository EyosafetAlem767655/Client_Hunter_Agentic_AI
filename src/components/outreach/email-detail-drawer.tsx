"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface OutreachRow {
  id: number;
  subject: string;
  body: string;
  status: string;
  recipient: string;
  company: string;
  jobTitle: string;
}

export function EmailDetailDrawer({
  row,
  open,
  onClose,
}: {
  row: OutreachRow | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>{row.subject}</SheetTitle>
            </SheetHeader>
            <p className="mt-2 text-sm text-muted-foreground">
              To: {row.recipient} · {row.company}
            </p>
            <p className="mt-1 text-sm">Re: {row.jobTitle}</p>
            <pre className="mt-6 whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm font-sans">
              {row.body}
            </pre>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
