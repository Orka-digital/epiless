import { FrameAnalyzer } from '@epi-less/analysis-engine';

/** Numeric JIT preparation only. These throwaway buffers are never rendered,
 * sent as source frames, emitted as live events, or included in a measurement. */
export function warmAnalysisRuntime(): void {
  const width = 64,
    height = 64;
  const warmup = new FrameAnalyzer({ maxPixels: width * height });
  warmup.prepare(width, height);
  const rgba = new Uint8Array(width * height * 4);
  for (let frame = 0; frame < 80; frame++) {
    const phase = Math.floor(frame / 6) % 2;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        // Uniform tiles, fine detail, general and saturated-red transitions.
        const pulse = x < 32 ? phase : (phase + x + y) % 2;
        rgba[offset] = pulse ? 255 : 0;
        rgba[offset + 1] = x < 32 ? rgba[offset] : pulse ? 0 : 255;
        rgba[offset + 2] = x < 32 ? rgba[offset] : 0;
        rgba[offset + 3] = 255;
        if (frame >= 40) {
          // Break all tile sharing too: preparing only repeated patterns does
          // not exercise the dense kernel before the first measured frame.
          const pixel = y * width + x;
          let noise = Math.imul(pixel ^ 0x6d2b79f5, 0x45d9f3b);
          noise = Math.imul(noise ^ (noise >>> 16), 0x45d9f3b);
          noise = (noise ^ (noise >>> 16)) >>> 0;
          rgba[offset] = (noise & 63) + phase * 180;
          rgba[offset + 1] = ((noise >>> 8) & 63) + phase * 180;
          rgba[offset + 2] = ((noise >>> 16) & 63) + phase * 180;
        }
      }
    warmup.pushFrame({ rgba, width, height, timestampMs: (frame * 1000) / 60 });
  }
  warmup.finish();
}
