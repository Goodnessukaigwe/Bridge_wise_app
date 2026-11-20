/** Small inline-SVG illustrations for empty states. No network, no libraries. */

export function InboxArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true">
      <ellipse cx="80" cy="108" rx="52" ry="7" fill="#17104A" opacity="0.08" />
      <rect x="22" y="40" width="116" height="62" rx="16" fill="#E6E3FA" />
      <path d="M22 70h38l6 12h28l6-12h38v20a14 14 0 0 1-14 14H36a14 14 0 0 1-14-14z" fill="#fff" stroke="#17104A" strokeWidth="3" strokeLinejoin="round" />
      <rect x="44" y="18" width="72" height="44" rx="10" fill="#fff" stroke="#17104A" strokeWidth="3" />
      <path d="M56 32h48M56 42h30" stroke="#C9C4EC" strokeWidth="5" strokeLinecap="round" />
      <circle cx="122" cy="26" r="13" fill="#F59E0B" />
      <path d="M116 26l4 4 7-8" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShelfArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true">
      <ellipse cx="80" cy="110" rx="56" ry="6" fill="#17104A" opacity="0.08" />
      <rect x="18" y="86" width="124" height="9" rx="4.5" fill="#17104A" />
      <rect x="28" y="95" width="8" height="14" rx="3" fill="#17104A" opacity="0.6" />
      <rect x="124" y="95" width="8" height="14" rx="3" fill="#17104A" opacity="0.6" />
      <rect x="30" y="52" width="38" height="34" rx="6" fill="#F59E0B" />
      <path d="M30 62h38" stroke="#fff" strokeWidth="3" opacity="0.8" />
      <rect x="74" y="40" width="30" height="46" rx="6" fill="#10B981" />
      <path d="M82 40V30h14v10" fill="#10B981" />
      <rect x="110" y="60" width="26" height="26" rx="6" fill="#E6E3FA" stroke="#17104A" strokeWidth="3" />
      <path d="M116 68h14" stroke="#17104A" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function PurseArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 120" className={className} aria-hidden="true">
      <ellipse cx="80" cy="110" rx="50" ry="6" fill="#17104A" opacity="0.08" />
      <path d="M52 44c0-16 12-26 28-26s28 10 28 26" fill="none" stroke="#17104A" strokeWidth="5" strokeLinecap="round" />
      <rect x="30" y="42" width="100" height="62" rx="20" fill="#17104A" />
      <rect x="30" y="42" width="100" height="62" rx="20" fill="url(#pg)" />
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3A2D96" />
          <stop offset="1" stopColor="#17104A" />
        </linearGradient>
      </defs>
      <rect x="92" y="62" width="44" height="26" rx="13" fill="#F59E0B" />
      <circle cx="108" cy="75" r="4.5" fill="#fff" />
      <text x="56" y="82" fontSize="26" fontWeight="800" fill="#fff" textAnchor="middle">₦</text>
    </svg>
  );
}

export function EmptyState({
  art,
  title,
  body,
}: {
  art: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="anim-card mt-8 flex flex-col items-center px-4 text-center">
      <div className="anim-float w-40">{art}</div>
      <p className="mt-4 text-[19px] font-bold leading-snug text-[#0F0A2E]">{title}</p>
      <p className="mt-1.5 max-w-xs text-[15px] leading-relaxed text-[#55517F]">{body}</p>
    </div>
  );
}
