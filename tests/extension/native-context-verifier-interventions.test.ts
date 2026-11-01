import { describe, expect, it } from 'vitest';

import {
  cancelled,
  ownedScan,
  record,
} from './native-context-verifier.fixture';
import { verifyNativeContextGuard } from './verify-native-context-guard.mjs';
describe('retained native context evidence verifier', () => {
  it('accepts actual-shape roundtrip evidence and preserves interruption as uncertainty', () => {
    const evidence = record();
    evidence.job.tasks[0].observations[0].measurement.quality.interrupted = true;
    evidence.job.tasks[0].observations[0].measurement.status = 'INCONCLUSIVE';
    const result = verifyNativeContextGuard(evidence);
    expect(result.candidateRetained).toBe(true);
    expect(result.quality.interrupted).toBe(true);
  });

  it('accepts a CSS resize roundtrip and rejects outer-window-only change', () => {
    const evidence = record('resize');
    expect(verifyNativeContextGuard(evidence).cssReferenceRemoved).toBe(true);
    evidence.roundTrip.changed.context.viewport.width = 900;
    expect(() => verifyNativeContextGuard(evidence)).toThrow(
      /Actual CSS resize/,
    );
  });

  it('requires mutation within the same still-active segment', () => {
    const evidence = record();
    evidence.roundTrip.restoredAt = 4100;
    expect(() => verifyNativeContextGuard(evidence)).toThrow();
  });

  it('rejects missing original field, lost candidate, altered counts and reintroduced exported field', () => {
    for (const mutate of [
      (value: any) => {
        delete value.events.find((event: any) => event.kind === 'WORKER_RESULT')
          .findings[0].spatial.visualField;
      },
      (value: any) => {
        value.job.tasks[0].observations[0].measurement.findings = [];
      },
      (value: any) => {
        value.job.tasks[0].observations[0].measurement.findings[0].spatial.componentPixels = 8;
      },
      (value: any) => {
        value.report.routes[0].scenarios[0].findings[0].spatial.visualField = {
          basis: 'W3C_CSS_REFERENCE',
        };
      },
    ]) {
      const evidence = record();
      mutate(evidence);
      expect(() => verifyNativeContextGuard(evidence)).toThrow();
    }
  });

  it('rejects unchanged revisions and missing real browser zoom events', () => {
    const evidence = record();
    evidence.roundTrip.after.context.viewportRevision = 0;
    expect(() => verifyNativeContextGuard(evidence)).toThrow(
      /context revision/,
    );
    const missing = record();
    missing.zoomEvents = [];
    expect(() => verifyNativeContextGuard(missing)).toThrow();
  });

  it('accepts full compact cancellation and explicit offscreen closure', () => {
    const evidence = cancelled();
    expect(verifyNativeContextGuard(evidence).producerReleased).toBe(true);
    evidence.cancellation.after.tracks = { context: 'CLOSED' };
    expect(verifyNativeContextGuard(evidence).trackEvidence).toMatch(
      /context closed/,
    );
  });

  it('cannot disguise a tab-switch intervention as ordinary production cleanup', () => {
    const evidence = cancelled();
    evidence.tabSwitchProbe = { status: 'COMPLETED' };
    expect(() => verifyNativeContextGuard(evidence)).toThrow(
      /ordinary cleanup/,
    );
    evidence.environment.tabSwitchProbe = true;
    evidence.environment.hypothesis = 'POST_DETACH_INFOBAR_CONTAINER_REBIND';
    evidence.environment.productionAcceptance = false;
    evidence.productionAcceptance = false;
    evidence.tabSwitchProbe.status = 'ABORTED';
    expect(() => verifyNativeContextGuard(evidence)).toThrow(/actually run/);
  });

  it('rejects cancellation before any accepted frames or after natural segment completion', () => {
    const evidence = cancelled();
    evidence.cancellation.acceptedFrame.frames = 0;
    expect(() => verifyNativeContextGuard(evidence)).toThrow();
    const ended = cancelled();
    ended.events.push({ kind: 'SEGMENT_END', segmentId: 'seg', at: 1250 });
    expect(() => verifyNativeContextGuard(ended)).toThrow(
      /during the measured compact/,
    );
  });

  it('rejects a live track, missing query, attached debugger, ownership residue or active capture', () => {
    for (const mutate of [
      (value: any) => {
        value.tracks.streams[0].tracks[0].readyState = 'live';
      },
      (value: any) => {
        value.tracks = { context: 'UNRESPONSIVE' };
      },
      (value: any) => {
        value.debuggerAttached = true;
      },
      (value: any) => {
        value.ownershipKeys = ['viewport-workspace:job'];
      },
      (value: any) => {
        value.ownershipKeys = ['pointer-session:3'];
      },
      (value: any) => {
        value.ownershipKeys = ['viewport-rebind:job'];
      },
      (value: any) => {
        value.capturedTabs[0].status = 'active';
      },
    ]) {
      const evidence = cancelled();
      mutate(evidence.cancellation.after);
      expect(() => verifyNativeContextGuard(evidence)).toThrow();
    }
  });

  it('rejects wrong foreground, tab index, surviving workspace or unrecovered CSS layout', () => {
    for (const mutate of [
      (value: any) => {
        value.foregroundTabId = 3;
      },
      (value: any) => {
        value.tab.index = 0;
      },
      (value: any) => {
        value.windowIds.push(9);
      },
      (value: any) => {
        value.context.viewport.height = 400;
      },
    ]) {
      const evidence = cancelled();
      mutate(evidence.cancellation.after);
      expect(() => verifyNativeContextGuard(evidence)).toThrow();
    }
  });

  it('accepts explicitly separated owned cancellation and natural-completion evidence', () => {
    for (const mode of ['cancel', 'complete']) {
      const result = verifyNativeContextGuard(ownedScan(mode));
      expect(result).toMatchObject({
        ownedScan: true,
        originalDocumentPreserved: true,
        ownedScanTabRemoved: true,
        producerReleased: true,
      });
      expect(result.scope).toContain(
        'no legacy original-WebContents restoration',
      );
    }
  });
});
