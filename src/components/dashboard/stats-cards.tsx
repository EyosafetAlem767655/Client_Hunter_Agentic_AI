"use client";

import Link from "next/link";
import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import {
  CheckCircle2,
  Inbox,
  Mail,
  Send,
  Sparkles,
  UserSearch,
} from "lucide-react";

type StatKey =
  | "scraped"
  | "relevant"
  | "contactsFound"
  | "drafted"
  | "sent"
  | "replied";

const META: Record<
  StatKey,
  {
    label: string;
    hint: string;
    icon: React.ComponentType<{ className?: string }>;
    grad: string;
    ring: string;
    href: (window: string) => string;
  }
> = {
  scraped: {
    label: "Scraped",
    hint: "VA postings ingested",
    icon: Inbox,
    grad: "from-amber-200/70 via-amber-100/40 to-transparent",
    ring: "ring-amber-700/30",
    href: (w) => `/jobs?window=${w}`,
  },
  relevant: {
    label: "Relevant",
    hint: "Passed LLM filter",
    icon: Sparkles,
    grad: "from-orange-200/70 via-orange-100/40 to-transparent",
    ring: "ring-orange-700/30",
    href: (w) => `/jobs?status=relevant&window=${w}`,
  },
  contactsFound: {
    label: "Contacts",
    hint: "Discovered emails",
    icon: UserSearch,
    grad: "from-yellow-200/70 via-yellow-100/40 to-transparent",
    ring: "ring-yellow-700/30",
    href: (w) => `/jobs?status=with-contact&window=${w}`,
  },
  drafted: {
    label: "Drafted",
    hint: "Outreach queued",
    icon: Mail,
    grad: "from-stone-200/70 via-stone-100/40 to-transparent",
    ring: "ring-stone-700/30",
    href: (w) => `/outreach?status=pending&window=${w}`,
  },
  sent: {
    label: "Sent",
    hint: "Delivered in window",
    icon: Send,
    grad: "from-amber-300/70 via-amber-200/40 to-transparent",
    ring: "ring-amber-800/30",
    href: (w) => `/outreach?status=sent&window=${w}`,
  },
  replied: {
    label: "Replied",
    hint: "Lead engaged",
    icon: CheckCircle2,
    grad: "from-orange-300/70 via-orange-200/40 to-transparent",
    ring: "ring-orange-800/30",
    href: () => `/outreach?status=replied`,
  },
};

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
}

export function StatsCards({
  stats,
  timeWindow = "24h",
}: {
  stats: Record<string, number>;
  timeWindow?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {(Object.keys(META) as StatKey[]).map((key, i) => {
        const meta = META[key];
        const Icon = meta.icon;
        return (
          <motion.div
            key={key}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.4, ease: "easeOut" }}
          >
            <Link
              href={meta.href(timeWindow)}
              aria-label={`Drill into ${meta.label}`}
              className={`group relative block overflow-hidden rounded-2xl border border-amber-900/15 bg-gradient-to-br ${meta.grad} p-5 backdrop-blur-xl transition hover:border-amber-900/30 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-amber-900/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}
            >
              <div
                className={`pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-amber-200/40 blur-2xl transition group-hover:scale-110`}
                aria-hidden
              />
              <div className="relative flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {meta.label}
                  </p>
                  <p className="mt-3 text-3xl font-bold tabular-nums text-foreground">
                    <AnimatedNumber value={stats[key] ?? 0} />
                  </p>
                  <p className="mt-1 text-xs text-foreground/60">{meta.hint}</p>
                </div>
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 ring-1 ${meta.ring}`}
                >
                  <Icon className="h-4 w-4 text-foreground/80" />
                </div>
              </div>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}
