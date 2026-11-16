"use client";

import { statementId, todayDateKey } from "@/lib/db/dexie";
import { useDailyStatement } from "@/lib/db/hooks";

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

/** Human date from `YYYY-MM-DD` (local calendar, not UTC). */
function formatHumanDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function PocketStatement() {
  const today = todayDateKey();
  const statement = useDailyStatement(today);

  if (statement === undefined) {
    return (
      <section className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">
          Pocket Statement
        </h1>
        <p className="mt-3 text-sm text-neutral-600">Loading statement…</p>
      </section>
    );
  }

  const sales = statement?.total_sales ?? 0;
  const capital = statement?.protected_capital ?? 0;
  const profit = statement?.net_profit ?? 0;
  const expenses = statement?.total_expenses ?? 0;
  const emptyDay =
    sales === 0 && capital === 0 && profit === 0 && expenses === 0;

  const buckets = [
    {
      label: "Total Sales Collected",
      subtitle: null,
      amount: formatNaira(sales),
    },
    {
      label: "Protected Restock Capital",
      subtitle: "Do Not Spend",
      amount: formatNaira(capital),
    },
    {
      label: "Safe Net Profit",
      subtitle: "Yours",
      amount: formatNaira(profit),
    },
  ] as const;

  return (
    <section className="flex min-h-full flex-col px-4 py-6">
      <h1 className="text-center text-lg font-semibold text-neutral-900">
        Pocket Statement
      </h1>
      <p className="mt-1 text-center text-sm text-neutral-600">
        {formatHumanDate(today)}
      </p>
      <p className="mt-0.5 text-center font-mono text-[11px] text-neutral-500">
        {statementId(today)}
      </p>
      <p className="mt-2 text-center text-sm text-neutral-600">
        {emptyDay
          ? "No sales today — ₦0."
          : sales === 0 && expenses > 0
            ? "Today’s expenses."
            : "Today’s confirmed sales."}
      </p>
      <ul className="mt-6 space-y-3">
        {buckets.map(({ label, subtitle, amount }) => (
          <li
            key={label}
            className="rounded-xl border border-neutral-200 bg-white px-4 py-4"
          >
            <p className="text-sm font-medium text-neutral-600">{label}</p>
            {subtitle ? (
              <p className="mt-0.5 text-xs font-semibold tracking-wide text-neutral-500">
                {subtitle}
              </p>
            ) : null}
            <p className="mt-1 text-3xl font-semibold tabular-nums text-neutral-900">
              {amount}
            </p>
          </li>
        ))}
      </ul>
      {expenses > 0 ? (
        <p className="mt-4 text-center text-sm text-neutral-600">
          After {formatNaira(expenses)} expenses
        </p>
      ) : null}
    </section>
  );
}
