import { FrameAnalyzer } from '../src/index.js';

export function capture(
  pixel: (time: number, x: number) => readonly number[],
  duration = 2200,
  width = 1,
  step = 10,
) {
  const analyzer = new FrameAnalyzer();
  for (let time = 0; time <= duration; time += step) {
    const rgba = new Uint8Array(width * 4);
    for (let x = 0; x < width; x++) rgba.set([...pixel(time, x), 255], x * 4);
    analyzer.pushFrame({ rgba, width, height: 1, timestampMs: 100_000 + time });
  }
  return analyzer.finish();
}

export const monochrome = (value: number) => [value, value, value];
