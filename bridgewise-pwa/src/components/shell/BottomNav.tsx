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
      className="grid shrink-0 grid-cols-3 border-t border-[#E8E6F0] bg-white pb-1"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 flex-col items-center justify-center gap-0.5 border-t-[3px] px-1 py-2 text-[11px] leading-tight transition-colors ${
              active
                ? "border-[#17104A] font-semibold text-[#17104A]"
                : "border-transparent font-medium text-[#9B97B8]"
            }`}
          >
            <Icon className="size-5" strokeWidth={active ? 2.4 : 2} aria-hidden />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
