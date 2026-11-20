/** Vendor business details for receipts. Device-only (localStorage), no schema change. */

const KEY = "onrecord_business";

export type Business = {
  name: string;
  phone: string;
  /** PNG data URL, about 256px on its longest side. */
  logo?: string;
  logoW?: number;
  logoH?: number;
};

export function loadBusiness(): Business | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const b = JSON.parse(raw) as Partial<Business>;
    if (!b || typeof b.name !== "string" || !b.name.trim()) return null;
    return {
      name: b.name,
      phone: typeof b.phone === "string" ? b.phone : "",
      logo: typeof b.logo === "string" ? b.logo : undefined,
      logoW: b.logoW,
      logoH: b.logoH,
    };
  } catch {
    return null;
  }
}

export function saveBusiness(b: Business): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(b));
    return true;
  } catch {
    return false;
  }
}

/** Resize an image file so its longest side is about 256px. Returns a PNG data URL. */
export async function resizeLogo(
  file: File,
): Promise<{ dataUrl: string; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { dataUrl: canvas.toDataURL("image/png"), w, h };
}
