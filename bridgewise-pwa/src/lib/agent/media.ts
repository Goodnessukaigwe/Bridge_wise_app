/**
 * Attachments for the assistant. Everything is shrunk on the phone before it
 * is sent, so a request stays well under Vercel's 4.5 MB body limit.
 */

export const IMAGE_MAX_SIDE = 1280;
export const IMAGE_QUALITY = 0.7;
export const THUMB_SIDE = 96;
export const AUDIO_RATE = 16_000;
export const MAX_RECORD_SECONDS = 60;
export const MAX_IMAGES = 3;
/** Body budget for the whole request, in characters of JSON. Server limit is 4 MB. */
export const MAX_BODY_CHARS = 3_700_000;

export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

/** 16-bit PCM mono WAV, the one format every Gemini audio path accepts. */
export function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export type Picked = {
  /** Sent to the model. */
  wire: { mime: string; data: string };
  /** Kept in the chat. Small. */
  thumb: string;
};

async function drawn(file: Blob, max: number, quality: number): Promise<{ dataUrl: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { w, h } = fitWithin(bitmap.width, bitmap.height, max);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#fff"; // JPEG has no transparency
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { dataUrl: canvas.toDataURL("image/jpeg", quality) };
}

/** Longest side about 1280px, JPEG about 0.7, plus a tiny thumbnail for the chat. */
export async function prepareImage(file: Blob): Promise<Picked> {
  const [full, thumb] = await Promise.all([
    drawn(file, IMAGE_MAX_SIDE, IMAGE_QUALITY),
    drawn(file, THUMB_SIDE, 0.6),
  ]);
  return {
    wire: { mime: "image/jpeg", data: full.dataUrl.split(",")[1] ?? "" },
    thumb: thumb.dataUrl,
  };
}

type AudioCtxCtor = typeof AudioContext;
type OfflineCtor = typeof OfflineAudioContext;

/**
 * Decode whatever the browser recorded (webm/opus on Android Chrome, mp4/aac
 * on iPhone Safari) and re-encode as 16 kHz mono WAV, which Gemini accepts.
 */
export async function toWav16k(
  blob: Blob,
): Promise<{ mime: "audio/wav"; data: string; seconds: number }> {
  const w = window as unknown as {
    AudioContext?: AudioCtxCtor;
    webkitAudioContext?: AudioCtxCtor;
    OfflineAudioContext?: OfflineCtor;
    webkitOfflineAudioContext?: OfflineCtor;
  };
  const Ctx = w.AudioContext ?? w.webkitAudioContext;
  const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctx || !Offline) throw new Error("no audio");

  const bytes = await blob.arrayBuffer();
  const ctx = new Ctx();
  try {
    // Callback form as well: older Safari has no promise version.
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
      p?.catch?.(reject);
    });
    const seconds = Math.min(decoded.duration, MAX_RECORD_SECONDS);
    const off = new Offline(1, Math.max(1, Math.ceil(seconds * AUDIO_RATE)), AUDIO_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    const wav = encodeWav(rendered.getChannelData(0), AUDIO_RATE);
    return { mime: "audio/wav", data: bytesToBase64(wav), seconds };
  } finally {
    void ctx.close?.();
  }
}

/** Best container this browser can record. Chrome gives webm/opus, Safari gives mp4. */
export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return options.find((m) => MediaRecorder.isTypeSupported(m));
}

export type Recording = {
  stop: () => Promise<Blob>;
  cancel: () => void;
};

/** Starts the microphone. Rejects if the vendor says no. */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const mime = pickRecorderMime();
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  rec.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          release();
          resolve(new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" }));
        };
        if (rec.state !== "inactive") rec.stop();
        else rec.onstop?.(new Event("stop"));
      }),
    cancel: () => {
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      release();
    },
  };
}
