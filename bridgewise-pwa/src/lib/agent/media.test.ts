import { describe, expect, it } from "vitest";
import { bytesToBase64, encodeWav, fitWithin } from "@/lib/agent/media";

describe("media helpers", () => {
  it("fits the longest side to 1280 and never enlarges", () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 });
    expect(fitWithin(3000, 4000, 1280)).toEqual({ w: 960, h: 1280 });
    expect(fitWithin(800, 600, 1280)).toEqual({ w: 800, h: 600 });
  });

  it("writes a valid 16 kHz mono 16-bit WAV", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000);
    const v = new DataView(wav.buffer);
    const tag = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(10);
    expect(wav.length).toBe(44 + 10);
    expect(v.getInt16(44 + 6, true)).toBe(32767);
    expect(v.getInt16(44 + 8, true)).toBe(-32768);
  });

  it("60 seconds of speech stays well under the request limit", () => {
    const base64Chars = Math.ceil((44 + 60 * 16000 * 2) / 3) * 4;
    expect(base64Chars).toBeLessThan(2_700_000);
  });

  it("encodes bytes as base64", () => {
    expect(bytesToBase64(new Uint8Array([72, 105]))).toBe("SGk=");
  });
});
