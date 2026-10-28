import { describe, expect, it } from 'vitest';
import { FrameAnalyzer } from '../../packages/analysis-engine/src/index';
import { parseMeasurement } from '../../apps/chrome-extension/src/measurement-protocol';
import {
  readStartIntent,
  readPendingRecheck,
  readScanPreferences,
  readHistorySettings,
} from '../../apps/chrome-extension/src/store-control-schema';

describe('trusted scanner boundaries', () => {
  it('accepts real engine results and rejects invented passes or malformed quality', () => {
    const result = new FrameAnalyzer().finish();
    expect(parseMeasurement(result)).toEqual(result);
    expect(() => parseMeasurement({ ...result, passed: true })).toThrow(
      'INVALID_MEASUREMENT_RESULT',
    );
    expect(() =>
      parseMeasurement({
        ...result,
        quality: { ...result.quality, frameCount: -1 },
      }),
    ).toThrow('INVALID_MEASUREMENT_RESULT');
    expect(() => parseMeasurement(undefined)).toThrow(
      'INVALID_MEASUREMENT_RESULT',
    );
  });
  it('accepts complete engine findings without stripping their numeric evidence', () => {
    const analyzer = new FrameAnalyzer();
    const dark = new Uint8Array([
      0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    ]);
    const light = new Uint8Array(16).fill(255);
    for (let frame = 0; frame < 90; frame++)
      analyzer.pushFrame({
        rgba: Math.floor(frame / 5) % 2 ? light : dark,
        width: 2,
        height: 2,
        timestampMs: (frame * 1000) / 60,
      });
    const result = analyzer.finish();
    expect(result.findings.length).toBeGreaterThan(0);
    expect(parseMeasurement(result)).toEqual(result);
  });
  it('never turns corrupt stored authorization into a usable start or recheck', () => {
    const intent = {
      id: 'start',
      tabId: 7,
      origin: 'https://example.com',
      mode: 'AUTONOMOUS',
      expiresAt: Date.now() + 1000,
    };
    expect(readStartIntent(intent)).toEqual(intent);
    for (const patch of [
      { tabId: -1 },
      { origin: 'https://example.com/path' },
      { mode: 'UNKNOWN' },
      { expiresAt: NaN },
      { advancedPointer: 'true' },
    ])
      expect(readStartIntent({ ...intent, ...patch })).toBeUndefined();
    expect(
      readPendingRecheck({
        tabId: 7,
        route: 'javascript:alert(1)',
        replayOf: { jobId: 'job', taskId: 'task', observationId: 'obs' },
      }),
    ).toBeUndefined();
  });
  it('defaults preferences safely and preserves details when retention is corrupt', () => {
    expect(
      readScanPreferences({ mode: 'AUTONOMOUS', viewportSeconds: Infinity }),
    ).toEqual({ mode: 'AUTONOMOUS', viewportSeconds: 30 });
    expect(
      readHistorySettings({ schemaVersion: 1, detailRetentionDays: 0 })
        .detailRetentionDays,
    ).toBeNull();
    expect(
      readHistorySettings({ schemaVersion: 1, detailRetentionDays: 30 })
        .detailRetentionDays,
    ).toBe(30);
  });
});
