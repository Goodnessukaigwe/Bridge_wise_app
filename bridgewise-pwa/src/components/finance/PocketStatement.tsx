"use client";

import { ArrowLeft, CheckCircle2, Inbox, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { todayDateKey } from "@/lib/db/dexie";
import { useDailyLedger, useDailyStatement, useOrders } from "@/lib/db/hooks";
import type { DailyStatement, LedgerEntry, Order } from "@/types/bridgewise";

type DrillView = "sales" | "capital" | "profit" | null;

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  return new Date(ts).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
  });
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

function SalesDrillDown({
  ledger,
  orders,
}: {
  ledger: LedgerEntry[];
  orders: Order[];
}) {
  const orderMap = useMemo(
    () => new Map(orders.map((o) => [o.order_id, o])),
    [orders],
  );
  const sales = useMemo(
    () => ledger.filter((e) => e.entry_type === "SALE"),
    [ledger],
  );
  const total = sales.reduce((s, e) => s + e.gross_amount, 0);

  return (
    <div>
      <p className="mb-4 text-sm text-[#6B6898]">
        {sales.length === 0
          ? "No confirmed sales yet today."
          : `${sales.length} confirmed order${sales.length !== 1 ? "s" : ""} · ${formatNaira(total)} total`}
      </p>
      <ul className="flex flex-col gap-3">
        {sales.map((entry) => {
          const order = entry.ref_order_id
            ? orderMap.get(entry.ref_order_id)
            : undefined;
          const time = formatTime(entry.created_at);
          return (
            <li
              key={entry.txn_id}
              className="rounded-[14px] border border-[#E8E6F0] bg-white p-4 shadow-[0_1px_4px_rgba(15,10,46,0.08)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[#0F0A2E]">
                    {order?.customer_name || "Customer"}
                  </p>
                  {order?.items.map((item) => (
                    <p
                      key={`${entry.txn_id}-${item.product_id}`}
                      className="text-xs text-[#6B6898]"
                    >
                      {item.quantity}× {item.product_name}
                    </p>
                  ))}
                </div>
                <div className="shrink-0 text-right">
                  <p className="amount font-bold text-[#0F0A2E]">
                    {formatNaira(entry.gross_amount)}
                  </p>
                  {time ? (
                    <p className="text-xs text-[#9B97B8]">{time}</p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CapitalDrillDown({
  ledger,
  orders,
}: {
  ledger: LedgerEntry[];
  orders: Order[];
}) {
  const orderMap = useMemo(
    () => new Map(orders.map((o) => [o.order_id, o])),
    [orders],
  );
  const sales = useMemo(
    () => ledger.filter((e) => e.entry_type === "SALE"),
    [ledger],
  );

  const byProduct = useMemo(() => {
    const map = new Map<
      string,
      { name: string; qty: number; unitCost: number; total: number }
    >();
    for (const entry of sales) {
      if (!entry.ref_order_id) continue;
      const order = orderMap.get(entry.ref_order_id);
      if (!order) continue;
      for (const item of order.items) {
        const key = item.product_id || item.product_name;
        const existing = map.get(key);
        const cost = item.unit_cost_price * item.quantity;
        if (existing) {
          existing.qty += item.quantity;
          existing.total += cost;
        } else {
          map.set(key, {
            name: item.product_name,
            qty: item.quantity,
            unitCost: item.unit_cost_price,
            total: cost,
          });
        }
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [sales, orderMap]);

  const totalCapital = byProduct.reduce((s, p) => s + p.total, 0);

  return (
    <div>
      <p className="mb-1 text-sm text-[#6B6898]">
        This money covers your restocking cost. Set it aside before spending.
      </p>
      <p className="mb-4 text-xs text-[#9B97B8]">
        Breakdown by product sold today
      </p>
      {byProduct.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#6B6898]">
          No sales yet today.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {byProduct.map((p) => (
              <li
                key={p.name}
                className="flex items-center justify-between rounded-[12px] border border-[#E8E6F0] bg-white px-4 py-3"
              >
                <div>
                  <p className="font-medium text-[#0F0A2E]">{p.name}</p>
                  <p className="text-xs text-[#6B6898]">
                    {p.qty} sold × {formatNaira(p.unitCost)}
                  </p>
                </div>
                <p className="amount font-semibold text-[#0F0A2E]">
                  {formatNaira(p.total)}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between rounded-[12px] bg-[#FEF3C7] px-4 py-3">
            <p className="font-semibold text-[#92400E]">Total locked</p>
            <p className="amount font-bold text-[#92400E]">
              {formatNaira(totalCapital)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function ProfitDrillDown({
  statement,
  ledger,
}: {
  statement: DailyStatement | null;
  ledger: LedgerEntry[];
}) {
  const expenses = useMemo(
    () => ledger.filter((e) => e.entry_type === "EXPENSE"),
    [ledger],
  );
  const sales = statement?.total_sales ?? 0;
  const capital = statement?.protected_capital ?? 0;
  const profit = statement?.net_profit ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between rounded-[12px] border border-[#E8E6F0] bg-white px-4 py-3">
        <p className="text-sm text-[#6B6898]">Total sales</p>
        <p className="amount font-semibold text-[#0F0A2E]">
          {formatNaira(sales)}
        </p>
      </div>
      <div className="flex items-center justify-between rounded-[12px] border border-[#E8E6F0] bg-white px-4 py-3">
        <p className="text-sm text-[#6B6898]">— Restock capital</p>
        <p className="amount font-semibold text-[#F59E0B]">
          −{formatNaira(capital)}
        </p>
      </div>
      {expenses.length > 0 ? (
        <>
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#6B6898]">
            Expenses
          </p>
          {expenses.map((e) => (
            <div
              key={e.txn_id}
              className="flex items-center justify-between rounded-[12px] border border-[#E8E6F0] bg-white px-4 py-3"
            >
              <div>
                <p className="text-sm text-[#0F0A2E]">
                  {e.category || "Expense"}
                </p>
                {e.note ? (
                  <p className="text-xs text-[#6B6898]">{e.note}</p>
                ) : null}
              </div>
              <p className="amount font-semibold text-[#6B6898]">
                −{formatNaira(e.gross_amount)}
              </p>
            </div>
          ))}
        </>
      ) : null}
      <div
        className={`mt-2 flex items-center justify-between rounded-[12px] border-2 px-4 py-4 ${profit >= 0 ? "border-[#10B981] bg-[#ECFDF5]" : "border-red-400 bg-red-50"}`}
      >
        <p
          className={`font-semibold ${profit >= 0 ? "text-[#065F46]" : "text-red-700"}`}
        >
          Net profit
        </p>
        <p
          className={`amount text-[22px] font-bold ${profit >= 0 ? "text-[#10B981]" : "text-red-600"}`}
        >
          {profit < 0 ? "−" : ""}
          {formatNaira(Math.abs(profit))}
        </p>
      </div>
    </div>
  );
}

type Bucket = {
  key: DrillView;
  label: string;
  subtitle: string | null;
  subtitleClass: string | null;
  amount: string;
  Icon: LucideIcon;
  borderClass: string;
};

const DRILL_TITLES: Record<NonNullable<DrillView>, string> = {
  sales: "Today's Sales",
  capital: "Protected Capital",
  profit: "Today's P&L",
};

export function PocketStatement() {
  const today = todayDateKey();
  const statement = useDailyStatement(today);
  const ledger = useDailyLedger(today);
  const orders = useOrders();
  const [activeView, setActiveView] = useState<DrillView>(null);

  if (statement === undefined || ledger === undefined || orders === undefined) {
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
      key: "sales",
      label: "Total Sales Collected",
      subtitle: null,
      subtitleClass: null,
      amount: formatNaira(sales),
      Icon: Inbox,
      borderClass: "border-l-[#17104A]",
    },
    {
      key: "capital",
      label: "Protected Restock Capital",
      subtitle: "Do Not Spend",
      subtitleClass: "text-[#F59E0B]",
      amount: formatNaira(capital),
      Icon: Lock,
      borderClass: "border-l-[#F59E0B]",
    },
    {
      key: "profit",
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
        {buckets.map(
          ({ key, label, subtitle, subtitleClass, amount, Icon, borderClass }) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setActiveView(key)}
                className={`flex w-full items-start gap-3 rounded-[14px] border border-[#E8E6F0] border-l-4 bg-white p-4 shadow-[0_1px_4px_rgba(15,10,46,0.08)] text-left active:bg-[#F4F3FF] transition-colors ${borderClass}`}
              >
                <Icon
                  className="mt-0.5 size-5 shrink-0 text-[#6B6898]"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium uppercase tracking-[0.5px] text-[#6B6898]">
                    {label}
                  </p>
                  {subtitle ? (
                    <p
                      className={`mt-0.5 text-xs font-semibold tracking-wide ${subtitleClass}`}
                    >
                      {subtitle}
                    </p>
                  ) : null}
                  <p className="amount mt-1 text-[28px] font-bold leading-tight text-[#0F0A2E]">
                    {amount}
                  </p>
                </div>
                <span className="mt-1 text-[#9B97B8]" aria-hidden>›</span>
              </button>
            </li>
          ),
        )}
      </ul>
      {expenses > 0 ? (
        <p className="mt-4 text-center text-sm text-[#6B6898]">
          After {formatNaira(expenses)} expenses
        </p>
      ) : null}

      {/* Drill-down slide panel (fixed overlay) */}
      <div
        className="fixed inset-0 z-20 flex justify-center bg-[#F4F3FF] transition-transform duration-[250ms] ease-out"
        style={{ transform: activeView ? "translateX(0)" : "translateX(100%)" }}
        aria-hidden={!activeView}
      >
        <div className="flex h-full w-full max-w-md flex-col">
          <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-6">
            <button
              type="button"
              onClick={() => setActiveView(null)}
              className="inline-flex size-9 items-center justify-center rounded-full text-[#6B6898] active:bg-[#E8E6F0]"
              aria-label="Back to statement"
            >
              <ArrowLeft className="size-5" />
            </button>
            <h2 className="text-[18px] font-bold text-[#0F0A2E]">
              {activeView ? DRILL_TITLES[activeView] : ""}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-10">
            {activeView === "sales" && (
              <SalesDrillDown ledger={ledger} orders={orders} />
            )}
            {activeView === "capital" && (
              <CapitalDrillDown ledger={ledger} orders={orders} />
            )}
            {activeView === "profit" && (
              <ProfitDrillDown
                statement={statement ?? null}
                ledger={ledger}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
