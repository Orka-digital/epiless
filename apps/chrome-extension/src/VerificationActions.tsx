import type { ScanJob } from './model';

import { type IssueReview } from './verification';
/** Render actions evidence; actions remain explicit callbacks owned by the workspace. */
export function VerificationActions({
  disabled,
  note,
  comparison,
  fresh,
  latest,
  check,
  review,
}: {
  disabled: boolean;
  note: string;
  comparison: import('./verification').VerificationComparison | undefined;
  fresh: boolean;
  latest: IssueReview | undefined;
  check: ScanJob | undefined;
  review: (decision: IssueReview['decision']) => Promise<unknown>;
}) {
  return (
    <div className="actions">
      <button
        disabled={disabled || note.trim().length < 3}
        onClick={() => void review('CONFIRMED')}
      >
        Probleem bevestigen
      </button>
      <button
        disabled={disabled || note.trim().length < 3}
        onClick={() => void review('FALSE_POSITIVE')}
      >
        Geen probleem vastleggen
      </button>
      <button
        disabled={
          disabled ||
          note.trim().length < 3 ||
          comparison?.status !== 'NOT_OBSERVED' ||
          !fresh ||
          !latest ||
          !['CONFIRMED', 'REOPENED'].includes(latest.decision)
        }
        onClick={() => void review('RESOLVED')}
      >
        Als opgelost beoordelen
      </button>
      <button
        disabled={
          disabled ||
          note.trim().length < 3 ||
          comparison?.status !== 'REOBSERVED' ||
          latest?.decision !== 'RESOLVED' ||
          !check ||
          Date.parse(check.startedAt) <= Date.parse(latest.at)
        }
        onClick={() => void review('REOPENED')}
      >
        Terugkeer bevestigen
      </button>
    </div>
  );
}
