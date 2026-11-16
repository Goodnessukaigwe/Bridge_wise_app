"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { captureChatText } from "@/lib/ai/captureText";

function sharedRawText(): string {
  const params = new URLSearchParams(window.location.search);
  const text = params.get("text")?.trim() ?? "";
  if (text) return text;
  return [params.get("title"), params.get("url")]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

export default function ShareTargetPage() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const raw = sharedRawText();
    if (!raw) {
      router.replace("/");
      return;
    }

    void captureChatText({
      raw_text: raw,
      capture_method: "whatsapp_share_sheet",
    }).finally(() => {
      router.replace("/");
    });
  }, [router]);

  return (
    <p className="px-4 py-10 text-center text-sm text-neutral-600">
      Saving shared chat…
    </p>
  );
}
