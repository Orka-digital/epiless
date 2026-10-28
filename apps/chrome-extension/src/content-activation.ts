import { normalizePublicUrl } from '@epi-less/core';

import { controlledElement, observedPanel, visible } from './content-dom';

import type { PageInventory } from './model';

import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
/** Activate an admitted control and wait for observed disclosure, carousel or consent state. */
export async function activateContentControl(
  session: ContentSession,
  message: ContentMessage,
  element: HTMLElement,
  kind: PageInventory['actions'][number]['kind'],
  generation: number,
  beforeUrl: string,
) {
  const { control, policy } = session;
  const { consentContainer, carouselSlides, slideState, controlState } = policy;

  const controlled = controlledElement(element);
  if (kind === 'tab' && element.getAttribute('aria-selected') === 'true')
    return {
      achieved: Boolean(controlled && observedPanel(controlled)),
      reason: 'ALREADY_SELECTED',
      state: controlState(element, kind),
    };
  if (
    ['accordion', 'menu'].includes(kind) &&
    element.getAttribute('aria-expanded') === 'true'
  )
    return {
      achieved: Boolean(controlled && observedPanel(controlled)),
      reason: 'ALREADY_EXPANDED',
      state: controlState(element, kind),
    };
  const slidesBefore = kind === 'carousel' ? slideState(element) : '';
  const consentBefore =
    kind === 'consent-reject' ? consentContainer(element) : undefined;
  element.click();
  const confirm = () =>
    kind === 'carousel'
      ? slideState(element) !== slidesBefore &&
        carouselSlides(element).some(
          (slide) =>
            visible(slide) && slide.getAttribute('aria-hidden') !== 'true',
        )
      : kind === 'consent-reject'
        ? Boolean(
            consentBefore &&
            (!consentBefore.isConnected || !visible(consentBefore)),
          )
        : kind === 'tab'
          ? element.getAttribute('aria-selected') === 'true' &&
            Boolean(controlled && observedPanel(controlled))
          : element.getAttribute('aria-expanded') === 'true' &&
            Boolean(controlled && observedPanel(controlled));
  // Framework transitions and deferred controls need real state evidence,
  // not a fixed 300ms guess. Remain within the existing content RPC deadline.
  const deadline = performance.now() + 2_500;
  while (
    !confirm() &&
    performance.now() < deadline &&
    !control.cancelled &&
    generation === control.generation
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  if (control.cancelled || generation !== control.generation)
    return { achieved: false, reason: 'ACTION_CANCELLED' };
  const state = controlState(element, kind);
  const achieved =
    confirm() && (!message.expectedState || message.expectedState === state);
  return {
    achieved,
    reason: achieved ? undefined : 'CONTROL_STATE_NOT_CONFIRMED',
    fromUrl: beforeUrl,
    url: normalizePublicUrl(location.href),
    state: achieved ? state : undefined,
  };
}
