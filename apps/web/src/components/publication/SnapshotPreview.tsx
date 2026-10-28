import type { AuditReport } from '@epi-less/core';
/** Render exactly the redacted snapshot that can be approved, never the raw import. */
export function SnapshotPreview({
  preview,
}: {
  preview: { snapshot: AuditReport | null; error: string };
}) {
  return (
    <>
      <details className="route-item">
        <summary>Exacte geselecteerde inhoud bekijken</summary>
        <p className="fine">
          Alleen deze velden worden gedeeld, samen met de gekozen zichtbaarheid
          en jouw accountnaam. Lokale identifiers worden vervangen. Origin,
          meetdatums, versies, meetgegevens en scanstatus blijven zichtbaar.
        </p>
        <pre
          role="region"
          tabIndex={0}
          aria-label="Geselecteerde snapshot in JSON"
        >
          <code>
            {preview.snapshot
              ? JSON.stringify(preview.snapshot, null, 2)
              : preview.error}
          </code>
        </pre>
      </details>
      {preview.error && (
        <p className="notice error" role="alert">
          {preview.error}
        </p>
      )}
    </>
  );
}
