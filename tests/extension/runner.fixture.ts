import {
  DEFAULT_LIMITS,
  type ScanJob,
} from '../../apps/chrome-extension/src/model';

export function job(): ScanJob {
  return {
    id: 'scan-one',
    tabId: 1,
    origin: 'https://example.test',
    startUrl: 'https://example.test/',
    startedAt: '2026-10-26T12:00:00Z',
    updatedAt: '2026-10-26T12:00:00Z',
    state: 'RUNNING',
    stopIntent: false,
    generation: 'lease-one',
    elapsedMs: 0,
    mode: 'AUTONOMOUS',
    skippedLinks: 0,
    limitations: [],
    limits: { ...DEFAULT_LIMITS },
    tasks: [
      {
        id: 'home',
        url: 'https://example.test/',
        depth: 0,
        state: 'QUEUED',
        observations: [],
        reasons: [],
      },
    ],
  };
}
