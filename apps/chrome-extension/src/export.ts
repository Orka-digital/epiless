import { normalizePublicUrl, renderCoverage } from '@epi-less/core';
import {
  captureWindowSummary,
  captureDetailSummary,
} from '@epi-less/core/quality';
import {
  diagnosticStyles,
  renderFindingDiagnostics,
  transitionSummary,
} from '@epi-less/core/diagnostics';
import { historySummary, candidateSummaries } from './history';
import type { ScanJob, HistorySettings } from './model';
import { buildReport } from './report';

export function prepareExportJobs(
  jobs: readonly ScanJob[],
  pseudonymize = false,
): ScanJob[] {
  const copies = structuredClone([...jobs]);
  if (!pseudonymize) return copies;
  const origins = new Map<string, string>();
  const routes = new Map<string, string>();
  const candidateKeys = new Map<string, string>();
  const mask = (value: string) => {
    const original = new URL(normalizePublicUrl(value));
    if (!origins.has(original.origin))
      origins.set(original.origin, `https://site-${origins.size + 1}.invalid`);
    if (!routes.has(original.href))
      routes.set(
        original.href,
        `${origins.get(original.origin)}/route-${routes.size + 1}`,
      );
    return routes.get(original.href)!;
  };
  for (const job of copies) {
    const summaries = candidateSummaries(job);
    const originalOrigin = job.origin;
    job.startUrl = mask(job.startUrl);
    delete job.replayTarget;
    delete job.disposableSource;
    if (job.reviews)
      job.reviews = job.reviews.map((review) => ({
        ...review,
        note: 'Review text omitted for pseudonymized export.',
      }));
    job.origin = origins.get(originalOrigin)!;
    job.stopReason = 'Diagnostic text removed for pseudonymized export.';
    job.limitations = [
      'PSEUDONYMIZED_EXPORT: origins, routes and diagnostic text were replaced. Mapping is not included. Dates, measurements and capture quality remain identifying context; this is not guaranteed anonymity.',
      'Experimental heuristic capture; no normative conformance or site-wide safety claim.',
    ];
    job.retainedCandidates = summaries.map((candidate) => {
      if (!candidateKeys.has(candidate.key))
        candidateKeys.set(candidate.key, `candidate-${candidateKeys.size + 1}`);
      return {
        ...candidate,
        key: candidateKeys.get(candidate.key)!,
        route: mask(candidate.route),
      };
    });
    for (const task of job.tasks) {
      task.url = mask(task.url);
      if (task.navigationSource)
        task.navigationSource = mask(task.navigationSource);
      if (task.aliases) task.aliases = task.aliases.map(mask);
      task.reasons = task.reasons.length
        ? ['Original diagnostic text omitted.']
        : [];
      for (const observation of task.observations) {
        delete observation.replay;
        delete observation.mediaEvidence;
        delete observation.phaseEvidence;
        if (observation.reason)
          observation.reason = 'Original diagnostic text omitted.';
        if (observation.navigation)
          observation.navigation = {
            from: mask(observation.navigation.from),
            to: mask(observation.navigation.to),
          };
        if (observation.measurement) {
          observation.measurement.limitations = [
            'Original diagnostic text omitted. Capture quality remains below.',
          ];
          for (const finding of observation.measurement.findings) {
            finding.message = `${finding.type} candidate; human review required.`;
            delete finding.diagnostic;
            delete finding.source;
            delete finding.sourceTimeline;
          }
        }
      }
    }
  }
  return copies;
}

export function buildHistoryExport(
  jobs: readonly ScanJob[],
  settings: HistorySettings,
  scope: 'SITE' | 'ALL',
  pseudonymize = false,
) {
  const copies = prepareExportJobs(jobs, pseudonymize);
  return {
    schemaVersion: 1,
    kind: 'FLASHGUARD_LOCAL_HISTORY',
    exportedAt: new Date().toISOString(),
    scope,
    pseudonymized: pseudonymize,
    settings,
    sites: historySummary(copies),
    audits: copies.map((job) => ({
      report: buildReport(job),
      mode: job.mode,
      viewportDurationMs:
        job.viewportDurationMs ?? (job.mode === 'EXTENDED' ? 30_000 : 15_000),
      detailsExpiredAt: job.detailsExpiredAt ?? null,
      candidates: candidateSummaries(job),
      reviews: job.reviews ?? [],
      verificationOf: job.verificationOf ?? null,
      viewports: job.tasks
        .filter((task) => task.viewport)
        .map((task) => ({ route: task.url, ...task.viewport })),
      navigation: job.tasks.flatMap((task) =>
        task.observations
          .filter((observation) => observation.navigation)
          .map((observation) => ({
            scenarioId: observation.id,
            ...observation.navigation,
          })),
      ),
    })),
  };
}

