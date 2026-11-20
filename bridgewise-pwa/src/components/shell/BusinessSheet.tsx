"use client";

import { ImagePlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  loadBusiness,
  resizeLogo,
  saveBusiness,
  type Business,
} from "@/lib/business";

/** The form on its own, so the receipt sheet can show it the first time. */
export function BusinessForm({
  initial,
  submitLabel = "Save",
  onSaved,
}: {
  initial: Business | null;
  submitLabel?: string;
  onSaved: (b: Business) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [logo, setLogo] = useState<Pick<Business, "logo" | "logoW" | "logoH">>({
    logo: initial?.logo,
    logoW: initial?.logoW,
    logoH: initial?.logoH,
  });
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const r = await resizeLogo(file);
      setLogo({ logo: r.dataUrl, logoW: r.w, logoH: r.h });
      setError(null);
    } catch {
      setError("We could not use that picture. Try another one.");
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please type your business name");
      return;
    }
    const b: Business = { name: name.trim(), phone: phone.trim(), ...logo };
    if (!saveBusiness(b)) {
      setError("Could not save on this phone. Please try again.");
      return;
    }
    onSaved(b);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="label">
        Business name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field mt-1"
          autoComplete="organization"
          placeholder="Chioma’s Closet"
        />
      </label>
      <label className="label">
        Business phone (optional)
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="field mt-1"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0803 123 4567"
        />
      </label>
      <div>
        <p className="label">Logo (optional)</p>
        <div className="mt-1 flex items-center gap-3">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#17104A]">
            {logo.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.logo} alt="Your logo" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="px-1 text-center text-[11px] font-bold leading-tight text-white">
                {name.trim() || "Your name"}
              </span>
            )}
          </div>
          <label className="btn btn-quiet cursor-pointer">
            <ImagePlus className="size-5" aria-hidden />
            {logo.logo ? "Change logo" : "Add logo"}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
          {logo.logo ? (
            <button
              type="button"
              onClick={() => setLogo({})}
              className="min-h-11 px-2 text-[14px] font-bold text-[#55517F] underline"
            >
              Remove
            </button>
          ) : null}
        </div>
        <p className="hint mt-1">Without a logo, your business name is shown instead.</p>
      </div>
      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-[14px] font-semibold text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary mt-1 min-h-[54px]">
        {submitLabel}
      </button>
    </form>
  );
}

export function BusinessSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [initial] = useState(() => loadBusiness());

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[55] flex justify-center">
      <div className="sheet-backdrop relative flex h-full w-full max-w-md items-end">
        <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="sheet-panel relative max-h-[90%] w-full overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        >
          <div className="sheet-grab" />
          <div className="mb-1 flex items-center justify-between">
            <h2 id={titleId} className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
              Your business details
            </h2>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="icon-btn bg-[#F1F0F8] text-[#3B3670]">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <p className="mb-4 text-[15px] text-[#55517F]">
            These appear at the top of the receipts you send. They stay on this phone.
          </p>
          <BusinessForm initial={initial} onSaved={onClose} />
        </div>
      </div>
    </div>
  );
}
