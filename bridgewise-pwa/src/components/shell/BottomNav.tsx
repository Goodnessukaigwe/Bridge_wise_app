"use client";

import { Inbox, Wallet, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type WorkspaceTab = "order" | "stock" | "statement";

const TABS: { id: WorkspaceTab; label: string; icon: LucideIcon }[] = [
  { id: "order", label: "Order Stream", icon: Inbox },
  { id: "stock", label: "Stock Room", icon: Warehouse },
  { id: "statement", label: "Pocket Statement", icon: Wallet },
];

export function BottomNav({
  tab,
  onTabChange,
}: {
  tab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
}) {
  return (
    <nav
      aria-label="Workspace"
      className="relative z-10 grid shrink-0 grid-cols-3 gap-1 border-t border-[#E6E3F5] bg-white/95 px-2 pb-1 pt-1.5 shadow-[0_-6px_18px_-10px_rgba(23,16,74,0.25)]"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 text-[11px] leading-tight transition-colors active:scale-95 ${
              active
                ? "bg-[#ECE9FB] font-bold text-[#17104A]"
                : "font-semibold text-[#6B6898]"
            }`}
          >
            <Icon className="size-6" strokeWidth={active ? 2.4 : 2} aria-hidden />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
