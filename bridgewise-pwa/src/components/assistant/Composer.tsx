"use client";

import { Camera, ClipboardPaste, Image as ImageIcon, Mic, Paperclip, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  MAX_IMAGES,
  MAX_RECORD_SECONDS,
  prepareImage,
  startRecording,
  toWav16k,
  type Picked,
  type Recording,
} from "@/lib/agent/media";
import type { SendInput } from "@/components/assistant/useAssistant";

type Props = {
  busy: boolean;
  online: boolean;
  /** Files handed in by Share Target (images, audio) and shared text. */
  incoming?: { text?: string; files?: File[]; token: number } | null;
  onSend: (input: SendInput) => void;
  onStop: () => void;
  onSaveDraft: (text: string) => Promise<{ ok: boolean; message?: string }>;
  onNotice: (text: string) => void;
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Composer({ busy, online, incoming, onSend, onStop, onSaveDraft, onNotice }: Props) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<Picked[]>([]);
  const [menu, setMenu] = useState(false);
  const [rec, setRec] = useState<{ seconds: number } | null>(null);
  const [working, setWorking] = useState(false);
  const recRef = useRef<Recording | null>(null);
  const timer = useRef<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
    recRef.current?.cancel();
  }, []);

  async function addFiles(files: File[]) {
    const pics = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX_IMAGES - images.length);
    if (pics.length === 0) return;
    setWorking(true);
    try {
      const done = await Promise.all(pics.map((f) => prepareImage(f)));
      setImages((cur) => [...cur, ...done].slice(0, MAX_IMAGES));
    } catch {
      onNotice("We could not read that photo. Try another one.");
    } finally {
      setWorking(false);
    }
  }

  // Share Target hand-over: text goes in the box, images are attached, audio is sent.
  const lastToken = useRef(0);
  useEffect(() => {
    if (!incoming || incoming.token === lastToken.current) return;
    lastToken.current = incoming.token;
    if (incoming.text) setText((t) => (t ? `${t}\n${incoming.text}` : incoming.text!));
    const files = incoming.files ?? [];
    void addFiles(files);
    const audio = files.find((f) => f.type.startsWith("audio/"));
    if (audio) void sendAudioBlob(audio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  async function sendAudioBlob(blob: Blob) {
    setWorking(true);
    try {
      const wav = await toWav16k(blob);
      if (wav.seconds < 0.5) {
        onNotice("That was too short. Hold on and speak again.");
        return;
      }
      onSend({ text: text.trim(), audio: { mime: wav.mime, data: wav.data } });
      setText("");
    } catch {
      onNotice("We could not read that voice note. Please type it instead.");
    } finally {
      setWorking(false);
    }
  }

  async function startMic() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onNotice("Voice notes do not work on this phone. Please type it instead.");
      return;
    }
    try {
      recRef.current = await startRecording();
    } catch {
      onNotice("We could not use the microphone. Check your phone's permission, or type instead.");
      return;
    }
    setRec({ seconds: 0 });
    timer.current = window.setInterval(() => {
      setRec((r) => {
        if (!r) return r;
        const seconds = r.seconds + 1;
        if (seconds >= MAX_RECORD_SECONDS) void finishRecording();
        return { seconds };
      });
    }, 1000);
  }

  function clearTimer() {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  }

  async function finishRecording() {
    const r = recRef.current;
    if (!r) return;
    recRef.current = null;
    clearTimer();
    setRec(null);
    const blob = await r.stop();
    await sendAudioBlob(blob);
  }

  function cancelRecording() {
    recRef.current?.cancel();
    recRef.current = null;
    clearTimer();
    setRec(null);
  }

  async function paste() {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip.trim()) {
        onNotice("Nothing copied yet.");
        return;
      }
      setText((t) => (t ? `${t}\n${clip}` : clip));
      area.current?.focus();
    } catch {
      onNotice("Your phone would not let us read it. Press and hold in the box, then tap Paste.");
      area.current?.focus();
    }
  }

  const canSend = (text.trim().length > 0 || images.length > 0) && !working;

  function submit() {
    if (!canSend || busy) return;
    if (!online) {
      void (async () => {
        const r = await onSaveDraft(text);
        if (r.ok) {
          setText("");
          setImages([]);
          onNotice("Saved as a draft. Open Orders to see it.");
        } else onNotice(r.message ?? "Could not save.");
      })();
      return;
    }
    onSend({ text, images });
    setText("");
    setImages([]);
  }

  if (rec) {
    return (
      <div className="flex items-center gap-3 border-t border-[#E7E4F5] bg-white px-3 py-3" role="status">
        <button type="button" onClick={cancelRecording} className="icon-btn bg-[#F1F0F8] text-[#3B3670]" aria-label="Cancel recording">
          <X className="size-5" aria-hidden />
        </button>
        <span className="size-3 animate-pulse rounded-full bg-red-600" aria-hidden />
        <p className="flex-1 text-[16px] font-bold text-[#0F0A2E]">
          Recording {clock(rec.seconds)} <span className="font-medium text-[#8F8BB3]">/ {clock(MAX_RECORD_SECONDS)}</span>
        </p>
        <button type="button" onClick={() => void finishRecording()} className="icon-btn bg-[#F59E0B] text-white" aria-label="Stop and send">
          <Square className="size-5 fill-current" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-[#E7E4F5] bg-white px-3 pb-3 pt-2">
      {images.length > 0 ? (
        <div className="mb-2 flex gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.thumb} alt="Attached photo" className="size-14 rounded-xl object-cover" />
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-[#17104A] text-white"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="relative flex items-end gap-1.5">
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            disabled={images.length >= MAX_IMAGES}
            className="icon-btn bg-[#F1F0F8] text-[#3B3670]"
            aria-label="Attach a photo"
            aria-expanded={menu}
          >
            <Paperclip className="size-5" aria-hidden />
          </button>
          {menu ? (
            <div className="absolute bottom-12 left-0 z-10 w-48 rounded-2xl border border-[#DAD7EE] bg-white p-1 shadow-lg">
              <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-[15px] font-semibold text-[#17104A] active:bg-[#F1F0F8]"
                onClick={() => { setMenu(false); camera.current?.click(); }}>
                <Camera className="size-5" aria-hidden /> Take a photo
              </button>
              <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-[15px] font-semibold text-[#17104A] active:bg-[#F1F0F8]"
                onClick={() => { setMenu(false); gallery.current?.click(); }}>
                <ImageIcon className="size-5" aria-hidden /> From gallery
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" onClick={() => void paste()} className="icon-btn bg-[#F1F0F8] text-[#3B3670]" aria-label="Paste what I copied">
          <ClipboardPaste className="size-5" aria-hidden />
        </button>
        <textarea
          ref={area}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          placeholder={online ? "Type, paste a chat, or tap the mic" : "Offline: type and save as a draft"}
          className="field min-h-11 flex-1 resize-none py-2.5 text-[16px]"
          aria-label="Message"
        />
        {text.trim() || images.length ? (
          busy ? (
            <button type="button" onClick={onStop} className="icon-btn bg-[#17104A] text-white" aria-label="Stop">
              <Square className="size-5 fill-current" aria-hidden />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={!canSend} className="icon-btn bg-[#F59E0B] text-white" aria-label={online ? "Send" : "Save as draft"}>
              <Send className="size-5" aria-hidden />
            </button>
          )
        ) : (
          <button type="button" onClick={() => void startMic()} disabled={busy || working || !online} className="icon-btn bg-[#F59E0B] text-white" aria-label="Record a voice note">
            <Mic className="size-5" aria-hidden />
          </button>
        )}
      </div>
      {!online && text.trim() ? (
        <p className="mt-1.5 text-[13px] font-semibold text-[#9A5B0B]">Tap send to keep this as a draft until you are back online.</p>
      ) : null}
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </div>
  );
}
