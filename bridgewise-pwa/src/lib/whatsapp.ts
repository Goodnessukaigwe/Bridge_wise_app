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
  ) => Promise<{ name?: string[]; tel?: string[] }[]>;
};

/** Contact Picker API: Chrome on Android over HTTPS only. */
export function canPickContacts(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "contacts" in navigator &&
    typeof (navigator as unknown as { contacts?: ContactsApi }).contacts
      ?.select === "function"
  );
}

export type PickedContact = { name: string; tels: string[] };

/**
 * Must be called straight from a tap. Reads only the one contact the vendor
 * chooses (name and number); nothing is uploaded or stored by this call.
 * Returns null on cancel or any error: never throws, never shows errors.
 */
export async function pickContact(): Promise<PickedContact | null> {
  if (!canPickContacts()) return null;
  const api = (navigator as unknown as { contacts: ContactsApi }).contacts;
  try {
    const picked = await api.select(["name", "tel"], { multiple: false });
    const c = picked[0];
    if (!c) return null;
    const tels = [
      ...new Set((c.tel ?? []).map((t) => t.trim()).filter(Boolean)),
    ];
    return { name: c.name?.[0]?.trim() ?? "", tels };
  } catch {
    return null;
  }
}

/** Opens a link from a tap. Falls back to navigating if the popup is blocked. */
export function openLink(url: string): void {
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) window.location.href = url;
}
