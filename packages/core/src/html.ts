import { auditReportSchema, type AuditReport } from './report.js';
import { captureWindowSummary, captureDetailSummary } from './quality.js';
import { renderCoverage } from './coverage.js';
import {
  diagnosticStyles,
  renderFindingDiagnostics,
  transitionSummary,
} from './diagnostics.js';
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (value) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        value
      ]!,
  );
/** A static export of precisely the authorized snapshot, with no client code/assets. */
export function renderSnapshotHtml(input: AuditReport): string {
  const report = auditReportSchema.parse(input);
  const routes = report.routes
    .map(
      (route, routeIndex) =>
        `<section aria-labelledby="route-${routeIndex}"><h2 id="route-${routeIndex}">${escape(route.url)}</h2><p>${escape(route.status)} · ${escape(route.reason)}</p>${renderCoverage(route.coverage)}${
          route.scenarios
            .map((scenario, scenarioIndex) => {
              const q = scenario.quality;
              const windowSummary = captureWindowSummary(q);
              const duration = Math.max(
                1,
                Date.parse(scenario.endedAt) - Date.parse(scenario.startedAt),
              );
              return `<section aria-labelledby="scenario-${routeIndex}-${scenarioIndex}"><h3 id="scenario-${routeIndex}-${scenarioIndex}">${escape(scenario.type)}</h3><p>${escape(scenario.startedAt)} – ${escape(scenario.endedAt)}</p><p>${q.frameCount} frames · ${q.effectiveFps.toFixed(1)} fps · grootste meetgat ${q.maxGapMs.toFixed(1)} ms · ${q.width} × ${q.height} pixels · verkleind: ${q.downsampled ? 'ja' : 'nee'} · onderbroken: ${q.interrupted ? 'ja' : 'nee'}</p>${windowSummary ? `<p>${escape(windowSummary)}</p>` : ''}${captureDetailSummary(q) ? `<p>${escape(captureDetailSummary(q))}</p>` : ''}${
                scenario.findings.length
                  ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Bevindingen"><table><caption>Statische tijdslijn; seconden vanaf het eerste geanalyseerde frame in deze observatie. Oppervlak en regio betreffen het analysebeeld, eventueel verkleind, en zijn geen normatieve gezichtsveldmeting.</caption><thead><tr><th scope="col">Kandidaat</th><th scope="col">Periode</th><th scope="col">Detectievenster</th><th scope="col">Oppervlak en regio</th><th scope="col">Toelichting</th></tr></thead><tbody>${scenario.findings
                      .map((finding) => {
                        const left = Math.max(
                          0,
                          Math.min(100, (finding.startMs / duration) * 100),
                        );
                        const width = Math.max(
                          0,
                          Math.min(
                            100 - left,
                            ((finding.endMs - finding.startMs) / duration) *
                              100,
                          ),
                        );
                        const region = finding.region;
                        return `<tr><th scope="row">${escape(finding.type)}<br>${escape(finding.reviewStatus)}</th><td>${(finding.startMs / 1000).toFixed(2)}–${(finding.endMs / 1000).toFixed(2)} s<span class="timeline" aria-hidden="true"><i style="margin-left:${left}%;width:${width}%"></i></span></td><td>${escape(transitionSummary(finding))}</td><td>${(finding.affectedRatio * 100).toFixed(2)}%${region ? `<br>x ${region.x}, y ${region.y}; ${region.width} × ${region.height} analysepixels` : '<br>Geen regio vastgelegd'}</td><td>${escape(finding.message)}${renderFindingDiagnostics(finding)}</td></tr>`;
                      })
                      .join('')}</tbody></table></div>`
                  : '<p>Geen kandidaten geregistreerd in deze meetreeks. Dit is geen veiligheidsverklaring.</p>'
              }</section>`;
            })
            .join('') || '<p>Geen gemeten scenario beschikbaar.</p>'
        }</section>`,
    )
    .join('');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>epi-less — ${escape(report.origin)}</title><style>${diagnosticStyles}html{background:#fff;color:#172b28;font:16px/1.5 system-ui,sans-serif}body{max-width:1000px;margin:auto;padding:24px}h1,h2,h3{line-height:1.25}h1{font-size:1.7rem}h2{font-size:1.2rem;border-top:1px solid #a8b6b2;padding-top:24px}h3{font-size:1rem}p,li,td,th{overflow-wrap:anywhere}a{color:#005e4b}a:focus-visible,.table-wrap:focus-visible{outline:3px solid #005e4b;outline-offset:3px}.notice{border-left:4px solid #566d2c;padding:12px;background:#f4f6ed}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:.85rem}th,td{border:1px solid #a8b6b2;padding:8px;text-align:left;vertical-align:top}caption{text-align:left;padding:8px 0}.timeline{display:block;width:100px;height:8px;background:#e6ebe9;margin-top:8px}.timeline i{display:block;height:8px;background:#385a50}footer{font-size:.85rem;margin-top:24px}@media(max-width:600px){body{padding:16px}}@media print{body{padding:0;max-width:none;font-size:10pt}.skip{display:none}.table-wrap{overflow:visible}tr{break-inside:avoid}h2,h3{break-after:avoid}thead{display:table-header-group}}</style></head><body><a class="skip" href="#report">Naar het rapport</a><header><p>epi-less · geëxporteerde rapportsnapshot</p><h1>${escape(report.origin)}</h1></header><main id="report" tabindex="-1"><p class="notice"><strong>${escape(report.status)}</strong> · Geen gevalideerd WCAG-oordeel of veiligheidsgarantie. Deze export bevat geen scripts, video, audio of externe bestanden.</p><p>Audit ${escape(report.id)} · ${escape(report.startedAt)} – ${escape(report.endedAt)}</p><p>Uitvoering: ${escape(report.job.state)} · ${escape(report.job.stopReason)}. ${report.job.visitedRoutes} van ${report.job.discoveredRoutes} ontdekte routes bezocht. Een bezoek bewijst geen volledige meting; de scenario's hieronder tonen het werkelijke meetbereik.</p><p>Engine ${escape(report.engineVersion)} · runner ${escape(report.runnerVersion)} · rapportschema ${report.schemaVersion}</p>${report.scannerBuildSha256 ? `<details><summary>Exacte scannerbuild</summary><p>Bron- en dependencyhash: <code>${escape(report.scannerBuildSha256)}</code></p></details>` : ''}${routes}<h2>Criteria en vervolgstappen</h2><p>Algemene en rode flitskandidaten vragen beoordeling van frequentie, kleur, oppervlak en meetkwaliteit in het kader van WCAG 2.3.1. Controleer de genoemde scenario's, verminder flitsende effecten en herhaal de meting na wijzigingen. Een ontbrekende waarneming bewijst niet dat een probleem is opgelost.</p><h2>Meetbeperkingen</h2><ul>${report.limitations.map((value) => `<li>${escape(value)}</li>`).join('')}</ul></main><footer>Dit bestand bevat uitsluitend de geselecteerde rapportsnapshot. Een gedownloade kopie wordt niet bijgewerkt bij intrekking. Afdrukken naar papier of PDF kan met de afdrukfunctie van de browser.</footer></body></html>`;
}
