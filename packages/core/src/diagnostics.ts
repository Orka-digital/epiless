import type { Finding, PixelDiagnostic, SourceDiagnostic } from './report.js';

import { renderSourceTimeline } from './diagnostic-timeline.js';

import { escape, fixed } from './diagnostic-format.js';
import type { SpatialEvidence } from './spatial.js';

const linear = (byte: number) => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** One representative pixel, not the whole component or an inferred source. */
export function diagnosticSeries(diagnostic: PixelDiagnostic) {
  return diagnostic.samples.map((sample) => {
    const r = linear(sample.red),
      g = linear(sample.green),
      b = linear(sample.blue);
    const sum = r + g + b;
    return {
      time: sample.timestampMs,
      luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b,
      redRatio: sum > 0 ? r / sum : 0,
    };
  });
}

/** Describe the recorded transition count, preserving the historical counting distinction. */
export function transitionSummary(finding: Finding): string {
  return finding.qualifyingTransitions !== undefined
    ? `Minstens ${finding.qualifyingTransitions} kwalificerende overgangen in het detectievenster`
    : `${finding.flashesInWindow} omkeerparen in het venster (historische telling)`;
}

/** Render escaped spatial evidence and its geometry assumptions without asserting conformance. */
export function renderSpatialEvidence(spatial: SpatialEvidence): string {
  const field = spatial.visualField;
  return `<section><h4>Gelijktijdig gemeten oppervlak</h4><p>Op ${fixed(spatial.sampledAtMs / 1000)} s kwalificeerden ${spatial.simultaneousPixels} pixels in hetzelfde analyseframe (${fixed(spatial.simultaneousRatio * 100)}% van ${spatial.analysisWidth} × ${spatial.analysisHeight} pixels). Deze component telt ${spatial.componentPixels} pixels. Losse regio's worden samengeteld op basis van het pixelmasker; de omhullende rechthoek is geen oppervlaktemaat. Bij samengevoegde waarnemingen blijft het frame met het grootste veldoppervlak bewaard, of zonder veld het grootste aantal gelijktijdige pixels. Het meetspoor en de bronkoppeling kunnen het eerdere, eerste detectievenster beschrijven.</p>${field ? `<p>Binnen het vermelde referentieveld van ${field.widthPx} × ${field.heightPx} analysepixels bedraagt het grootste gelijktijdige oppervlak ${field.maximumPixels} pixels (${fixed(field.maximumRatio * 100)}%). Dit ${field.exceedsThreshold ? 'overschrijdt' : 'overschrijdt niet'} de 25%-drempel binnen deze geometrie. Referentie: ${escape(field.reference)} (${escape(field.basis)}). Deze invoeraanname bewijst geen werkelijke kijkafstand of conformiteit van de website.</p>` : '<p>Geen bruikbaar gezichtsveld of referentieveld beschikbaar. Het aandeel van het analysebeeld is geen normatief gezichtsveld en levert geen WCAG-oppervlakteoordeel op.</p>'}<p>${spatial.pattern.kind === 'EXACT_BALANCED_CHECKERBOARD' ? `Schaakbord met twee kleuren en gelijke oppervlakken in dit frame aangetoond, cellen ${spatial.pattern.cellWidthPx} × ${spatial.pattern.cellHeightPx} analysepixels.${spatial.pattern.belowPointOneDegree !== undefined ? ` Binnen de opgegeven geometrie zijn die cellen ${spatial.pattern.belowPointOneDegree ? 'kleiner dan' : 'niet kleiner dan'} 0,1 graad.` : ''}` : 'Geen exact schaakbord met gelijke kleuroppervlakken aangetoond.'} ${spatial.pattern.inversePhase ? `Tussen ${fixed(spatial.pattern.inversePhase.previousSampledAtMs / 1000)} en ${fixed(spatial.pattern.inversePhase.currentSampledAtMs / 1000)} s wisselden dezelfde twee ondoorzichtige kleuren exact op alle ${spatial.pattern.inversePhase.comparedPixels} componentpixels, met ${spatial.pattern.inversePhase.firstColorPixels} pixels per kleur. Dit bewijst uitsluitend deze twee opeenvolgende geanalyseerde bronframes, geen balans over de volledige flitsperiode.` : 'Geen exacte kleuromkering tussen twee opeenvolgende geanalyseerde bronframes aangetoond; één ruimtelijk gebalanceerd frame bewijst geen temporele balans.'} ${spatial.motion.kind === 'EXACT_TRANSLATION_COMPATIBLE' ? `De pixels passen exact bij een verschuiving (${spatial.motion.dx}, ${spatial.motion.dy}) over ${spatial.motion.comparedPixels} vergeleken pixels. Dit is verenigbaar met beweging; een periodiek patroon kan dezelfde overeenkomst geven.` : 'Geen exacte translatie aangetoond binnen de begrensde bewegingszoektocht.'} Patronen en beweging sluiten kandidaten niet automatisch uit.</p></section>`;
}

