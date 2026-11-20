/**
 * Normalise a phone number to international digits only (no plus), or null
 * when it does not look like a real number. Never throws; an invalid number is
 * simply treated as missing so the vendor is never blocked.
 *
 * 0803 123 4567 -> 2348031234567 · +234 803 123 4567 -> 2348031234567
 */
export function normalisePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) {
    digits = `234${digits.slice(1)}`;
  } else if (digits.length === 10 && /^[789]/.test(digits)) {
    digits = `234${digits}`;
  }
  if (digits.startsWith("234") && digits.length !== 13) return null;
  if (digits.startsWith("0")) return null;
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

export function whatsappUrl(text: string, phone?: string | null): string {
  const to = normalisePhone(phone);
  return `https://wa.me/${to ?? ""}?text=${encodeURIComponent(text)}`;
}

type ContactsApi = {
  select: (
    props: string[],
    opts?: { multiple?: boolean },
  ) => Promise<{ tel?: string[] }[]>;
};

export function canPickContacts(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    typeof (navigator as unknown as { contacts?: ContactsApi }).contacts
      ?.select === "function"
  );
}

/** Returns the first phone number of the chosen contact, or null. */
export async function pickContactPhone(): Promise<string | null> {
  if (!canPickContacts()) return null;
  const api = (navigator as unknown as { contacts: ContactsApi }).contacts;
  try {
    const picked = await api.select(["tel"], { multiple: false });
    return picked[0]?.tel?.[0] ?? null;
  } catch {
    return null;
  }
}
