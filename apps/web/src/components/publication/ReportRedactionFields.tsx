import type { AuditReport } from '@epi-less/core';
import type { RedactionOptions } from '../../lib/publication-preview';
/** Edit route disclosure and optional text; the owner invalidates approval on every edit. */
export function ReportRedactionFields({
  report,
  redaction,
  disabled,
  edit,
}: {
  report: AuditReport;
  redaction: RedactionOptions;
  disabled: boolean;
  edit: (options: RedactionOptions) => void;
}) {
  return (
    <>
      <fieldset disabled={disabled}>
        <legend>Routes en gedeelde paden</legend>
        <p className="fine">
          Routepaden zijn standaard vervangen door neutrale labels. Je kunt
          ieder pad aanpassen of bewust het oorspronkelijke pad opnemen.
        </p>
        {report.routes.map((route, i) => (
          <div className="route-item" key={`${route.url}-${i}`}>
            <label className="check-label">
              <input
                type="checkbox"
                checked={redaction.routes[i].included}
                onChange={(e) =>
                  edit({
                    ...redaction,
                    routes: redaction.routes.map((r, n) =>
                      n === i ? { ...r, included: e.target.checked } : r,
                    ),
                  })
                }
              />
              <span>
                Route {i + 1} opnemen · {route.scenarios.length} scenario’s
              </span>
            </label>
            <p className="fine">Lokaal pad: {new URL(route.url).pathname}</p>
            <label className="field">
              Gedeeld pad voor route {i + 1}
              <input
                value={redaction.routes[i].path}
                disabled={!redaction.routes[i].included}
                maxLength={4000}
                onChange={(e) =>
                  edit({
                    ...redaction,
                    routes: redaction.routes.map((r, n) =>
                      n === i ? { ...r, path: e.target.value } : r,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="button ghost"
              disabled={!redaction.routes[i].included}
              onClick={() =>
                edit({
                  ...redaction,
                  routes: redaction.routes.map((r, n) =>
                    n === i ? { ...r, path: new URL(route.url).pathname } : r,
                  ),
                })
              }
            >
              Oorspronkelijk pad van route {i + 1} gebruiken
            </button>
          </div>
        ))}
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Optionele oorspronkelijke tekst en diagnose</legend>
        {(
          [
            ['findingText', 'Bevindingsteksten opnemen'],
            ['scanNotes', 'Scanredenen en beperkingen opnemen'],
            ['scenarioLabels', 'Scenariolabels opnemen'],
            [
              'diagnostics',
              'Technische diagnose opnemen (pixelsamples en elementaanwijzingen)',
            ],
          ] as const
        ).map(([field, label]) => (
          <label className="check-label" key={field}>
            <input
              type="checkbox"
              checked={redaction[field]}
              onChange={(e) =>
                edit({ ...redaction, [field]: e.target.checked })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    </>
  );
}
