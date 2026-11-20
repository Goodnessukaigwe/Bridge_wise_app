import { Splash } from "@/components/shell/Splash";
import { ToastProvider } from "@/components/shell/Toast";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-surface relative mx-auto flex h-dvh min-h-dvh max-w-md flex-col overflow-hidden text-[#0F0A2E] shadow-[0_0_60px_-10px_rgba(23,16,74,0.35)] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <ToastProvider>{children}</ToastProvider>
      <Splash />
    </div>
  );
}
