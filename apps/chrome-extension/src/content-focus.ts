import { normalizePublicUrl } from '@epi-less/core';

import { reachable } from './content-dom';

import type { PageInventory } from './model';

import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
/** Confirm actual focus under the same generation after page listeners have run. */
export async function confirmContentFocus(
  session: ContentSession,
  _message: ContentMessage,
  element: HTMLElement,
  kind: PageInventory['actions'][number]['kind'],
  generation: number,
  beforeUrl: string,
) {
  const { control, policy } = session;
  const { controlState, deeplyFocused, safeControl } = policy;

  await new Promise((resolve) => setTimeout(resolve, 300));
  const achieved =
    !control.cancelled &&
    generation === control.generation &&
    deeplyFocused(element) &&
    safeControl(element, kind) &&
    reachable(element);
  return {
    achieved,
    reason: achieved ? undefined : 'FOCUS_STATE_NOT_CONFIRMED',
    state: achieved ? `focus:${controlState(element, kind)}` : undefined,
    fromUrl: beforeUrl,
    url: normalizePublicUrl(location.href),
  };
}