const escape = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
const ms = (value: number) => `${(value / 1000).toFixed(2)} s`;

/** Offline, script-free report. Every content value is escaped; no media or external assets. */
export function buildHtmlReport(source: ScanJob, pseudonymize = false): string {
  const job = prepareExportJobs([source], pseudonymize)[0];
  const report = buildReport(job);
  const summary = historySummary([job])[0];
  const routes = report.routes
    .map((route, index) => {
      const task = job.tasks[index];
      const observations = route.scenarios
        .map((scenario) => {
          const local = task.observations.find(
            (observation) => observation.id === scenario.id,
          );
          const duration = Math.max(
            1,
            Date.parse(scenario.endedAt) - Date.parse(scenario.startedAt),
          );
          const findings = scenario.findings
            .map((finding) => {
              const left = Math.max(
                0,
                Math.min(100, (finding.startMs / duration) * 100),
              );
              const width = Math.max(
                0.5,
                Math.min(
                  100 - left,
                  ((finding.endMs - finding.startMs) / duration) * 100,
                ),
              );
              return `<tr><th scope="row">${escape(finding.type)}</th><td>${ms(finding.startMs)}–${ms(finding.endMs)}<span class="timeline" aria-hidden="true"><i style="margin-left:${left}%;width:${width}%"></i></span></td><td>${escape(transitionSummary(finding))}</td><td>${(finding.affectedRatio * 100).toFixed(2)}%${finding.region ? `<br>Regio in analysepixels: x ${escape(finding.region.x)}, y ${escape(finding.region.y)}, breedte ${escape(finding.region.width)}, hoogte ${escape(finding.region.height)}. Begrenzing van een kandidaat; geen CSS-element of normatief visueel veld.` : '<br>Geen ruimtelijke begrenzing beschikbaar.'}</td><td>${escape(finding.message)}<br>NEEDS_REVIEW${renderFindingDiagnostics(finding)}</td></tr>`;
            })
            .join('');
          const quality = scenario.quality;
          const windowSummary = captureWindowSummary(quality);
          return `<section aria-labelledby="scenario-${index}-${escape(scenario.id)}"><h4 id="scenario-${index}-${escape(scenario.id)}">${escape(scenario.type)}</h4><p>${escape(scenario.startedAt)} – ${escape(scenario.endedAt)}</p>${local?.navigation ? `<p><strong>Navigatieovergang:</strong> ${escape(local.navigation.from)} → ${escape(local.navigation.to)}. Bevat ook beelden van de vorige pagina; bronattributie is niet bevestigd.</p>` : ''}<p>${quality.frameCount} frames · ${quality.effectiveFps.toFixed(1)} fps · grootste meetgat ${quality.maxGapMs.toFixed(1)} ms · ${quality.width} × ${quality.height} analysepixels · verkleind: ${quality.downsampled ? 'ja' : 'nee'} · onderbroken: ${quality.interrupted ? 'ja' : 'nee'}</p>${windowSummary ? `<p>${escape(windowSummary)}</p>` : ''}${captureDetailSummary(quality) ? `<p>${escape(captureDetailSummary(quality))}</p>` : ''}<p>Regiocoördinaten verwijzen naar het analysebeeld${quality.downsampled ? '; dit is een verkleinde weergave van de bron' : ''}. Ze identificeren geen DOM-element en vormen geen normatieve oppervlaktemeting.</p>${local?.reason ? `<p>${escape(local.reason)}</p>` : ''}${findings ? `<div class="table-wrap"><table><caption>Statische tijdslijn van waargenomen kandidaten; tijden vanaf het eerste geanalyseerde frame in deze observatie</caption><thead><tr><th scope="col">Type</th><th scope="col">Periode</th><th scope="col">Detectievenster</th><th scope="col">Beeldoppervlak</th><th scope="col">Bevinding</th></tr></thead><tbody>${findings}</tbody></table></div>` : `<p>${job.detailsExpiredAt ? 'Meetdetails zijn volgens het bewaarbeleid verlopen. De kandidaatstatistieken blijven bewaard.' : 'Geen kandidaten geregistreerd in deze meetreeks. Dit is geen conformiteits- of veiligheidsverklaring.'}</p>`}</section>`;
        })
        .join('');
      return `<section class="route" aria-labelledby="route-${index}"><h3 id="route-${index}">${escape(route.url)}</h3><p>Status: ${escape(route.status)}${route.reason ? ` · ${escape(route.reason)}` : ''}</p>${renderCoverage(route.coverage)}${observations || '<p>Geen meetreeks beschikbaar.</p>'}</section>`;
    })
    .join('');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>epi-less rapport — ${escape(report.origin)}</title><style>${diagnosticStyles}html{color:#172b28;background:#fff;font:16px/1.55 system-ui,sans-serif}body{max-width:1000px;margin:auto;padding:32px}h1,h2,h3,h4{line-height:1.25}h1{font-size:1.8rem}h2{font-size:1.4rem;border-bottom:1px solid #b5c2be;padding-bottom:8px}h3{font-size:1.15rem}h4{font-size:1rem}a{color:#005d4a}a:focus-visible{outline:3px solid #005d4a;outline-offset:3px}p,li,th,td{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(120px,1fr) 2fr;gap:8px}dt{font-weight:600}dd{margin:0}.notice{border-left:4px solid #697d35;padding:12px;background:#f4f6ed}.route{border-bottom:1px solid #b5c2be;padding:12px 0 24px}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.85rem}caption{text-align:left;margin:12px 0;font-weight:600}th,td{border:1px solid #b5c2be;text-align:left;vertical-align:top;padding:8px}.timeline{display:block;min-width:100px;height:8px;background:#e8ecea;margin-top:5px}.timeline i{display:block;height:8px;background:#455d57}.skip{display:block}footer{font-size:.85rem;margin-top:28px}@media(max-width:600px){body{padding:16px}dl{grid-template-columns:1fr}dd{margin-bottom:8px}}@media print{body{max-width:none;padding:0;font-size:10pt}.skip{display:none}h2,h3,h4,caption{break-after:avoid}tr{break-inside:avoid}.table-wrap{overflow:visible}thead{display:table-header-group}table{font-size:8pt}.notice{background:none}}</style></head><body><a class="skip" href="#results">Naar de meetresultaten</a><header><p>epi-less · lokaal auditrapport</p><h1>${escape(report.origin)}</h1><p>${escape(report.startedAt)} – ${escape(report.endedAt)}</p></header><main><p class="notice"><strong>${escape(report.status)}</strong> · Geen gevalideerd WCAG-oordeel en geen veiligheidsgarantie. Dit rapport bevat geen video, geluid, scripts of automatisch afspelende beelden.</p><h2>Scope en uitvoering</h2><dl><dt>Audit</dt><dd>${escape(report.id)}</dd><dt>Modus</dt><dd>${escape(job.mode)}${job.mode !== 'AUTONOMOUS' ? ` · alleen de huidige viewport · ${(job.viewportDurationMs ?? (job.mode === 'EXTENDED' ? 30_000 : 15_000)) / 1000} seconden` : ''}</dd><dt>Job</dt><dd>${escape(report.job.state)} · ${escape(report.job.stopReason)}</dd><dt>Dekking</dt><dd>${report.job.visitedRoutes} van ${report.job.discoveredRoutes} ontdekte routes; ${summary.scenarios} scenario's. Onbekende routes blijven buiten deze telling.</dd><dt>Kandidaten</dt><dd>${summary.uniqueCandidates} gegroepeerde kandidaten; ${summary.occurrences} waarnemingen. Geen bevestigde overtredingen.</dd><dt>Engine / runner</dt><dd>${escape(report.engineVersion)} / ${escape(report.runnerVersion)}</dd>${report.scannerBuildSha256 ? `<dt>Scannerbuild</dt><dd><code>${escape(report.scannerBuildSha256)}</code></dd>` : ''}<dt>Meetdetails</dt><dd>${job.detailsExpiredAt ? `Verlopen op ${escape(job.detailsExpiredAt)}; compacte geschiedenis bewaard.` : 'Beschikbaar in dit rapport.'}</dd></dl><p>${escape(summary.grouping)}</p><h2 id="results" tabindex="-1">Meetresultaten</h2>${routes}<h2>Criteria en vervolgstappen</h2><p>GENERAL_FLASH en RED_FLASH zijn technische kandidaten voor beoordeling in het kader van WCAG 2.3.1. Flitsfrequentie, oppervlak, kleur, capturekwaliteit en geteste scope moeten samen worden beoordeeld. ANIMATION_CONTROL is uitsluitend een aanwijzing voor beoordeling van bediening van bewegende inhoud, geen normatief oordeel.</p><ul><li>Onderzoek kandidaten in de genoemde route en het scenario; vermijd onbeveiligd afspelen van verdachte inhoud.</li><li>Verminder of verwijder flitsende effecten en bied bediening om bewegende inhoud te pauzeren of stoppen.</li><li>Herhaal een meting onder vergelijkbare omstandigheden na een wijziging. Niet opnieuw waargenomen betekent niet automatisch opgelost.</li><li>Laat een normatieve beoordeling uitvoeren voordat je conformiteit claimt.</li></ul><h2>Meetbeperkingen</h2><ul>${report.limitations.map((limitation) => `<li>${escape(limitation)}</li>`).join('')}</ul></main><footer>Rapportschema ${report.schemaVersion} · Gebruik de afdrukfunctie van je browser voor een papieren versie of PDF. Deze export wordt niet bijgewerkt bij intrekking van een online rapport.</footer></body></html>`;
}
