import { ToastProvider } from "@/components/shell/Toast";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto flex h-dvh min-h-dvh max-w-md flex-col overflow-hidden bg-[#F4F3FF] text-[#0F0A2E] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}
