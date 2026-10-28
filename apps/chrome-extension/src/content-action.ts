import { activateContentControl } from './content-activation';
import { confirmContentFocus } from './content-focus';
import { playContentMedia } from './content-playback';
import { confirmContentPointer } from './content-pointer';
import { normalizePublicUrl } from '@epi-less/core';

import { reachable } from './content-dom';

import { resolveDiagnosticPath } from './source-diagnostics';

import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
/** Resolve and revalidate the target around scrolling before dispatching explicit control actions. */
export async function executeContentControl(
  session: ContentSession,
  message: ContentMessage,
) {
  const { control, tree, policy } = session;
  const { controlKind, safeControl } = policy;
  const { refreshTree } = tree;

  refreshTree();
  const target = resolveControlTarget(session, message);
  if (
    message.target &&
    (!target || controlKind(target.element) !== message.target.kind)
  )
    return { achieved: false, reason: 'REPLAY_CONTROL_KIND_CHANGED' };
  if (!target || !safeControl(target.element, target.kind))
    return { achieved: false, reason: 'CONTROL_NO_LONGER_ALLOWED' };
  const { element, kind } = target;
  const generation = control.generation;
  element.scrollIntoView({ behavior: 'instant', block: 'center' });
  // Let scroll listeners run, then reject controls whose form/action semantics changed.
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (control.cancelled || generation !== control.generation)
    return { achieved: false, reason: 'ACTION_CANCELLED' };
  refreshTree();
  if (!safeControl(element, kind))
    return { achieved: false, reason: 'CONTROL_CHANGED_DURING_SCROLL' };
  if (!reachable(element))
    return { achieved: false, reason: 'CONTROL_OBSCURED' };
  const beforeUrl = normalizePublicUrl(location.href);
  if (
    message.type === 'FG_POINTER_TARGET' ||
    message.type === 'FG_POINTER_CONFIRM'
  ) {
    return confirmContentPointer(session, message, element, kind, generation);
  }
  if (element.tabIndex >= 0) element.focus({ preventScroll: true });
  refreshTree();
  if (!safeControl(element, kind))
    return { achieved: false, reason: 'CONTROL_CHANGED_DURING_FOCUS' };
  if (!reachable(element))
    return { achieved: false, reason: 'CONTROL_OBSCURED' };
  if (message.type === 'FG_FOCUS') {
    return confirmContentFocus(
      session,
      message,
      element,
      kind,
      generation,
      beforeUrl,
    );
  }
  if (kind === 'media' && element instanceof HTMLVideoElement) {
    return playContentMedia(
      session,
      message,
      element,
      kind,
      generation,
      beforeUrl,
    );
  }
  return activateContentControl(
    session,
    message,
    element,
    kind,
    generation,
    beforeUrl,
  );
}

function resolveControlTarget(
  session: ContentSession,
  message: ContentMessage,
) {
  const { pageInventory } = session;
  const resolved = message.target
    ? resolveDiagnosticPath(message.target.selectorPath)
    : undefined;
  const target =
    message.target && resolved instanceof HTMLElement
      ? { element: resolved, kind: message.target.kind }
      : pageInventory.resolveControl(message.actionId ?? '');
  return target;
}
