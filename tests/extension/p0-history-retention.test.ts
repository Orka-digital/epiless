import { describe, expect, it } from 'vitest';

import {
  canResumeWithVersions,
  DEFAULT_HISTORY_SETTINGS,
  RUNNER_VERSION,
  viewportDuration,
} from '../../apps/chrome-extension/src/model';

import {
  candidateSummaries,
  expireJobDetails,
  historySummary,
} from '../../apps/chrome-extension/src/history';

import { buildReport } from '../../apps/chrome-extension/src/report';

import { fixture } from './p0.fixture';
describe('P0 audit modes and local history', () => {
  it('preserves measured versions and refuses to mix old or unknown versions on resume', () => {
    const job = fixture();
    expect(buildReport(job).runnerVersion).toBe('legacy-unrecorded');
    expect(canResumeWithVersions(job, job.engineVersion!)).toBe(false);
    job.runnerVersion = RUNNER_VERSION;
    job.scannerBuildSha256 = 'a'.repeat(64);
    expect(canResumeWithVersions(job, job.engineVersion!, 'a'.repeat(64))).toBe(
      true,
    );
    expect(canResumeWithVersions(job, job.engineVersion!, 'b'.repeat(64))).toBe(
      false,
    );
    expect(canResumeWithVersions(job, job.engineVersion!, undefined)).toBe(
      false,
    );
    expect(canResumeWithVersions(job, 'future-engine')).toBe(false);
    expect(buildReport(job).runnerVersion).toBe(RUNNER_VERSION);
    const old = structuredClone(job);
    old.runnerVersion = '0.1.0';
    expect(canResumeWithVersions(old, job.engineVersion!)).toBe(false);
    expect(buildReport(old).runnerVersion).toBe('0.1.0');
    expect(historySummary([old, job])[0].uniqueCandidates).toBe(2);
  });

  it('uses fixed quick duration and clamps extended defaults and untrusted durations', () => {
    expect(viewportDuration('QUICK', 100)).toBe(15000);
    expect(viewportDuration('EXTENDED')).toBe(30000);
    expect(viewportDuration('EXTENDED', Number.NaN)).toBe(30000);
    expect(viewportDuration('EXTENDED', 2)).toBe(15000);
    expect(viewportDuration('EXTENDED', 300)).toBe(120000);
  });

  it('counts repeat occurrences separately, preserves unobserved candidates and separates contexts', () => {
    const old = fixture();
    const repeated = fixture('repeat');
    const clear = fixture('not-seen');
    clear.tasks[0].observations[0].measurement!.findings = [];
    const summary = historySummary([old, repeated, clear])[0];
    expect(summary.uniqueCandidates).toBe(1);
    expect(summary.occurrences).toBe(2);
    expect(summary.attempts).toBe(3);
    expect(summary.resolvedIssues).toBe(0);
    expect(summary.qualityRatio).toBe(1);
    repeated.engineVersion = 'different-engine';
    expect(historySummary([old, repeated])[0].uniqueCandidates).toBe(2);
    repeated.engineVersion = old.engineVersion;
    repeated.tasks[0].observations[0].measurement!.quality.width = 640;
    expect(historySummary([old, repeated])[0].uniqueCandidates).toBe(2);
  });

  it('expires only event details, preserves compact counts and cannot manufacture a clean report', () => {
    const job = fixture();
    const before = candidateSummaries(job);
    expect(
      expireJobDetails(
        job,
        DEFAULT_HISTORY_SETTINGS,
        Date.parse('2026-10-27T12:00:00Z'),
      ),
    ).toBe(true);
    expect(job.tasks[0].observations[0].measurement!.findings).toEqual([]);
    expect(candidateSummaries(job)).toEqual(before);
    expect(historySummary([job])[0].occurrences).toBe(1);
    expect(buildReport(job).status).toBe('INCONCLUSIVE');
    expect(buildReport(job).limitations.join(' ')).toContain(
      'EVENT_DETAILS_EXPIRED',
    );
    expect(expireJobDetails(job, DEFAULT_HISTORY_SETTINGS, Date.now())).toBe(
      false,
    );
  });

  it('keeps legacy retained and unexpired candidate groups aligned after the version-key upgrade', () => {
    const live = fixture('live');
    const expired = fixture('expired');
    expired.retainedCandidates = candidateSummaries(expired).map(
      (candidate) => {
        const key = JSON.parse(candidate.key);
        key.splice(4, 1); // Historical format had no runner-version position.
        return { ...candidate, key: JSON.stringify(key) };
      },
    );
    const stored = structuredClone(expired.retainedCandidates);
    expect(historySummary([live, expired])[0].uniqueCandidates).toBe(1);
    expect(historySummary([live, expired])[0].occurrences).toBe(2);
    expect(expired.retainedCandidates).toEqual(stored);
  });

  it('never prunes active jobs or data configured to remain', () => {
    const job = fixture();
    job.state = 'RUNNING';
    expect(expireJobDetails(job, DEFAULT_HISTORY_SETTINGS, Date.now())).toBe(
      false,
    );
    job.state = 'COMPLETED';
    expect(
      expireJobDetails(
        job,
        { schemaVersion: 1, detailRetentionDays: null },
        Date.now(),
      ),
    ).toBe(false);
  });
});
