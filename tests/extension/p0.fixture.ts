import {
  DEFAULT_LIMITS,
  type ScanJob,
} from '../../apps/chrome-extension/src/model';

export function fixture(id = 'audit-one'): ScanJob {
  return {
    id,
    tabId: 1,
    origin: 'https://example.test',
    startUrl: 'https://example.test/private-client',
    engineVersion: 'heuristic-test',
    startedAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-01T12:00:30Z',
    endedAt: '2026-01-01T12:00:30Z',
    state: 'COMPLETED',
    stopIntent: false,
    generation: 'lease',
    elapsedMs: 30000,
    mode: 'EXTENDED',
    viewportDurationMs: 30000,
    skippedLinks: 0,
    limitations: ['Unvalidated capture.'],
    limits: { ...DEFAULT_LIMITS, maxRoutes: 1 },
    tasks: [
      {
        id: 'route',
        url: 'https://example.test/private-client',
        depth: 0,
        state: 'OBSERVED',
        reasons: [],
        observations: [
          {
            id: 'observation',
            scenario: 'extended-viewport',
            startedAt: '2026-01-01T12:00:00Z',
            endedAt: '2026-01-01T12:00:30Z',
            achieved: true,
            measurement: {
              status: 'NEEDS_REVIEW',
              passed: null,
              limitations: [],
              quality: {
                frameCount: 1800,
                effectiveFps: 60,
                maxGapMs: 17,
                width: 320,
                height: 180,
                downsampled: false,
                interrupted: false,
              },
              findings: [
                {
                  id: 'candidate',
                  type: 'GENERAL_FLASH',
                  severity: 'warning',
                  reviewStatus: 'NEEDS_REVIEW',
                  startMs: 1000,
                  endMs: 2000,
                  flashesInWindow: 4,
                  affectedRatio: 0.2,
                  region: { x: 10, y: 10, width: 20, height: 20 },
                  message: 'Candidate at private-client.',
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
