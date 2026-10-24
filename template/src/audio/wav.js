// A 16-bit PCM stereo WAV from two Float32Arrays, with seeded TPDF dither so the bytes are the same on every run.
export function encodeWav(left, right, sr, rng) {
  const n = left.length, data = 4 * n;
  const buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, data, true);
  const q = (x) => {
    const d = (rng() - rng()); // triangular, one LSB peak
    return Math.max(-32768, Math.min(32767, Math.round(x * 32767 + d)));
  };
  for (let i = 0, o = 44; i < n; i++, o += 4) { v.setInt16(o, q(left[i]), true); v.setInt16(o + 2, q(right[i]), true); }
  return new Uint8Array(buf);
}