function renderSource(source: SourceDiagnostic): string {
  const candidates = source.candidates
    .map(
      (c) =>
        `<li><strong>${escape(c.tag)}${c.media ? ` · ${escape(c.media)}` : ''}</strong> · ${c.hitCount}/${source.sampledPoints} steekproefpunten · ${c.animation.running} lopende animaties<br><code>${c.selectorPath.map(escape).join(' → shadow root → ')}</code><br>CSS-regio: x ${fixed(c.rect.x)}, y ${fixed(c.rect.y)}, ${fixed(c.rect.width)} × ${fixed(c.rect.height)} px.</li>`,
    )
    .join('');
  return `<section><h4>Mogelijke elementen op deze locatie</h4><p>Ruimtelijke aanwijzing na de observatie; geen bewezen oorzaak van de gemeten flits. De pagina kan tussentijds veranderd zijn. Een positioneel DOM-pad beschrijft de structuur op het inspectiemoment. Volg elke nth-child-index vanaf de root via directe kinderen; steek bij een pijl de open shadow root over. Dit is geen selector voor querySelector.</p><p>${source.status === 'MAPPED' ? `${source.sampledPoints} punten onderzocht` : `Koppeling niet beschikbaar: ${escape(source.reason ?? 'onbekend')}`} · ${fixed(source.delayMs)} ms na het einde van de meting · ${escape(source.sampledAt)}.</p>${source.viewport ? `<p>Viewport ${source.viewport.width} × ${source.viewport.height} CSS-pixels · DPR ${source.viewport.dpr} · scroll ${fixed(source.viewport.scrollX)}, ${fixed(source.viewport.scrollY)}.</p>` : ''}${candidates ? `<ul>${candidates}</ul>` : '<p>Geen elementaanwijzingen opgeslagen.</p>'}<details><summary>Beperkingen van de elementaanwijzingen</summary><ul>${source.limitations.map((v) => `<li>${escape(v)}</li>`).join('')}</ul></details></section>`;
}

