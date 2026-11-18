"use client";

import { CheckCircle2, Inbox, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { todayDateKey } from "@/lib/db/dexie";
import { useDailyStatement } from "@/lib/db/hooks";

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatHumanDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

type Bucket = {
  label: string;
  subtitle: string | null;
  subtitleClass: string | null;
  amount: string;
  Icon: LucideIcon;
  borderClass: string;
};

export function PocketStatement() {
  const today = todayDateKey();
  const statement = useDailyStatement(today);

  if (statement === undefined) {
    return (
      <section className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
        <h1 className="text-[22px] font-bold text-[#0F0A2E]">
          Pocket Statement
        </h1>
        <p className="mt-3 text-sm text-[#6B6898]">Loading statement…</p>
      </section>
    );
  }

  const sales = statement?.total_sales ?? 0;
  const capital = statement?.protected_capital ?? 0;
  const profit = statement?.net_profit ?? 0;
  const expenses = statement?.total_expenses ?? 0;
  const emptyDay =
    sales === 0 && capital === 0 && profit === 0 && expenses === 0;

  const buckets: Bucket[] = [
    {
      label: "Total Sales Collected",
      subtitle: null,
      subtitleClass: null,
      amount: formatNaira(sales),
      Icon: Inbox,
      borderClass: "border-l-[#17104A]",
    },
    {
      label: "Protected Restock Capital",
      subtitle: "Do Not Spend",
      subtitleClass: "text-[#F59E0B]",
      amount: formatNaira(capital),
      Icon: Lock,
      borderClass: "border-l-[#F59E0B]",
    },
    {
      label: "Safe Net Profit",
      subtitle: "Yours",
      subtitleClass: "text-[#10B981]",
      amount: formatNaira(profit),
      Icon: CheckCircle2,
      borderClass: "border-l-[#10B981]",
    },
  ];

  return (
    <section className="flex min-h-full flex-col px-4 py-6">
      <h1 className="text-center text-[22px] font-bold text-[#0F0A2E]">
        Pocket Statement
      </h1>
      <p className="mt-1 text-center text-[14px] text-[#6B6898]">
        {formatHumanDate(today)}
      </p>
      <p className="mt-2 text-center text-sm text-[#6B6898]">
        {emptyDay
          ? "Nothing confirmed yet today."
          : sales === 0 && expenses > 0
            ? "Today's expenses."
            : "Today's confirmed sales."}
      </p>
      <ul className="mt-6 flex flex-col gap-3">
        {buckets.map(({ label, subtitle, subtitleClass, amount, Icon, borderClass }) => (
          <li
            key={label}
            className={`flex items-start gap-3 rounded-[14px] border border-[#E8E6F0] border-l-4 bg-white p-4 shadow-[0_1px_4px_rgba(15,10,46,0.08)] ${borderClass}`}
          >
            <Icon className="mt-0.5 size-5 shrink-0 text-[#6B6898]" strokeWidth={1.8} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium uppercase tracking-[0.5px] text-[#6B6898]">
                {label}
              </p>
              {subtitle ? (
                <p className={`mt-0.5 text-xs font-semibold tracking-wide ${subtitleClass}`}>
                  {subtitle}
                </p>
              ) : null}
              <p className="amount mt-1 text-[28px] font-bold leading-tight text-[#0F0A2E]">
                {amount}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {expenses > 0 ? (
        <p className="mt-4 text-center text-sm text-[#6B6898]">
          After {formatNaira(expenses)} expenses
        </p>
      ) : null}
    </section>
  );
}
