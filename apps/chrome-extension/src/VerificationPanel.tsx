import type { CommandAction } from './command-protocol';
import { useState } from 'react';
import type { ScanJob } from './model';
import { explainPhaseReason } from './PhaseEvidencePanel';
import {
  compareVerification,
  issueReviewKey,
  hasFreshVerification,
  type IssueAnchor,
  type IssueReview,
} from './verification';

const labels = {
  CONFIRMED: 'Probleem bevestigd',
  FALSE_POSITIVE: 'Geen te herstellen probleem',
  RESOLVED: 'Opgelost na hercontrole',
  REOPENED: 'Teruggekeerd na herstel',
};
export function VerificationPanel({
  job,
  anchor,
  jobs,
  disabled,
  command,
}: {
  job: ScanJob;
  anchor: IssueAnchor;
  jobs: ScanJob[];
  disabled: boolean;
  command: CommandAction;
}) {
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState('');
  const reviews = (job.reviews ?? []).filter(
    (review) => issueReviewKey(review) === issueReviewKey(anchor),
  );
  const latest = reviews.at(-1);
  const checks = jobs.filter(
    (value) =>
      value.verificationOf?.jobId === job.id &&
      value.verificationOf.taskId === anchor.taskId &&
      value.verificationOf.observationId === anchor.observationId,
  );
  const check = checks.find((value) => value.id === selected) ?? checks[0];
  const comparison = check
    ? compareVerification(job, anchor, check)
    : undefined;
  const fresh = check ? hasFreshVerification(job, anchor, check) : false;
  const review = (decision: IssueReview['decision']) =>
    command('REVIEW_ISSUE', {
      jobId: job.id,
      review: {
        ...anchor,
        decision,
        note,
        ...(['RESOLVED', 'REOPENED'].includes(decision) && check
          ? { verificationJobId: check.id }
          : {}),
      },
    });
  return (
    <details className="verification-panel">
      <summary>
        Beoordeling en hercontrole
        {latest ? ` · ${labels[latest.decision]}` : ''}
      </summary>
      <p>
        Deze beoordeling blijft lokaal. Bevestigen betekent dat jij een te
        herstellen probleem hebt vastgesteld; het is geen automatisch
        WCAG-oordeel.
      </p>
      {checks.length > 0 && (
        <>
          <label className="field">
            Vergelijk met hercontrole
            <select
              value={check?.id ?? ''}
              onChange={(event) => setSelected(event.target.value)}
            >
              {checks.map((value) => (
                <option key={value.id} value={value.id}>
                  {new Date(value.startedAt).toLocaleString('nl-BE')} ·{' '}
                  {value.state}
                </option>
              ))}
            </select>
          </label>
          <p>
            <strong>
              {comparison?.status === 'REOBSERVED'
                ? 'Vergelijkbare kandidaat opnieuw waargenomen'
                : comparison?.status === 'NOT_OBSERVED'
                  ? 'Niet opnieuw waargenomen onder vergelijkbare meetomstandigheden'
                  : 'Hercontrole nog niet vergelijkbaar'}
            </strong>
          </p>
          {comparison?.reasons.length ? (
            <ul>
              {comparison.reasons.map((reason) => (
                <li key={reason}>{explainPhaseReason(reason)}</li>
              ))}
            </ul>
          ) : null}
          <p>
            Afwezigheid alleen sluit een probleem niet af. Controleer de
            wijziging en leg jouw beoordeling vast.
          </p>
          {!fresh && (
            <p>
              Deze hercontrole dateert van vóór de laatste opgeloste of
              heropende beoordeling. Voer een nieuwe hercontrole uit om dit
              probleem opnieuw af te sluiten.
            </p>
          )}
        </>
      )}
      <label className="field">
        Toelichting bij jouw beoordeling
        <textarea
          maxLength={1000}
          minLength={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Wat heb je vastgesteld of aangepast?"
        />
      </label>
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
      {reviews.length > 0 && (
        <ol>
          {reviews.map((value) => (
            <li key={value.id}>
              <strong>{labels[value.decision]}</strong> ·{' '}
              {new Date(value.at).toLocaleString('nl-BE')}
              <p>{value.note}</p>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
