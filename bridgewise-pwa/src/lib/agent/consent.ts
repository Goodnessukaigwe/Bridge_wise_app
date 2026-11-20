const KEY = "onrecord_ai_consent_v1";

export function hasAiConsent(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function giveAiConsent(): void {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* if storage is blocked we simply ask again next time */
  }
}

export function withdrawAiConsent(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
