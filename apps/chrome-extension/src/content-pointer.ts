import { reachable } from './content-dom';

import type { PageInventory } from './model';

import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
/** Describe or confirm a trusted pointer target without synthesizing hover events. */
export async function confirmContentPointer(
  session: ContentSession,
  message: ContentMessage,
  element: HTMLElement,
  kind: PageInventory['actions'][number]['kind'],
  generation: number,
) {
  const { control, policy } = session;
  const { controlState, safeControl } = policy;

  if (['media', 'consent-reject'].includes(kind))
    return { achieved: false, reason: 'POINTER_TARGET_OUTSIDE_POLICY' };
  const rect = element.getBoundingClientRect();
  const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
  const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
  if (message.type === 'FG_POINTER_TARGET') return { achieved: true, x, y };
  await new Promise((resolve) => setTimeout(resolve, 300));
  const achieved =
    !control.cancelled &&
    generation === control.generation &&
    safeControl(element, kind) &&
    reachable(element) &&
    element.matches(':hover');
  return {
    achieved,
    reason: achieved ? undefined : 'NATIVE_HOVER_STATE_NOT_CONFIRMED',
    state: achieved ? `hover:${controlState(element, kind)}` : undefined,
  };
}
