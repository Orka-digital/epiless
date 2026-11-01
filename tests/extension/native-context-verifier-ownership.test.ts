import { describe, expect, it } from 'vitest';

import { ownedScan } from './native-context-verifier.fixture';
import { verifyNativeContextGuard } from './verify-native-context-guard.mjs';
describe('retained native context evidence verifier', () => {
  it('requires genuine pre-prepare identity, a separate owned tab and no preparation capture', () => {
    for (const mutate of [
      (value: any) => {
        value.environment.extensionBuild.embeddedScannerBuildSha256 =
          'e'.repeat(64);
      },
      (value: any) => {
        value.ownedScan.originalInitial.at = 650;
      },
      (value: any) => {
        value.ownedScan.originalInitial.document.at = -2000;
      },
      (value: any) => {
        value.ownedScan.preparation.at = 1001;
      },
      (value: any) => {
        value.ownedScan.preparation.owner.scanTabId = 2;
      },
      (value: any) => {
        value.ownedScan.preparation.capturedTabs = [
          { tabId: 3, status: 'active' },
        ];
      },
      (value: any) => {
        value.ownedScan.preparation.debuggerTabIds = [2];
      },
      (value: any) => {
        value.job.disposableSource.nonce = 'other-owner';
      },
    ]) {
      const value = ownedScan();
      mutate(value);
      expect(() => verifyNativeContextGuard(value)).toThrow();
    }
  });

  it('rejects replaced documents, altered original context and foreground changes', () => {
    for (const mutate of [
      (original: any) => {
        original.document.documentId = 'replacement-document-id';
      },
      (original: any) => {
        original.document.timeOrigin++;
      },
      (original: any) => {
        original.context.documentToken = 'replacement-content-token';
      },
      (original: any) => {
        original.context.viewportRevision++;
      },
      (original: any) => {
        original.document.height = 450;
      },
      (original: any) => {
        original.context.viewport.height = 450;
      },
      (original: any) => {
        original.tab.url += 'changed';
      },
      (original: any) => {
        original.tab.index++;
      },
      (original: any) => {
        original.window.width++;
      },
      (original: any) => {
        original.tab.active = true;
      },
      (original: any) => {
        original.foregroundTabId = 8;
      },
      (original: any) => {
        original.window.focused = false;
      },
    ]) {
      const value = ownedScan();
      mutate(value.ownedScan.after.original);
      expect(() => verifyNativeContextGuard(value)).toThrow();
    }
  });

  it('requires actual scan/workspace removal and released capture, debugger and ownership', () => {
    for (const mutate of [
      (value: any) => {
        value.tab = { id: 3 };
      },
      (value: any) => {
        value.tabIds.push(3);
      },
      (value: any) => {
        value.windowIds.push(9);
      },
      (value: any) => {
        value.ownershipKeys = ['advanced-scan-owner'];
      },
      (value: any) => {
        value.ownedScanOwner = { phase: 'MANUAL' };
      },
      (value: any) => {
        value.debuggerTabIds = [2];
      },
      (value: any) => {
        value.capturedTabs = [{ tabId: 2, status: 'pending' }];
      },
      (value: any) => {
        value.tracks = { context: 'UNRESPONSIVE' };
      },
      (value: any) => {
        value.tracks.streams[0].tracks[0].readyState = 'live';
      },
      (value: any) => {
        value.at = 1250;
      },
    ]) {
      const value = ownedScan();
      mutate(value.ownedScan.after);
      expect(() => verifyNativeContextGuard(value)).toThrow();
    }
  });

  it('requires measured native compact coverage and natural completion without STOP', () => {
    for (const mutate of [
      (value: any) => {
        value.cancellation = {};
      },
      (value: any) => {
        value.job.stopIntent = true;
      },
      (value: any) => {
        value.job.stopReason = 'USER_STOP';
      },
      (value: any) => {
        value.job.tasks[0].observations[0].achieved = false;
      },
      (value: any) => {
        value.job.tasks[0].observations[0].measurement.quality.effectiveFps = 35;
      },
      (value: any) => {
        value.job.tasks[0].observations[0].measurement.quality.downsampled = true;
      },
      (value: any) => {
        value.ownedScan.compactBefore.snapshot.ownedScanOwner.generation =
          'other';
      },
      (value: any) => {
        value.ownedScan.compactBefore.snapshot.tracks.streams[0].tracks[0].settings.resizeMode =
          'crop-and-scale';
      },
      (value: any) => {
        value.events = value.events.filter(
          (event: any) => event.kind !== 'SEGMENT_END',
        );
      },
    ]) {
      const value = ownedScan('complete');
      mutate(value);
      expect(() => verifyNativeContextGuard(value)).toThrow();
    }
  });
});
