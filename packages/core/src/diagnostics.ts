import type { Finding, PixelDiagnostic, SourceDiagnostic } from './report.js';
import type { SourceTimeline } from './source-timeline-schema.js';
import type { SpatialEvidence } from './spatial.js';

const escape = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
const fixed = (value: number, digits = 2) => escape(value.toFixed(digits));
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

export function transitionSummary(finding: Finding): string {
  return finding.qualifyingTransitions !== undefined
    ? `Minstens ${finding.qualifyingTransitions} kwalificerende overgangen in het detectievenster`
    : `${finding.flashesInWindow} omkeerparen in het venster (historische telling)`;
}

/** Deep allowlist for optional public diagnostics. Never propagate local-only fields. */
export function copyDiagnostics(
  finding: Finding,
): Pick<Finding, 'diagnostic' | 'source' | 'sourceTimeline' | 'spatial'> {
  const rect = (r: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const d = finding.diagnostic,
    s = finding.source;
  return {
    ...(d
      ? {
          diagnostic: {
            version: d.version,
            coordinateSpace: d.coordinateSpace,
            point: { x: d.point.x, y: d.point.y },
            analysisWidth: d.analysisWidth,
            analysisHeight: d.analysisHeight,
            sourceWidth: d.sourceWidth,
            sourceHeight: d.sourceHeight,
            windowStartMs: d.windowStartMs,
            windowEndMs: d.windowEndMs,
            complete: d.complete,
            samples: d.samples.map((v) => ({
              timestampMs: v.timestampMs,
              red: v.red,
              green: v.green,
              blue: v.blue,
            })),
            ...(d.omissions ? { omissions: [...d.omissions] } : {}),
          },
        }
      : {}),
    ...(s
      ? {
          source: {
            status: s.status,
            ...(s.reason ? { reason: s.reason } : {}),
            coordinateSpace: s.coordinateSpace,
            sampledAt: s.sampledAt,
            delayMs: s.delayMs,
            ...(s.viewport
              ? {
                  viewport: {
                    width: s.viewport.width,
                    height: s.viewport.height,
                    dpr: s.viewport.dpr,
                    scrollX: s.viewport.scrollX,
                    scrollY: s.viewport.scrollY,
                  },
                }
              : {}),
            sampledPoints: s.sampledPoints,
            ...(s.region ? { region: rect(s.region) } : {}),
            candidates: s.candidates.map((v) => ({
              selectorPath: [...v.selectorPath],
              tag: v.tag,
              rect: rect(v.rect),
              hitCount: v.hitCount,
              ...(v.media ? { media: v.media } : {}),
              animation: {
                running: v.animation.running,
                paused: v.animation.paused,
                finished: v.animation.finished,
              },
            })),
            limitations: [...s.limitations],
          },
        }
      : {}),
    ...(finding.sourceTimeline
      ? { sourceTimeline: copySourceTimeline(finding.sourceTimeline) }
      : {}),
    ...(finding.spatial
      ? { spatial: copySpatialEvidence(finding.spatial) }
      : {}),
  };
}

export function copySpatialEvidence(s: SpatialEvidence): SpatialEvidence {
  return {
    version: s.version,
    coordinateSpace: s.coordinateSpace,
    analysisWidth: s.analysisWidth,
    analysisHeight: s.analysisHeight,
    sampledAtMs: s.sampledAtMs,
    componentPixels: s.componentPixels,
    simultaneousPixels: s.simultaneousPixels,
    simultaneousRatio: s.simultaneousRatio,
    maskBasis: s.maskBasis,
    ...(s.visualField
      ? {
          visualField: {
            basis: s.visualField.basis,
            reference: s.visualField.reference,
            widthPx: s.visualField.widthPx,
            heightPx: s.visualField.heightPx,
            maximumPixels: s.visualField.maximumPixels,
            maximumRatio: s.visualField.maximumRatio,
            thresholdRatio: s.visualField.thresholdRatio,
            exceedsThreshold: s.visualField.exceedsThreshold,
            window: {
              x: s.visualField.window.x,
              y: s.visualField.window.y,
              width: s.visualField.window.width,
              height: s.visualField.window.height,
            },
          },
        }
      : {}),
    pattern: {
      kind: s.pattern.kind,
      automaticallyExcluded: false,
      ...(s.pattern.cellWidthPx !== undefined
        ? { cellWidthPx: s.pattern.cellWidthPx }
        : {}),
      ...(s.pattern.cellHeightPx !== undefined
        ? { cellHeightPx: s.pattern.cellHeightPx }
        : {}),
      ...(s.pattern.inversePhase
        ? {
            inversePhase: {
              kind: s.pattern.inversePhase.kind,
              previousSampledAtMs: s.pattern.inversePhase.previousSampledAtMs,
              currentSampledAtMs: s.pattern.inversePhase.currentSampledAtMs,
              comparedPixels: s.pattern.inversePhase.comparedPixels,
              firstColorPixels: s.pattern.inversePhase.firstColorPixels,
              secondColorPixels: s.pattern.inversePhase.secondColorPixels,
            },
          }
        : {}),
      ...(s.pattern.belowPointOneDegree !== undefined
        ? { belowPointOneDegree: s.pattern.belowPointOneDegree }
        : {}),
    },
    motion: {
      kind: s.motion.kind,
      automaticallyExcluded: false,
      ...(s.motion.dx !== undefined ? { dx: s.motion.dx } : {}),
      ...(s.motion.dy !== undefined ? { dy: s.motion.dy } : {}),
      ...(s.motion.comparedPixels !== undefined
        ? { comparedPixels: s.motion.comparedPixels }
        : {}),
      ...(s.motion.overlapRatio !== undefined
        ? { overlapRatio: s.motion.overlapRatio }
        : {}),
    },
  };
}

export function renderSpatialEvidence(spatial: SpatialEvidence): string {
  const field = spatial.visualField;
  return `<section><h4>Gelijktijdig gemeten oppervlak</h4><p>Op ${fixed(spatial.sampledAtMs / 1000)} s kwalificeerden ${spatial.simultaneousPixels} pixels in hetzelfde analyseframe (${fixed(spatial.simultaneousRatio * 100)}% van ${spatial.analysisWidth} × ${spatial.analysisHeight} pixels). Deze component telt ${spatial.componentPixels} pixels. Losse regio's worden samengeteld op basis van het pixelmasker; de omhullende rechthoek is geen oppervlaktemaat. Bij samengevoegde waarnemingen blijft het frame met het grootste veldoppervlak bewaard, of zonder veld het grootste aantal gelijktijdige pixels. Het meetspoor en de bronkoppeling kunnen het eerdere, eerste detectievenster beschrijven.</p>${field ? `<p>Binnen het vermelde referentieveld van ${field.widthPx} × ${field.heightPx} analysepixels bedraagt het grootste gelijktijdige oppervlak ${field.maximumPixels} pixels (${fixed(field.maximumRatio * 100)}%). Dit ${field.exceedsThreshold ? 'overschrijdt' : 'overschrijdt niet'} de 25%-drempel binnen deze geometrie. Referentie: ${escape(field.reference)} (${escape(field.basis)}). Deze invoeraanname bewijst geen werkelijke kijkafstand of conformiteit van de website.</p>` : '<p>Geen bruikbaar gezichtsveld of referentieveld beschikbaar. Het aandeel van het analysebeeld is geen normatief gezichtsveld en levert geen WCAG-oppervlakteoordeel op.</p>'}<p>${spatial.pattern.kind === 'EXACT_BALANCED_CHECKERBOARD' ? `Schaakbord met twee kleuren en gelijke oppervlakken in dit frame aangetoond, cellen ${spatial.pattern.cellWidthPx} × ${spatial.pattern.cellHeightPx} analysepixels.${spatial.pattern.belowPointOneDegree !== undefined ? ` Binnen de opgegeven geometrie zijn die cellen ${spatial.pattern.belowPointOneDegree ? 'kleiner dan' : 'niet kleiner dan'} 0,1 graad.` : ''}` : 'Geen exact schaakbord met gelijke kleuroppervlakken aangetoond.'} ${spatial.pattern.inversePhase ? `Tussen ${fixed(spatial.pattern.inversePhase.previousSampledAtMs / 1000)} en ${fixed(spatial.pattern.inversePhase.currentSampledAtMs / 1000)} s wisselden dezelfde twee ondoorzichtige kleuren exact op alle ${spatial.pattern.inversePhase.comparedPixels} componentpixels, met ${spatial.pattern.inversePhase.firstColorPixels} pixels per kleur. Dit bewijst uitsluitend deze twee opeenvolgende geanalyseerde bronframes, geen balans over de volledige flitsperiode.` : 'Geen exacte kleuromkering tussen twee opeenvolgende geanalyseerde bronframes aangetoond; één ruimtelijk gebalanceerd frame bewijst geen temporele balans.'} ${spatial.motion.kind === 'EXACT_TRANSLATION_COMPATIBLE' ? `De pixels passen exact bij een verschuiving (${spatial.motion.dx}, ${spatial.motion.dy}) over ${spatial.motion.comparedPixels} vergeleken pixels. Dit is verenigbaar met beweging; een periodiek patroon kan dezelfde overeenkomst geven.` : 'Geen exacte translatie aangetoond binnen de begrensde bewegingszoektocht.'} Patronen en beweging sluiten kandidaten niet automatisch uit.</p></section>`;
}

/** Explicit public allowlist: inspection capabilities and unknown nested fields never leave the profile. */
export function copySourceTimeline(timeline: SourceTimeline): SourceTimeline {
  return {
    version: timeline.version,
    status: timeline.status,
    ...(timeline.reason ? { reason: timeline.reason } : {}),
    clockBasis: timeline.clockBasis,
    windowStartEpochMs: timeline.windowStartEpochMs,
    windowEndEpochMs: timeline.windowEndEpochMs,
    alignmentUncertaintyMs: timeline.alignmentUncertaintyMs,
    ...(timeline.frameClock
      ? {
          frameClock: {
            method: timeline.frameClock.method,
            matchedFrames: timeline.frameClock.matchedFrames,
            receiptOffsetSpreadMs: timeline.frameClock.receiptOffsetSpreadMs,
            startBoundaryErrorMs: timeline.frameClock.startBoundaryErrorMs,
            endBoundaryErrorMs: timeline.frameClock.endBoundaryErrorMs,
          },
        }
      : {}),
    sampledAt: timeline.sampledAt,
    sampleIntervalMs: timeline.sampleIntervalMs,
    maxSampleGapMs: timeline.maxSampleGapMs,
    sampleCount: timeline.sampleCount,
    ...(timeline.firstSampleEpochMs !== undefined
      ? { firstSampleEpochMs: timeline.firstSampleEpochMs }
      : {}),
    ...(timeline.lastSampleEpochMs !== undefined
      ? { lastSampleEpochMs: timeline.lastSampleEpochMs }
      : {}),
    complete: timeline.complete,
    candidates: timeline.candidates.map((c) => ({
      id: c.id,
      selectorPath: [...c.selectorPath],
      tag: c.tag,
      ...(c.media ? { media: c.media } : {}),
      observations: c.observations.map((o) => ({
        atEpochMs: o.atEpochMs,
        ...(o.readWindow
          ? {
              readWindow: {
                startEpochMs: o.readWindow.startEpochMs,
                endEpochMs: o.readWindow.endEpochMs,
                trigger: o.readWindow.trigger,
                ...(o.readWindow.renderEpochMs !== undefined
                  ? { renderEpochMs: o.readWindow.renderEpochMs }
                  : {}),
              },
            }
          : {}),
        rect: {
          x: o.rect.x,
          y: o.rect.y,
          width: o.rect.width,
          height: o.rect.height,
        },
        viewport: {
          width: o.viewport.width,
          height: o.viewport.height,
          dpr: o.viewport.dpr,
          scrollX: o.viewport.scrollX,
          scrollY: o.viewport.scrollY,
        },
        mutationsSincePrevious: o.mutationsSincePrevious,
        animations: o.animations.map((a) => ({
          kind: a.kind,
          playState: a.playState,
          durationMs: a.durationMs,
          delayMs: a.delayMs,
          iterations: a.iterations,
          currentTimeMs: a.currentTimeMs,
          progress: a.progress,
          properties: [...a.properties],
        })),
        ...(o.mediaTimeMs !== undefined ? { mediaTimeMs: o.mediaTimeMs } : {}),
        ...(o.mediaPaused !== undefined ? { mediaPaused: o.mediaPaused } : {}),
        ...(o.videoPresentation
          ? {
              videoPresentation: {
                callbackEpochMs: o.videoPresentation.callbackEpochMs,
                presentationEpochMs: o.videoPresentation.presentationEpochMs,
                expectedDisplayEpochMs:
                  o.videoPresentation.expectedDisplayEpochMs,
                mediaTimeMs: o.videoPresentation.mediaTimeMs,
                presentedFrames: o.videoPresentation.presentedFrames,
              },
            }
          : {}),
      })),
    })),
    limitations: [...timeline.limitations],
  };
}

function observationInWindow(
  observation: SourceTimeline['candidates'][number]['observations'][number],
  window: Pick<SourceTimeline, 'windowStartEpochMs' | 'windowEndEpochMs'>,
): boolean {
  const start = observation.readWindow?.startEpochMs ?? observation.atEpochMs;
  const end = observation.readWindow?.endEpochMs ?? observation.atEpochMs;
  return end >= window.windowStartEpochMs && start <= window.windowEndEpochMs;
}

export function sourceRepairClues(
  candidate: SourceTimeline['candidates'][number],
  window?: Pick<SourceTimeline, 'windowStartEpochMs' | 'windowEndEpochMs'>,
): string[] {
  const observations = window
    ? candidate.observations.filter((o) => observationInWindow(o, window))
    : candidate.observations;
  const clues: string[] = [];
  const animations = observations.flatMap((o) => o.animations);
  const properties = new Set<string>(animations.flatMap((a) => a.properties));
  if (
    [
      'opacity',
      'backgroundColor',
      'color',
      'fill',
      'stroke',
      'filter',
      'visibility',
    ].some((p) => properties.has(p))
  )
    clues.push(
      'Er zijn animaties van licht- of kleurgerelateerde eigenschappen waargenomen. Controleer deze keyframes en hun herhaling; verwijder snelle contrastrijke wisselingen en meet de wijziging opnieuw. Dit bewijst nog niet dat deze animatie de kandidaat veroorzaakte.',
    );
  if (properties.has('transform') || properties.has('clipPath'))
    clues.push(
      'Er is beweging of clipping geobserveerd. Controleer of wisselende pixels door beweging ontstaan en vergelijk hetzelfde scenario zonder het effect; een bewegende rand is geen bewezen flitsbron.',
    );
  if (candidate.media === 'VIDEO') {
    const presentations = observations.flatMap((o) =>
      o.videoPresentation ? [o.videoPresentation] : [],
    );
    const times = observations.flatMap((o) =>
      o.mediaTimeMs === undefined ? [] : [o.mediaTimeMs],
    );
    clues.push(
      `Controleer het videofragment${times.length ? ` rond ${(Math.min(...times) / 1000).toFixed(2)}–${(Math.max(...times) / 1000).toFixed(2)} s` : ''} met statische frames. Tijdcodes zijn tijdens DOM-steekproeven gelezen en kunnen afwijken van het vastgelegde videoframe. Pas de bronclip aan en meet opnieuw.`,
    );
    if (presentations.length)
      clues.push(
        `De videospeler meldde gepresenteerde mediaposities tussen ${(Math.min(...presentations.map((p) => p.mediaTimeMs)) / 1000).toFixed(2)} en ${(Math.max(...presentations.map((p) => p.mediaTimeMs)) / 1000).toFixed(2)} s via requestVideoFrameCallback. De tabel bewaart ook de ouderdom van die laatste melding. Dit is presentatiemetadata van het element, geen bewezen overeenkomst met een vastgelegd tabframe.`,
      );
  }
  if (candidate.media === 'CANVAS')
    clues.push(
      'Controleer de tekenlus en kleurwisselingen van dit canvas. Een canvas deelt zijn rendercode niet via het DOM; deze geometrische koppeling wijst geen JavaScript-regel aan.',
    );
  if (observations.some((o) => o.mutationsSincePrevious > 0))
    clues.push(
      'Tijdens dit venster wijzigde het element of zijn directe omgeving. Onderzoek de bijbehorende stijl- of DOM-update; de teller bevat geen attributen, tekst of scriptbron en bewijst geen oorzaak.',
    );
  if (!clues.length)
    clues.push(
      'Dit element overlapt het gemeten gebied. Onderzoek ook bedekkende lagen, pseudo-elementen en ingesloten inhoud; er is geen concrete animatie- of mediabron vastgesteld.',
    );
  return clues;
}

function renderSourceTimeline(timeline: SourceTimeline): string {
  const candidates = timeline.candidates
    .map((candidate) => {
      const rows = candidate.observations
        .map((o) => {
          const timing = o.animations
            .map(
              (a) =>
                `${escape(a.kind)}: ${escape(a.properties.join(', ')) || 'eigenschap onbekend'}; ${a.durationMs === null ? 'duur onbekend' : `${fixed(a.durationMs)} ms`} × ${a.iterations === null ? 'onbegrensd/onbekend' : fixed(a.iterations)}; ${escape(a.playState)}`,
            )
            .join('<br>');
          return `<tr><td>${fixed(o.atEpochMs - timeline.windowStartEpochMs)} ms${observationInWindow(o, timeline) ? '' : ' · context buiten het detectievenster'}${o.readWindow ? `<br>DOM gelezen ${fixed(o.readWindow.startEpochMs - timeline.windowStartEpochMs)}–${fixed(o.readWindow.endEpochMs - timeline.windowStartEpochMs)} ms (${escape(o.readWindow.trigger)})` : ''}</td><td>${fixed(o.rect.x)}, ${fixed(o.rect.y)} · ${fixed(o.rect.width)} × ${fixed(o.rect.height)}<br>Scroll ${fixed(o.viewport.scrollX)}, ${fixed(o.viewport.scrollY)}</td><td>${o.mutationsSincePrevious}</td><td>${timing || 'Geen animatie gemeten'}${o.mediaTimeMs !== undefined ? `<br>Video ${fixed(o.mediaTimeMs / 1000)} s · ${o.mediaPaused ? 'gepauzeerd' : 'speelt'}` : ''}${o.videoPresentation ? `<br>Laatste presentatiemelding: ${fixed(o.videoPresentation.mediaTimeMs / 1000)} s · ${fixed(o.atEpochMs - o.videoPresentation.callbackEpochMs)} ms oud` : ''}</td></tr>`;
        })
        .join('');
      return `<section><h5>${escape(candidate.tag)}${candidate.media ? ` · ${escape(candidate.media)}` : ''}</h5><code>${candidate.selectorPath.map(escape).join(' → shadow root → ')}</code><ul>${sourceRepairClues(
        candidate,
        timeline,
      )
        .map((clue) => `<li>${escape(clue)}</li>`)
        .join(
          '',
        )}</ul><details><summary>${candidate.observations.length} DOM-steekproeven bekijken</summary><div class="diagnostic-table" tabindex="0" role="region" aria-label="DOM-metingen tijdens het detectievenster"><table><thead><tr><th>Tijd vanaf geschat vensterbegin</th><th>CSS-regio en scroll</th><th>Mutaties sinds vorige steekproef</th><th>Animatie en media</th></tr></thead><tbody>${rows}</tbody></table></div></details></section>`;
    })
    .join('');
  const clock = timeline.frameClock;
  return `<section><h4>Elementen tijdens het detectievenster</h4><p>${timeline.status === 'CORRELATED' ? 'Elementen overlappen de kandidaatregio in tijdgebonden DOM-steekproeven.' : `Geen tijdgebonden koppeling: ${escape(timeline.reason ?? 'onbekend')}.`} Dit is een samenloop in tijd en plaats, geen bewezen oorzaak. De frameklok is geschat uit ontvangsttijd; de vertraging van capture en compositor ${timeline.alignmentUncertaintyMs === null ? 'is onbekend' : `heeft een geschatte onzekerheid van ${fixed(timeline.alignmentUncertaintyMs)} ms`}. DOM en videoframes zijn niet atomair gemeten.</p>${clock ? `<p>Venstergrenzen gekoppeld aan werkelijk ontvangen frames (${clock.matchedFrames} klokmetingen). De gemeten ontvangstoffset varieert ${fixed(clock.receiptOffsetSpreadMs)} ms; afwijking tot het gevraagde bronframe: ${fixed(clock.startBoundaryErrorMs)} / ${fixed(clock.endBoundaryErrorMs)} ms. Deze variatie is geen bovengrens voor capturelatentie.</p>` : ''}<p>${timeline.complete ? 'Het geschatte detectievenster is met DOM-steekproeven afgedekt' : 'Onvolledige DOM-dekking van het geschatte detectievenster'} · streefinterval ${fixed(timeline.sampleIntervalMs)} ms · grootste gemeten steekproefgat ${fixed(timeline.maxSampleGapMs)} ms. rAF markeert een renderfase; een timerfallback en vertraagde callbacks blijven apart herkenbaar.</p>${candidates}<details><summary>Beperkingen van de tijdkoppeling</summary><ul>${timeline.limitations.map((v) => `<li>${escape(v)}</li>`).join('')}</ul></details></section>`;
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
