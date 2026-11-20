"use client";

import { Contact } from "lucide-react";
import { useEffect, useState } from "react";
import { canPickContacts, pickContact } from "@/lib/whatsapp";

/**
 * Phone input with an optional contacts button. The button only exists where
 * the Contact Picker API does (Chrome on Android over HTTPS); elsewhere the
 * vendor just types. No errors are shown when it is unavailable.
 */
export function PhoneField({
  value,
  onChange,
  onContactName,
  label = "Phone number (optional)",
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Called with the chosen contact's name; the parent decides whether to use it. */
  onContactName?: (name: string) => void;
  label?: string;
  ariaLabel?: string;
}) {
  const [canPick, setCanPick] = useState(false);
  const [choices, setChoices] = useState<string[] | null>(null);

  useEffect(() => {
    setCanPick(canPickContacts());
  }, []);

  // Straight from the tap: the picker needs a user gesture.
  function onPick() {
    setChoices(null);
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
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            aria-label={ariaLabel}
            placeholder="0803 123 4567"
            className={`field ${canPick ? "pr-14" : ""}`}
          />
          {canPick ? (
            <button
              type="button"
              onClick={onPick}
              aria-label="Choose from your contacts"
              className="icon-btn absolute right-0.5 top-1/2 -translate-y-1/2 text-[#17104A]"
            >
              <Contact className="size-6" aria-hidden />
            </button>
          ) : null}
        </span>
      </label>
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
    </div>
  );
}
