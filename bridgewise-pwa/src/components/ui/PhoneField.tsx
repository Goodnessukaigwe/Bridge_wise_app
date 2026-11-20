"use client";

import { ClipboardPaste, Contact, Keyboard, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useCustomers } from "@/lib/db/hooks";
import { canPickContacts, extractPhone, pickContact } from "@/lib/whatsapp";

function ChooseNumberSheet({
  onClose,
  onNumber,
  onCustomerName,
  onTypeIt,
  onPasteFailed,
}: {
  onClose: () => void;
  onNumber: (n: string) => void;
  onCustomerName?: (name: string) => void;
  onTypeIt: () => void;
  onPasteFailed: () => void;
}) {
  const titleId = useId();
  const customers = useCustomers();
  const [query, setQuery] = useState("");

  const saved = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 0803… must find 234803…, so ignore leading zeros.
    const digits = q.replace(/\D/g, "").replace(/^0+/, "");
    return (customers ?? [])
      .filter((c) => c.phone)
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          (digits && (c.phone ?? "").replace(/\D/g, "").includes(digits)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [customers, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Straight from the tap: clipboard reads need a user gesture.
  function onPaste() {
    const read = navigator.clipboard?.readText?.bind(navigator.clipboard);
    if (!read) return onPasteFailed();
    read()
      .then((text) => {
        const n = extractPhone(text);
        if (n) onNumber(n);
        else onPasteFailed();
      })
      .catch(onPasteFailed);
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-center">
      <div className="sheet-backdrop relative flex h-full w-full max-w-md items-end">
        <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="sheet-panel relative max-h-[90%] w-full overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        >
          <div className="sheet-grab" />
          <div className="mb-3 flex items-center justify-between">
            <h2 id={titleId} className="text-[20px] font-extrabold tracking-tight text-[#0F0A2E]">
              Choose a number
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="icon-btn bg-[#F1F0F8] text-[#3B3670]">
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <p className="text-[13px] font-bold text-[#3B3670]">Saved customers</p>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[#6B6898]" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or number"
              aria-label="Search saved customers"
              className="field pl-11"
            />
          </div>
          <ul className="mt-2 max-h-48 overflow-y-auto rounded-2xl border border-[#E6E3F5] bg-white">
            {saved.length === 0 ? (
              <li className="px-4 py-3 text-[14px] text-[#55517F]">
                {query ? "No one found." : "No saved customers with a number yet."}
              </li>
            ) : (
              saved.map((c) => (
                <li key={c.customer_id} className="border-b border-[#F0EEF9] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      onCustomerName?.(c.name);
                      onNumber(c.phone ?? "");
                    }}
                    className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left active:bg-[#F4F3FF]"
                  >
                    <span className="truncate text-[15px] font-bold text-[#0F0A2E]">{c.name}</span>
                    <span className="amount shrink-0 text-[14px] text-[#55517F]">{c.phone}</span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={onPaste} className="btn btn-primary">
              <ClipboardPaste className="size-5" aria-hidden />
              Paste a copied number
            </button>
            <p className="hint -mt-1">
              Open Contacts, hold the number, tap Copy, then come back and tap Paste.
            </p>
            <button type="button" onClick={onTypeIt} className="btn btn-quiet">
              <Keyboard className="size-5" aria-hidden />
              Type it in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Phone input with a contacts button that is always there.
 * - Chrome on Android: opens the phone's own contact list.
 * - Everywhere else (iPhone): a "Choose a number" sheet with saved customers,
 *   paste, or type it in.
 * Only the one chosen or pasted number is used, and it stays on this device.
 */
export function PhoneField({
  value,
  onChange,
  onContactName,
  onCustomerName,
  label = "Phone number (optional)",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Name from a picked phone contact; the parent decides whether to use it (e.g. only if empty). */
  onContactName?: (name: string) => void;
  /** Name of a saved customer chosen in the sheet. */
  onCustomerName?: (name: string) => void;
  label?: string;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [native, setNative] = useState(false);
  const [choices, setChoices] = useState<string[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tip, setTip] = useState<string | null>(null);

  useEffect(() => {
    setNative(canPickContacts());
  }, []);

  function focusInput() {
    setSheetOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }

  // Straight from the tap.
  function onIcon() {
    setTip(null);
    setChoices(null);
    if (!native) {
      setSheetOpen(true);
      return;
    }
    void pickContact().then((c) => {
      if (!c) return;
      if (c.name) onContactName?.(c.name);
      if (c.tels.length === 1) onChange(c.tels[0]);
      else if (c.tels.length > 1) setChoices(c.tels);
    });
  }

  return (
    <div>
      <label className="label">
        {label}
        <span className="relative mt-1 block">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setTip(null);
              onChange(e.target.value);
            }}
            inputMode="tel"
            autoComplete="tel"
            aria-label={ariaLabel}
            placeholder="0803 123 4567"
            className="field pr-14"
          />
          <button
            type="button"
            onClick={onIcon}
            aria-label="Choose a number from your contacts"
            className="icon-btn absolute right-0.5 top-1/2 -translate-y-1/2 text-[#17104A]"
          >
            <Contact className="size-6" aria-hidden />
          </button>
        </span>
      </label>
      {tip ? (
        <p className="hint mt-1 font-semibold" role="status">
          {tip}
        </p>
      ) : null}
      {choices ? (
        <ul className="mt-2 overflow-hidden rounded-2xl border border-[#E6E3F5] bg-white" aria-label="Choose a number">
          {choices.map((t) => (
            <li key={t} className="border-b border-[#F0EEF9] last:border-b-0">
              <button
                type="button"
                onClick={() => {
                  onChange(t);
                  setChoices(null);
                }}
                className="amount min-h-11 w-full px-4 text-left text-[15px] font-semibold text-[#0F0A2E] active:bg-[#F4F3FF]"
              >
                {t}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {sheetOpen ? (
        <ChooseNumberSheet
          onClose={() => setSheetOpen(false)}
          onNumber={(n) => {
            onChange(n);
            setSheetOpen(false);
          }}
          onCustomerName={onCustomerName}
          onTypeIt={focusInput}
          onPasteFailed={() => {
            focusInput();
            setTip("Hold the field and tap Paste");
          }}
        />
      ) : null}
    </div>
  );
}
