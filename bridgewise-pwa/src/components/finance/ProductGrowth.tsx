"use client";

import { ArrowDown, ArrowUp, Crown, Minus, TrendingUp, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { EmptyState, PurseArt } from "@/components/ui/Illustrations";
import { todayDateKey } from "@/lib/db/dexie";
import { useOrders, useSaleEntries, useSkus } from "@/lib/db/hooks";
import {
  buildBars,
  buildSaleLines,
  compareProduct,
  compareTotal,
  periodWord,
  shortNaira,
  summarise,
  type Bar,
  type Period,
  type ProductRow,
  type Tone,
} from "@/lib/stats/productStats";

const PERIODS: { id: Period; label: string; hint: string }[] = [
  { id: "today", label: "Today", hint: "Today, compared with yesterday" },
  { id: "week", label: "This week", hint: "The last 7 days, compared with the 7 before" },
  { id: "month", label: "This month", hint: "The last 30 days, compared with the 30 before" },
];

function naira(n: number) {
  return `₦${Math.round(n).toLocaleString("en-NG")}`;
}

function toneClasses(tone: Tone) {
  return tone === "up"
    ? "text-[#047857]"
    : tone === "down"
      ? "text-[#C2410C]"
      : "text-[#55517F]";
}

function ToneIcon({ tone }: { tone: Tone }) {
  const cls = "size-4 shrink-0";
  if (tone === "up") return <ArrowUp className={`${cls} text-[#10B981]`} strokeWidth={3} aria-hidden />;
  if (tone === "down") return <ArrowDown className={`${cls} text-[#F97316]`} strokeWidth={3} aria-hidden />;
  return <Minus className={`${cls} text-[#8C88B0]`} strokeWidth={3} aria-hidden />;
}

function Compare({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[13px] font-bold ${toneClasses(tone)}`}>
      <ToneIcon tone={tone} />
      {text}
    </span>
  );
}

function Sparkline({ values, tone }: { values: number[]; tone: Tone }) {
  const w = 64;
  const h = 26;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? (w - 8) / (values.length - 1) : w - 8;
  const pts = values.map((v, i) => [4 + i * step, h - 3 - (v / max) * (h - 8)] as const);
  const color = tone === "down" ? "#F97316" : tone === "up" ? "#10B981" : "#17104A";
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" className="shrink-0 overflow-visible">
      <polyline
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last ? <circle cx={last[0]} cy={last[1]} r="3" fill={color} /> : null}
    </svg>
  );
}

function BarChart({ bars, label }: { bars: Bar[]; label: string }) {
  const W = 320;
  const H = 188;
  const top = 26;
  const bottom = 30;
  const plotH = H - top - bottom;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const slot = W / bars.length;
  const barW = Math.min(34, slot * 0.62);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
      <line x1="0" x2={W} y1={H - bottom} y2={H - bottom} stroke="#DAD7EE" strokeWidth="1.5" />
      {bars.map((b, i) => {
        const h = b.value > 0 ? Math.max(4, (b.value / max) * plotH) : 0;
        const x = i * slot + (slot - barW) / 2;
        const y = H - bottom - h;
        return (
          <g key={i}>
            {h > 0 ? (
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx="7"
                fill={b.highlight ? "#F59E0B" : "#17104A"}
                className="anim-bar"
                style={{ animationDelay: `${i * 40}ms` }}
              />
            ) : (
              <rect x={x} y={H - bottom - 3} width={barW} height="3" rx="1.5" fill="#DAD7EE" />
            )}
            {b.value > 0 ? (
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="12.5" fontWeight="700" fill="#0F0A2E">
                {shortNaira(b.value)}
              </text>
            ) : null}
            <text
              x={x + barW / 2}
              y={H - 9}
              textAnchor="middle"
              fontSize="13"
              fontWeight={b.highlight ? 800 : 600}
              fill={b.highlight ? "#0F0A2E" : "#55517F"}
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ProductDetail({
  row,
  period,
  lines,
  stockLeft,
  onClose,
}: {
  row: ProductRow;
  period: Period;
  lines: ReturnType<typeof buildSaleLines>;
  stockLeft: number | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const today = todayDateKey();
  const mine = useMemo(
    () => lines.filter((l) => l.productId === row.productId),
    [lines, row.productId],
  );
  const bars = useMemo(() => buildBars(mine, period, today), [mine, period, today]);
  const cmp = compareProduct(row.units, row.prevUnits, period);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-center">
      <div className="sheet-backdrop relative flex h-full w-full max-w-md items-end">
        <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="sheet-panel relative max-h-[90%] w-full overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        >
          <div className="sheet-grab" />
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
                {row.name}
              </h2>
              <Compare tone={cmp.tone} text={cmp.text} />
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="icon-btn shrink-0 bg-[#F1F0F8] text-[#3B3670]"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl bg-[#F4F3FF] px-3 py-2.5">
              <dt className="text-[12px] font-bold text-[#55517F]">Sold</dt>
              <dd className="amount text-[20px] font-extrabold text-[#0F0A2E]">{row.units}</dd>
            </div>
            <div className="rounded-2xl bg-[#F4F3FF] px-3 py-2.5">
              <dt className="text-[12px] font-bold text-[#55517F]">Stock left</dt>
              <dd className="amount text-[20px] font-extrabold text-[#0F0A2E]">
                {stockLeft ?? "—"}
              </dd>
            </div>
            <div className="rounded-2xl bg-[#F4F3FF] px-3 py-2.5">
              <dt className="text-[12px] font-bold text-[#55517F]">Money made</dt>
              <dd className="amount text-[18px] font-extrabold text-[#17104A]">{naira(row.revenue)}</dd>
            </div>
            <div className="rounded-2xl bg-[#E4F8EE] px-3 py-2.5">
              <dt className="text-[12px] font-bold text-[#065F46]">Profit made</dt>
              <dd className="amount text-[18px] font-extrabold text-[#065F46]">{naira(row.profit)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[14px] font-bold text-[#0F0A2E]">
            Sales over time{" "}
            <span className="font-medium text-[#55517F]">
              ({period === "month" ? "last 30 days" : "last 7 days"})
            </span>
          </p>
          <BarChart bars={bars} label={`Sales of ${row.name} over time`} />
        </div>
      </div>
    </div>
  );
}

export function ProductGrowth() {
  const entries = useSaleEntries();
  const orders = useOrders();
  const skus = useSkus();
  const [period, setPeriod] = useState<Period>("week");
  const [openId, setOpenId] = useState<string | null>(null);

  const today = todayDateKey();
  const lines = useMemo(
    () => (entries && orders ? buildSaleLines(entries, orders) : []),
    [entries, orders],
  );
  const summary = useMemo(() => summarise(lines, period, today), [lines, period, today]);

  if (entries === undefined || orders === undefined) return null;

  const hint = PERIODS.find((p) => p.id === period)?.hint ?? "";
  const total = compareTotal(summary.revenue, summary.prevRevenue, period);
  const openRow = summary.rows.find((r) => r.productId === openId) ?? null;
  const openSku = openRow ? skus?.find((s) => s.sku_id === openRow.productId) : undefined;

  return (
    <section className="mt-8" aria-labelledby="growth-title">
      <h2 id="growth-title" className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
        How your products are doing
      </h2>

      {lines.length === 0 ? (
        <EmptyState
          art={<PurseArt className="w-full" />}
          title="Nothing to show yet"
          body="Confirm your first sale to see how your products are doing."
        />
      ) : (
        <>
          <div role="tablist" aria-label="Time period" className="mt-3 flex gap-1 rounded-2xl bg-[#E9E7F7] p-1">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={period === p.id}
                onClick={() => setPeriod(p.id)}
                className={`min-h-11 flex-1 rounded-xl px-1 text-[14px] font-bold transition-colors active:scale-[0.97] ${
                  period === p.id ? "bg-white text-[#17104A] shadow-sm" : "text-[#55517F]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[13px] text-[#55517F]">{hint}</p>

          {summary.rows.length === 0 ? (
            <div className="card mt-4 px-4 py-6 text-center">
              <p className="text-[16px] font-bold text-[#0F0A2E]">No sales in this time yet</p>
              <p className="mt-1 text-[14px] text-[#55517F]">
                {summary.prevRevenue > 0
                  ? `You sold ${naira(summary.prevRevenue)} ${periodWord(period)}.`
                  : "Try another time, or mark an order as sold."}
              </p>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {summary.bestSeller ? (
                  <div className="anim-card rounded-2xl bg-gradient-to-b from-[#FFF3D1] to-[#FFE9B0] p-3.5">
                    <p className="flex items-center gap-1 text-[12px] font-extrabold text-[#7A4300]">
                      <Crown className="size-4" aria-hidden /> Best seller
                    </p>
                    <p className="mt-1 truncate text-[16px] font-extrabold text-[#0F0A2E]">
                      {summary.bestSeller.name}
                    </p>
                    <p className="text-[13px] font-semibold text-[#7A4300]">
                      {summary.bestSeller.units} sold
                    </p>
                  </div>
                ) : null}
                {summary.topProfit ? (
                  <div className="anim-card rounded-2xl bg-gradient-to-b from-[#DDF7EA] to-[#C4F0DC] p-3.5" style={{ ["--i" as string]: 1 }}>
                    <p className="flex items-center gap-1 text-[12px] font-extrabold text-[#065F46]">
                      <TrendingUp className="size-4" aria-hidden /> Most profit
                    </p>
                    <p className="mt-1 truncate text-[16px] font-extrabold text-[#0F0A2E]">
                      {summary.topProfit.name}
                    </p>
                    <p className="amount text-[13px] font-semibold text-[#065F46]">
                      {naira(summary.topProfit.profit)} made
                    </p>
                  </div>
                ) : null}
              </div>

              <div className="card mt-3 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[14px] font-bold text-[#0F0A2E]">Total sales</p>
                  <p className="amount text-[20px] font-extrabold text-[#17104A]">{naira(summary.revenue)}</p>
                </div>
                <div className="mt-0.5">
                  <Compare tone={total.tone} text={total.text} />
                </div>
                <div className="mt-2">
                  <BarChart
                    bars={summary.bars}
                    label={`Total sales over time: ${naira(summary.revenue)}`}
                  />
                </div>
              </div>

              <ul className="mt-3 flex flex-col gap-2.5">
                {summary.rows.map((row, i) => {
                  const cmp = compareProduct(row.units, row.prevUnits, period);
                  return (
                    <li key={row.productId} className="anim-card" style={{ ["--i" as string]: Math.min(i, 8) }}>
                      <button
                        type="button"
                        onClick={() => setOpenId(row.productId)}
                        className="card flex w-full items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.985]"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#ECE9FB] text-[14px] font-extrabold text-[#17104A]">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[16px] font-bold text-[#0F0A2E]">{row.name}</span>
                          <span className="block text-[13px] text-[#55517F]">
                            {row.units} sold ·{" "}
                            <span className="amount font-semibold text-[#0F0A2E]">{naira(row.revenue)}</span>
                          </span>
                          <span className="amount block text-[13px] font-semibold text-[#065F46]">
                            {naira(row.profit)} profit
                          </span>
                          <Compare tone={cmp.tone} text={cmp.text} />
                        </span>
                        <Sparkline values={row.trend} tone={cmp.tone} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {openRow ? (
        <ProductDetail
          row={openRow}
          period={period}
          lines={lines}
          stockLeft={openSku ? openSku.stock_qty : null}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </section>
  );
}