/** Static, escaped markup for local UI, Astro and offline HTML. No media or scripts. */
export function renderFindingDiagnostics(finding: Finding): string {
  const diagnostic = finding.diagnostic;
  if (
    !diagnostic &&
    !finding.source &&
    !finding.sourceTimeline &&
    !finding.spatial
  )
    return '';
  let trace = '';
  if (diagnostic) {
    const series = diagnosticSeries(diagnostic);
    const start = series[0].time,
      end = series.at(-1)!.time;
    const span = Math.max(1, end - start);
    const path = (kind: 'luminance' | 'redRatio') =>
      series
        .map(
          (s, i) =>
            `${i ? 'L' : 'M'}${fixed(36 + ((s.time - start) / span) * 340)} ${fixed(132 - s[kind] * 104)}`,
        )
        .join(' ');
    const ys = series.map((s) => s.luminance);
    const region = finding.region;
    // Numeric attributes are still escaped: reports may originate from imports.
    const x = (v: number) => fixed((v / diagnostic.analysisWidth) * 320);
    const y = (v: number) => fixed((v / diagnostic.analysisHeight) * 180);
    trace = `<section><h4>Meetspoor van één analysepixel</h4><p>${escape(transitionSummary(finding))}. Eerste detectievenster ${fixed(diagnostic.windowStartMs / 1000)}–${fixed(diagnostic.windowEndMs / 1000)} s; tijden vanaf het eerste geanalyseerde frame. Latere waarnemingen kunnen in dezelfde kandidaat samengevoegd zijn.</p><svg viewBox="0 0 400 166" width="400" role="img" aria-label="Statisch meetspoor: relatieve luminantie en aandeel rood, beide van nul tot één" class="diagnostic-trace"><rect x="36" y="28" width="340" height="104" fill="#f5f7f6" stroke="#7e918b"/><path d="M36 80H376" stroke="#b9c6c1" stroke-dasharray="3 3"/><text x="10" y="32" fill="currentColor" font-size="12">1</text><text x="10" y="136" fill="currentColor" font-size="12">0</text><path d="${path('luminance')}" fill="none" stroke="#185f50" stroke-width="2"/><path d="${path('redRatio')}" fill="none" stroke="#684b91" stroke-width="1.5" stroke-dasharray="4 3"/><text x="36" y="156" fill="currentColor" font-size="12">${fixed(start / 1000)} s</text><text x="376" y="156" text-anchor="end" fill="currentColor" font-size="12">${fixed(end / 1000)} s</text></svg><p>Lijnen verbinden de opgeslagen samples; tussenliggende waarden zijn niet gemeten. Groen, doorgetrokken: relatieve luminantie Y. Paars, gestreept: R/(R+G+B), met gelineariseerde sRGB-kanalen (bij zwart: 0). Het aandeel rood alleen bepaalt geen rode flits; de detector controleert ook de kleurafstand.</p><p>${series.length} echte pixelsamples · luminantie ${fixed(Math.min(...ys), 3)}–${fixed(Math.max(...ys), 3)} · ${diagnostic.complete ? 'detectievenster en voorafgaand sample bewaard' : 'onvolledig meetspoor; zie ontbrekende context'}.</p><svg viewBox="0 0 320 180" width="320" role="img" aria-label="Schematische kandidaatregio in het analyseframe; de stip is de meetpixel" class="diagnostic-region"><rect x="0.5" y="0.5" width="319" height="179" fill="#f5f7f6" stroke="#7e918b"/>${region ? `<rect x="${x(region.x)}" y="${y(region.y)}" width="${x(region.width)}" height="${y(region.height)}" fill="#d8e7df" stroke="#185f50"/>` : ''}<circle cx="${x(diagnostic.point.x + 0.5)}" cy="${y(diagnostic.point.y + 0.5)}" r="3" fill="#172b28"/></svg><p>Meetpixel (${diagnostic.point.x}, ${diagnostic.point.y}) · analyse ${diagnostic.analysisWidth} × ${diagnostic.analysisHeight} px · bron ${diagnostic.sourceWidth} × ${diagnostic.sourceHeight} px. De rechthoek begrenst de kandidaat; niet alle pixels erin hoeven te flitsen. Dit schema bevat geen screenshot en is geen normatieve gezichtsveldmeting.</p>${diagnostic.omissions?.length ? `<ul>${diagnostic.omissions.map((v) => `<li>${escape(v)}</li>`).join('')}</ul>` : ''}<details><summary>Ruwe pixelsamples bekijken</summary><div class="diagnostic-table" tabindex="0" role="region" aria-label="Ruwe pixelsamples"><table><caption>Analysepixel: tijd in ms en sRGB-kanalen van 0 tot 255</caption><thead><tr><th scope="col">Tijd</th><th scope="col">R</th><th scope="col">G</th><th scope="col">B</th></tr></thead><tbody>${diagnostic.samples.map((s) => `<tr><td>${fixed(s.timestampMs)}</td><td>${s.red}</td><td>${s.green}</td><td>${s.blue}</td></tr>`).join('')}</tbody></table></div></details></section>`;
  }
  return `<details class="finding-diagnostics"><summary>Technische diagnose bekijken</summary>${trace}${finding.spatial ? renderSpatialEvidence(finding.spatial) : ''}${finding.sourceTimeline ? renderSourceTimeline(finding.sourceTimeline) : ''}${finding.source ? renderSource(finding.source) : '<p>Geen elementaanwijzingen achteraf beschikbaar bij deze meting.</p>'}</details>`;
}

/** Reused by script-free standalone exports; applications load equivalent external CSS. */
export const diagnosticStyles =
  '.finding-diagnostics{margin-top:12px;min-width:0}.finding-diagnostics summary{cursor:pointer}.finding-diagnostics section{margin:16px 0}.finding-diagnostics code{overflow-wrap:anywhere;white-space:normal}.diagnostic-trace,.diagnostic-region{display:block;width:100%;height:auto}.diagnostic-trace{max-width:520px}.diagnostic-region{max-width:320px}.diagnostic-table{overflow:auto;max-width:100%}.diagnostic-table:focus-visible{outline:3px solid #185f50;outline-offset:2px}';

export {
  copyDiagnostics,
  copySourceTimeline,
  copySpatialEvidence,
} from './diagnostic-copy.js';

export { escape, fixed } from './diagnostic-format.js';
export { sourceRepairClues } from './diagnostic-timeline.js';
