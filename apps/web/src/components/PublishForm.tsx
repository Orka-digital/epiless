import { useHydrated } from '../lib/use-hydrated';
import { usePublicationDraft } from '../lib/publication/use-publication-draft';
import { usePublicationUpload } from '../lib/publication/use-publication-upload';
import { PublicationApproval } from './publication/PublicationApproval';
import { PublicationResultNotice } from './publication/PublicationResultNotice';
import { ReportRedactionFields } from './publication/ReportRedactionFields';
import { SnapshotPreview } from './publication/SnapshotPreview';
import { UploadQueue } from './publication/UploadQueue';

/** Compose local disclosure controls and the separately owned upload lifecycle. */
export default function PublishForm({
  signedIn,
  accountId,
  name,
}: {
  signedIn: boolean;
  accountId: string;
  name: string;
}) {
  const hydrated = useHydrated();
  const upload = usePublicationUpload(accountId, name);
  const draft = usePublicationDraft(
    signedIn,
    upload.setError,
    upload.setResult,
  );
  const { report, redaction, preview } = draft;
  const blocked = upload.busy || Boolean(upload.active);
  const accountMatches =
    signedIn && Boolean(accountId) && upload.currentAccount === accountId;
  const canPublish =
    !blocked &&
    accountMatches &&
    draft.confirmed &&
    Boolean(preview.snapshot?.routes.length);

  function publish(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview.snapshot || !canPublish) return;
    void upload.approve(preview.snapshot, draft.visibility, draft.clear);
  }

  return (
    <div>
      {upload.result && <PublicationResultNotice result={upload.result} />}
      {!accountMatches && (
        <div className="notice">
          Meld je aan om een nieuwe snapshot goed te keuren of ververs deze
          pagina na het wisselen van account. Bewaarde opdrachten blijven aan
          hun oorspronkelijke account gekoppeld.{' '}
          <a href="/account?returnTo=/publish">Naar aanmelden</a>
        </div>
      )}
      <label className="field">
        Kies een lokale JSON-export
        <input
          type="file"
          accept="application/json,.json"
          disabled={blocked || !signedIn || !hydrated}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void draft.importFile(file);
          }}
        />
        <small>
          De preview blijft in je browser. Pas na je bevestiging wordt de exacte
          geselecteerde snapshot in de lokale wachtrij bewaard en verstuurd.
        </small>
      </label>
      {report && redaction && (
        <form onSubmit={publish}>
          <div className="report-section">
            <p className="eyebrow">Controleer voor je deelt</p>
            <h2>{new URL(report.origin).hostname}</h2>
            <p className="fine">
              {report.routes.length} routes · engine {report.engineVersion} ·{' '}
              {report.startedAt.slice(0, 10)}. Geplaatst onder{' '}
              <strong>{name}</strong>.
            </p>
          </div>
          <ReportRedactionFields
            report={report}
            redaction={redaction}
            disabled={blocked}
            edit={draft.edit}
          />
          <SnapshotPreview preview={preview} />
          <PublicationApproval
            visibility={draft.visibility}
            confirmed={draft.confirmed}
            disabled={blocked}
            canPublish={canPublish}
            busy={upload.busy}
            changeVisibility={draft.changeVisibility}
            setConfirmed={draft.setConfirmed}
          />
        </form>
      )}
      <UploadQueue
        jobs={upload.jobs}
        now={upload.now}
        accountId={upload.currentAccount}
        blocked={blocked}
        active={upload.active}
        onRetry={upload.send}
        onCancel={upload.cancel}
        onForget={upload.forget}
        onVerify={upload.verify}
        onChallengeError={upload.failed}
        onError={upload.setError}
      />
      {upload.error && (
        <p className="notice error" role="alert">
          {upload.error}
        </p>
      )}
    </div>
  );
}
