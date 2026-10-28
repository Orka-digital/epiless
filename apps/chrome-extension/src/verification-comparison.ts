import { phaseComparisonReasons } from './animation-phase';

import { type Finding } from '@epi-less/core';

import { mediaComparisonReasons } from './media-replay';

import { TERMINAL_STATES, type Observation, type ScanJob } from './model';
import {
  findIssue,
  type IssueAnchor,
  type VerificationComparison,
} from './verification-anchor';

function adequate(observation: Observation): boolean {
  const measurement = observation.measurement;
  const quality = measurement?.quality;
  return Boolean(
    observation.achieved &&
    observation.coverage === 'TESTED' &&
    measurement &&
    measurement.status !== 'INCONCLUSIVE' &&
    quality &&
    quality.frameCount >= 2 &&
    quality.effectiveFps >= 50 &&
    quality.maxGapMs <= 100 &&
    !quality.downsampled &&
    !quality.interrupted &&
    quality.captureWindowMs !== undefined &&
    quality.captureWindowMs >=
      (observation.replay?.durationMs ?? Infinity) - 100 &&
    quality.leadingIdleMs !== undefined &&
    quality.leadingIdleMs <= 100 &&
    quality.trailingIdleMs !== undefined &&
    quality.trailingIdleMs <= 100,
  );
}

function sameCandidate(a: Finding, b: Finding): boolean {
  if (a.type !== b.type) return false;
  // A unique sampled structural source tolerates layout movement. It remains a
  // candidate identity, not proof that the sampled element caused the signal.
  if (a.source?.candidates.length === 1 && b.source?.candidates.length === 1)
    return (
      JSON.stringify(a.source.candidates[0].selectorPath) ===
      JSON.stringify(b.source.candidates[0].selectorPath)
    );
  const ar = a.region,
    br = b.region;
  if (!ar || !br) return false;
  const intersection =
    Math.max(
      0,
      Math.min(ar.x + ar.width, br.x + br.width) - Math.max(ar.x, br.x),
    ) *
    Math.max(
      0,
      Math.min(ar.y + ar.height, br.y + br.height) - Math.max(ar.y, br.y),
    );
  const union = ar.width * ar.height + br.width * br.height - intersection;
  return union > 0 && intersection / union >= 0.5;
}

/** Absence is only evidence for a later human decision, never an automatic resolution. */
export function compareVerification(
  baseline: ScanJob,
  anchor: IssueAnchor,
  next: ScanJob,
): VerificationComparison {
  const { observation, finding } = findIssue(baseline, anchor);
  const reasons: string[] = [];
  compareVerificationTarget(baseline, anchor, next, reasons);
  const observations = next.tasks
    .flatMap((task) => task.observations)
    .filter(
      (value) =>
        value.replay && value.replay.stateKey === observation?.replay?.stateKey,
    );
  const repeated = observations.length === 1 ? observations[0] : undefined;
  if (
    !finding ||
    !observation?.replay ||
    baseline.detailsExpiredAt ||
    next.detailsExpiredAt
  )
    reasons.push(
      'De oorspronkelijke meetdetails of het reproduceerbare scenario ontbreken.',
    );
  compareBuild(baseline, next, reasons);
  compareCompletion(baseline, next, repeated, reasons);
  compareObservation(observation, repeated, finding, reasons);
  const matches = finding
    ? (repeated?.measurement?.findings ?? []).filter((value) =>
        sameCandidate(finding, value),
      )
    : [];
  if (
    !matches.length &&
    finding &&
    repeated?.measurement?.findings.some((value) => value.type === finding.type)
  )
    reasons.push(
      'Er zijn andere kandidaten van hetzelfde type; de oorspronkelijke bron is niet eenduidig te volgen.',
    );
  return {
    status: reasons.length
      ? 'INCOMPARABLE'
      : matches.length
        ? 'REOBSERVED'
        : 'NOT_OBSERVED',
    reasons,
    baselineJobId: baseline.id,
    verificationJobId: next.id,
    matchingFindingIds: matches.map((value) => value.id),
  };
}

function compareBuild(
  baseline: ScanJob,
  next: ScanJob,
  reasons: string[],
): void {
  if (
    !baseline.engineVersion ||
    baseline.engineVersion !== next.engineVersion ||
    !baseline.runnerVersion ||
    baseline.runnerVersion !== next.runnerVersion
  )
    reasons.push(
      'Detector- of runnerversies verschillen; resultaten zijn niet rechtstreeks vergelijkbaar.',
    );
  if (
    !baseline.scannerBuildSha256 ||
    !/^[a-f0-9]{64}$/.test(baseline.scannerBuildSha256) ||
    baseline.scannerBuildSha256 !== next.scannerBuildSha256
  )
    reasons.push(
      'De exacte scannerbuild ontbreekt of verschilt. Een gelijk versienummer alleen bewijst geen vergelijkbare implementatie.',
    );
}

function compareObservation(
  observation: Observation | undefined,
  repeated: Observation | undefined,
  finding: Finding | undefined,
  reasons: string[],
): void {
  if (
    !observation ||
    !adequate(observation) ||
    !repeated ||
    !adequate(repeated)
  )
    reasons.push(
      'Beide metingen moeten voldoende volledige capture en bereikte toestanden hebben.',
    );
  if (
    observation?.measurement &&
    repeated?.measurement &&
    (observation.measurement.quality.width !==
      repeated.measurement.quality.width ||
      observation.measurement.quality.height !==
        repeated.measurement.quality.height)
  )
    reasons.push('De resolutie van de meetbeelden verschilt.');
  if (observation && repeated) {
    reasons.push(...mediaComparisonReasons(observation, repeated, finding));
    reasons.push(...phaseComparisonReasons(observation, repeated, finding));
  }
}

function compareVerificationTarget(
  baseline: ScanJob,
  anchor: IssueAnchor,
  next: ScanJob,
  reasons: string[],
): void {
  const target = next.verificationOf;
  if (
    !target ||
    target.jobId !== baseline.id ||
    target.taskId !== anchor.taskId ||
    target.observationId !== anchor.observationId
  )
    reasons.push(
      'Deze meting is geen gerichte hercontrole van het oorspronkelijke scenario.',
    );
}

function compareCompletion(
  baseline: ScanJob,
  next: ScanJob,
  repeated: Observation | undefined,
  reasons: string[],
): void {
  if (
    baseline.origin !== next.origin ||
    !repeated ||
    !next.endedAt ||
    !TERMINAL_STATES.includes(next.state)
  )
    reasons.push('Hetzelfde scenario is nog niet aantoonbaar afgerond.');
  if (
    Date.parse(next.startedAt) <=
    Date.parse(baseline.endedAt ?? baseline.updatedAt)
  )
    reasons.push(
      'De hercontrole moet na de oorspronkelijke meting zijn gestart.',
    );
}
