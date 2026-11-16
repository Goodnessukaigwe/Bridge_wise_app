"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "busy" | "error";

type ToastApi = {
  showToast: (kind: ToastKind, text: string) => void;
  hideToast: () => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const ERROR_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ kind: ToastKind; text: string } | null>(
    null,
  );
  const timerRef = useRef<number | null>(null);

  const hideToast = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (kind: ToastKind, text: string) => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setToast({ kind, text });
      if (kind === "error") {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          setToast(null);
        }, ERROR_MS);
      }
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast ? (
        <div
          className="pointer-events-none absolute inset-x-0 top-14 z-[60] flex justify-center px-4"
          aria-live={toast.kind === "error" ? "assertive" : "polite"}
        >
          <p
            role={toast.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto max-w-sm rounded-lg border px-3 py-2 text-sm font-medium shadow-md ${
              toast.kind === "error"
                ? "border-red-300 bg-red-50 text-red-950"
                : "border-amber-300 bg-amber-50 text-amber-950"
            }`}
          >
            {toast.text}
          </p>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
