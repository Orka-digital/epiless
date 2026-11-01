import type { SourceTimeline } from './source-timeline-schema.js';

import { escape, fixed } from './diagnostic-format.js';

function observationInWindow(
  observation: SourceTimeline['candidates'][number]['observations'][number],
  window: Pick<SourceTimeline, 'windowStartEpochMs' | 'windowEndEpochMs'>,
): boolean {
  const start = observation.readWindow?.startEpochMs ?? observation.atEpochMs;
  const end = observation.readWindow?.endEpochMs ?? observation.atEpochMs;
  return end >= window.windowStartEpochMs && start <= window.windowEndEpochMs;
}

/** Derive repair clues only from observations intersecting the requested window. */
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

/** Render escaped temporal source hints and explicitly retain correlation limitations. */
export function renderSourceTimeline(timeline: SourceTimeline): string {
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
