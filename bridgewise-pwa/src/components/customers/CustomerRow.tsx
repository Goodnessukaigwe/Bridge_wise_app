import { formatPhoneDisplay } from "@/lib/whatsapp";
import { formatShortDate, type CustomerSummary } from "@/lib/db/customerSearch";

const TINTS = [
  "bg-[#E6E3FA] text-[#17104A]",
  "bg-[#FEF0C7] text-[#7A4300]",
  "bg-[#D3F5E5] text-[#065F46]",
  "bg-[#FFE6D2] text-[#9A3412]",
];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "md" | "lg";
}) {
  const tint = TINTS[[...name].reduce((s, ch) => s + ch.charCodeAt(0), 0) % TINTS.length];
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold ${tint} ${
        size === "lg" ? "size-16 text-[22px]" : "size-11 text-[15px]"
      }`}
    >
      {initials(name)}
    </span>
  );
}

export function CustomerRow({
  summary,
  index = 0,
  onOpen,
}: {
  summary: CustomerSummary;
  index?: number;
  onOpen: (customerId: string) => void;
}) {
  const { customer, orders, lastDate } = summary;
  return (
    <li className="anim-card" style={{ ["--i" as string]: Math.min(index, 8) }}>
      <button
        type="button"
        onClick={() => onOpen(customer.customer_id)}
        className="flex min-h-[64px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-[#F4F3FF]"
      >
        <Avatar name={customer.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold text-[#0F0A2E]">
            {customer.name}
          </span>
          <span className="amount block truncate text-[14px] text-[#55517F]">
            {customer.phone ? formatPhoneDisplay(customer.phone) : "No phone number yet"}
          </span>
          <span className="block truncate text-[12.5px] text-[#6B6898]">
            {orders} order{orders !== 1 ? "s" : ""}
            {lastDate ? ` · Last order ${formatShortDate(lastDate)}` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}
