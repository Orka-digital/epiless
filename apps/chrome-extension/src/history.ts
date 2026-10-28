import { normalizePublicUrl } from '@epi-less/core';
import {
  TERMINAL_STATES,
  type CandidateSummary,
  type HistorySettings,
  type ScanJob,
} from './model';
import { reviewSummary } from './verification';

/** Conservative local grouping, not DOM attribution or a claim of unique underlying defects. */
export function candidateSummaries(job: ScanJob): CandidateSummary[] {
  if (job.retainedCandidates)
    return job.retainedCandidates.map((candidate) => {
      // Pre-0.2 retained groups did not include the runner version. Upgrade the
      // known array shape on read without touching opaque/pseudonymized keys.
      try {
        const key: unknown = JSON.parse(candidate.key);
        if (
          Array.isArray(key) &&
          [11, 14].includes(key.length) &&
          typeof key[4] === 'number'
        ) {
          key.splice(4, 0, job.runnerVersion ?? 'legacy-unrecorded');
          return { ...candidate, key: JSON.stringify(key) };
        }
      } catch {
        /* Opaque keys have no structural migration. */
      }
      return candidate;
    });
  const candidates = new Map<string, CandidateSummary>();
  for (const task of job.tasks) {
    const route = normalizePublicUrl(task.url);
    for (const observation of task.observations) {
      const measurement = observation.measurement;
      if (!measurement) continue;
      for (const finding of measurement.findings) {
        // Pixel regions and actual sample dimensions prevent unrelated viewport captures being merged.
        const region = finding.region
          ? [
              finding.region.x,
              finding.region.y,
              finding.region.width,
              finding.region.height,
            ]
          : ['unknown-region'];
        const key = JSON.stringify([
          route,
          observation.scenario,
          finding.type,
          job.engineVersion ?? 'legacy-unrecorded',
          job.runnerVersion ?? 'legacy-unrecorded',
          measurement.quality.width,
          measurement.quality.height,
          task.viewport?.width ?? 'unknown-viewport',
          task.viewport?.height ?? 'unknown-viewport',
          task.viewport?.dpr ?? 'unknown-dpr',
          observation.navigation?.from ?? 'no-navigation',
          ...region,
        ]);
        const existing = candidates.get(key);
        if (existing) existing.occurrences++;
        else
          candidates.set(key, {
            key,
            route,
            scenario: observation.scenario,
            type: finding.type,
            occurrences: 1,
          });
      }
    }
  }
  return [...candidates.values()];
}

/** Discard expired detail while preserving the job summary and explicit expiration timestamp. */
export function expireJobDetails(
  job: ScanJob,
  settings: HistorySettings,
  now: number,
): boolean {
  if (
    settings.detailRetentionDays === null ||
    job.detailsExpiredAt ||
    !TERMINAL_STATES.includes(job.state)
  )
    return false;
  const endedAt = Date.parse(job.endedAt ?? job.updatedAt);
  if (
    !Number.isFinite(endedAt) ||
    endedAt > now - settings.detailRetentionDays * 86_400_000
  )
    return false;
  job.retainedCandidates = candidateSummaries(job);
  job.detailsExpiredAt = new Date(now).toISOString();
  for (const task of job.tasks)
    for (const observation of task.observations)
      if (observation.measurement) observation.measurement.findings = [];
  job.limitations.push(
    'EVENT_DETAILS_EXPIRED: candidate counts and compact grouping identities, audit history, scope and quality remain; individual event timings and messages are no longer available. Absence from this export does not mean resolved.',
  );
  return true;
}

/** Summarize retained history without implying that expired evidence is still available. */
export function historySummary(jobs: readonly ScanJob[]) {
  const origins = [...new Set(jobs.map((job) => job.origin))].sort();
  return origins.map((origin) => {
    const audits = jobs
      .filter((job) => job.origin === origin)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const routes = new Set<string>();
    const measured = new Set<string>();
    const scenarios = new Set<string>();
    const candidates = new Map<string, CandidateSummary>();
    let qualityAudits = 0;
    for (const audit of audits) {
      for (const task of audit.tasks) {
        routes.add(normalizePublicUrl(task.url));
        if (
          task.observations.some(
            (observation) =>
              (observation.measurement?.quality.frameCount ?? 0) >= 2,
          )
        )
          measured.add(normalizePublicUrl(task.url));
        for (const observation of task.observations)
          scenarios.add(
            `${normalizePublicUrl(task.url)}#${observation.scenario}`,
          );
      }
      const observations = audit.tasks.flatMap((task) => task.observations);
      if (
        audit.state === 'COMPLETED' &&
        observations.length > 0 &&
        observations.every((observation) => {
          const quality = observation.measurement?.quality;
          return (
            observation.achieved &&
            quality &&
            quality.frameCount >= 2 &&
            quality.effectiveFps >= 50 &&
            quality.maxGapMs <= 100 &&
            !quality.interrupted &&
            !quality.downsampled
          );
        })
      )
        qualityAudits++;
      for (const candidate of candidateSummaries(audit)) {
        const existing = candidates.get(candidate.key);
        if (existing) existing.occurrences += candidate.occurrences;
        else candidates.set(candidate.key, { ...candidate });
      }
    }
    const completed = audits.filter(
      (audit) => audit.state === 'COMPLETED',
    ).length;
    const reviews = reviewSummary(audits);
    return {
      origin,
      indexedRoutes: routes.size,
      measuredRoutes: measured.size,
      scenarios: scenarios.size,
      attempts: audits.length,
      completedAudits: completed,
      uniqueCandidates: candidates.size,
      occurrences: [...candidates.values()].reduce(
        (total, candidate) => total + candidate.occurrences,
        0,
      ),
      confirmedViolations: 0,
      confirmedIssues: reviews.confirmed,
      resolvedIssues: reviews.resolved,
      regressedIssues: reviews.reopened,
      dismissedCandidates: reviews.falsePositives,
      qualityAudits,
      qualityRatio: completed ? qualityAudits / completed : null,
      latestAuditAt: audits[0].startedAt,
      latestJobState: audits[0].state,
      candidates: [...candidates.values()],
      grouping:
        'Candidate groups describe measured regions, not verified DOM causes. Local issue decisions are explicit human reviews. Resolution requires a comparable targeted recheck and a review; not observed never resolves an issue automatically. These decisions do not establish WCAG conformance.',
    };
  });
}
