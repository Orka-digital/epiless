import type { TimelineAnimation } from '@epi-less/core';

export const epoch = () => performance.timeOrigin + performance.now();

export const nativeTags = new Set(
  'a article aside audio body button canvas details dialog div em fieldset figure figcaption footer form h1 h2 h3 h4 h5 h6 header hr html iframe img input label li main nav ol p picture section select small span strong summary svg table tbody td textarea th thead tr ul video'.split(
    ' ',
  ),
);

const safeProperties = new Set([
  'opacity',
  'backgroundColor',
  'color',
  'fill',
  'stroke',
  'filter',
  'transform',
  'visibility',
  'clipPath',
]);

export const identities = new WeakMap<Element, string>();

const keyframeProperties = new WeakMap<
  KeyframeEffect,
  { at: number; values: TimelineAnimation['properties'] }
>();

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Return bounded animation timing and property categories, excluding keyframe values, text and source URLs. */
export function animationDetails(element: Element): TimelineAnimation[] {
  return element
    .getAnimations()
    .slice(0, 4)
    .map((animation) => {
      const effect = animation.effect;
      const timing = effect?.getComputedTiming();
      const properties = animationProperties(effect);
      return {
        kind:
          typeof CSSAnimation !== 'undefined' &&
          animation instanceof CSSAnimation
            ? 'CSS_ANIMATION'
            : typeof CSSTransition !== 'undefined' &&
                animation instanceof CSSTransition
              ? 'CSS_TRANSITION'
              : 'WEB_ANIMATION',
        playState: animation.playState,
        durationMs: finite(timing?.duration),
        delayMs: finite(timing?.delay) ?? 0,
        iterations: finite(timing?.iterations),
        currentTimeMs: finite(animation.currentTime),
        progress: finite(timing?.progress),
        properties: [...properties].slice(0, 10),
      };
    });
}

function animationProperties(
  effect: AnimationEffect | null,
): Set<TimelineAnimation['properties'][number]> {
  const properties = new Set<TimelineAnimation['properties'][number]>();
  // Only property categories are retained. No keyframe values, names, text or URLs.
  if (effect instanceof KeyframeEffect) {
    const cached = keyframeProperties.get(effect);
    if (cached && performance.now() - cached.at < 500)
      for (const property of cached.values) properties.add(property);
    else {
      readKeyframeProperties(effect, properties);
      keyframeProperties.set(effect, {
        at: performance.now(),
        values: [...properties].slice(0, 10),
      });
    }
  }
  return properties;
}

function readKeyframeProperties(
  effect: KeyframeEffect,
  properties: Set<TimelineAnimation['properties'][number]>,
): void {
  for (const frame of effect.getKeyframes().slice(0, 32))
    for (const name of Object.keys(frame).slice(0, 32)) {
      if (['offset', 'computedOffset', 'easing', 'composite'].includes(name))
        continue;
      properties.add(
        safeProperties.has(name)
          ? (name as TimelineAnimation['properties'][number])
          : 'other',
      );
    }
}
