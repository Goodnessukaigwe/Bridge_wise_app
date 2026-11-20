"use client";

import { ArrowLeft, ChevronRight, Lock, PiggyBank, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductGrowth } from "@/components/finance/ProductGrowth";
import { CountUp } from "@/components/ui/CountUp";
import { EmptyState, PurseArt } from "@/components/ui/Illustrations";
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
      <p className="mb-4 text-[15px] font-medium text-[#55517F]">
        {sales.length === 0
          ? "No sales yet today."
          : `${sales.length} order${sales.length !== 1 ? "s" : ""} sold · ${formatNaira(total)}`}
      </p>
      {sales.length === 0 ? (
        <EmptyState
          art={<PurseArt className="w-full" />}
          title="Nothing sold yet today"
          body="When you mark an order as sold, it shows up here."
        />
      ) : null}
      <ul className="flex flex-col gap-3">
        {sales.map((entry, i) => {
          const order = entry.ref_order_id
            ? orderMap.get(entry.ref_order_id)
            : undefined;
          const time = formatTime(entry.created_at);
          return (
            <li
              key={entry.txn_id}
              className="card anim-card p-4"
              style={{ ["--i" as string]: Math.min(i, 8) }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[16px] font-bold text-[#0F0A2E]">
                    {order?.customer_name || "Customer"}
                  </p>
                  {order?.items.map((item) => (
                    <p
                      key={`${entry.txn_id}-${item.product_id}`}
                      className="text-[13px] text-[#55517F]"
                    >
                      {item.quantity}× {item.product_name}
                    </p>
                  ))}
                </div>
                <div className="shrink-0 text-right">
                  <p className="amount text-[17px] font-extrabold text-[#17104A]">
                    {formatNaira(entry.gross_amount)}
                  </p>
                  {time ? (
                    <p className="text-[12px] text-[#6B6898]">{time}</p>
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
      <p className="mb-1 text-[15px] font-medium text-[#55517F]">
        This is the money you need to buy more stock. Set it aside before you
        spend anything.
      </p>
      <p className="mb-4 text-[13px] text-[#6B6898]">
        Products sold today
      </p>
      {byProduct.length === 0 ? (
        <EmptyState
          art={<PurseArt className="w-full" />}
          title="Nothing to set aside yet"
          body="Sell something today and we will show what to keep for restocking."
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {byProduct.map((p) => (
              <li
                key={p.name}
                className="card flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="text-[16px] font-bold text-[#0F0A2E]">{p.name}</p>
                  <p className="text-[13px] text-[#55517F]">
                    {p.qty} sold × {formatNaira(p.unitCost)} each
                  </p>
                </div>
                <p className="amount text-[16px] font-extrabold text-[#0F0A2E]">
                  {formatNaira(p.total)}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-[#FEF0C7] px-4 py-3.5">
            <p className="font-bold text-[#7A4300]">Set aside for restocking</p>
            <p className="amount text-[18px] font-extrabold text-[#7A4300]">
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
      <div className="card flex items-center justify-between px-4 py-3.5">
        <p className="text-[15px] font-medium text-[#55517F]">Money from sales</p>
        <p className="amount font-bold text-[#0F0A2E]">
          {formatNaira(sales)}
        </p>
      </div>
      <div className="card flex items-center justify-between px-4 py-3.5">
        <p className="text-[15px] font-medium text-[#55517F]">Money for restocking</p>
        <p className="amount font-bold text-[#B45309]">
          −{formatNaira(capital)}
        </p>
      </div>
      {expenses.length > 0 ? (
        <>
          <p className="mt-2 text-[13px] font-bold text-[#55517F]">
            Money you spent
          </p>
          {expenses.map((e) => (
            <div
              key={e.txn_id}
              className="card flex items-center justify-between px-4 py-3.5"
            >
              <div>
                <p className="text-[15px] font-semibold text-[#0F0A2E]">
                  {e.category || "Spending"}
                </p>
                {e.note ? (
                  <p className="text-[13px] text-[#55517F]">{e.note}</p>
                ) : null}
              </div>
              <p className="amount font-bold text-[#55517F]">
                −{formatNaira(e.gross_amount)}
              </p>
            </div>
          ))}
        </>
      ) : null}
      <div
        className={`mt-2 flex items-center justify-between rounded-2xl border-2 px-4 py-4 ${profit >= 0 ? "border-[#10B981] bg-[#ECFDF5]" : "border-red-400 bg-red-50"}`}
      >
        <p
          className={`font-semibold ${profit >= 0 ? "text-[#065F46]" : "text-red-700"}`}
        >
          Your profit
        </p>
        <p
          className={`amount text-[24px] font-extrabold ${profit >= 0 ? "text-[#047857]" : "text-red-600"}`}
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
  value: number;
  Icon: LucideIcon;
  tone: "hero" | "amber" | "green";
};

const DRILL_TITLES: Record<NonNullable<DrillView>, string> = {
  sales: "Money from sales today",
  capital: "Money for restocking",
  profit: "Your profit today",
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
        <h1 className="page-title">Pocket Statement</h1>
        <p className="mt-3 text-[15px] text-[#55517F]">Loading your money…</p>
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
      label: "Money from sales",
      subtitle: null,
      subtitleClass: null,
      value: sales,
      Icon: Wallet,
      tone: "hero",
    },
    {
      key: "capital",
      label: "Money for restocking",
      subtitle: "Do not spend",
      subtitleClass: "text-[#9A5B00]",
      value: capital,
      Icon: Lock,
      tone: "amber",
    },
    {
      key: "profit",
      label: "Your profit",
      subtitle: "Yours to keep",
      subtitleClass: "text-[#047857]",
      value: profit,
      Icon: PiggyBank,
      tone: "green",
    },
  ];

  const TONES = {
    hero: {
      card: "bg-gradient-to-br from-[#2A1F7A] to-[#17104A] text-white border-transparent",
      icon: "bg-white/15 text-white",
      label: "text-white/85",
      amount: "text-white",
      chev: "text-white/70",
    },
    amber: {
      card: "bg-gradient-to-br from-[#FFF8E6] to-[#FFEFC4] border-[#F7DA95]",
      icon: "bg-[#F59E0B]/25 text-[#9A5B00]",
      label: "text-[#6B4300]",
      amount: "text-[#0F0A2E]",
      chev: "text-[#9A5B00]",
    },
    green: {
      card: "bg-gradient-to-br from-[#ECFDF5] to-[#D3F5E5] border-[#A7E8C9]",
      icon: "bg-[#10B981]/20 text-[#047857]",
      label: "text-[#065F46]",
      amount: "text-[#0F0A2E]",
      chev: "text-[#047857]",
    },
  } as const;

  return (
    <section className="flex min-h-full flex-col px-4 pb-28 pt-5">
      <h1 className="page-title">Pocket Statement</h1>
      <p className="page-sub mt-0.5">
        {formatHumanDate(today)}
      </p>
      <p className="mt-1 text-[14px] font-medium text-[#55517F]">
        {emptyDay
          ? "No sales marked yet today."
          : sales === 0 && expenses > 0
            ? "What you spent today."
            : "Your sales today."}
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {buckets.map(
          ({ key, label, subtitle, subtitleClass, value, Icon, tone }, i) => {
            const t = TONES[tone];
            return (
              <li
                key={label}
                className="anim-card"
                style={{ ["--i" as string]: i }}
              >
                <button
                  type="button"
                  onClick={() => setActiveView(key)}
                  className={`flex min-h-[88px] w-full items-center gap-3.5 rounded-[22px] border p-4 text-left shadow-[0_10px_24px_-14px_rgba(23,16,74,0.5)] transition-transform active:scale-[0.985] ${t.card}`}
                >
                  <span
                    className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${t.icon}`}
                  >
                    <Icon className="size-6" strokeWidth={2} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[14px] font-bold ${t.label}`}>
                      {label}
                    </span>
                    {subtitle ? (
                      <span
                        className={`block text-[12px] font-extrabold ${subtitleClass}`}
                      >
                        {subtitle}
                      </span>
                    ) : null}
                    <span
                      className={`mt-0.5 block text-[30px] font-extrabold leading-tight ${t.amount}`}
                    >
                      {value < 0 ? "−" : ""}
                      <CountUp
                        value={Math.abs(value)}
                        format={formatNaira}
                      />
                    </span>
                  </span>
                  <ChevronRight
                    className={`size-6 shrink-0 ${t.chev}`}
                    aria-hidden
                  />
                </button>
              </li>
            );
          },
        )}
      </ul>
      {expenses > 0 ? (
        <p className="mt-3 text-center text-[14px] font-medium text-[#55517F]">
          After {formatNaira(expenses)} you spent
        </p>
      ) : null}

      <ProductGrowth />

      {/* Drill-down slide panel (fixed overlay) */}
      <div
        className="anim-drill app-surface absolute inset-0 z-40 flex justify-center"
        style={{
          transform: activeView ? "translateX(0)" : "translateX(100%)",
          visibility: activeView ? "visible" : "hidden",
          transitionProperty: activeView ? "transform" : "transform, visibility",
        }}
        aria-hidden={!activeView}
      >
        <div className="flex h-full w-full max-w-md flex-col">
          <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-5">
            <button
              type="button"
              onClick={() => setActiveView(null)}
              className="icon-btn bg-white text-[#17104A] shadow-sm"
              aria-label="Back to Pocket Statement"
            >
              <ArrowLeft className="size-5" />
            </button>
            <h2 className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
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
