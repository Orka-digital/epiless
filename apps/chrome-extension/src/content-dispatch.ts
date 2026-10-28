import { executeContentControl } from './content-action';
import { navigateContent } from './content-navigation';
import { restoreContent } from './content-restoration';
import { scrollContent } from './content-scroll';

import { diagnosticContext, diagnosticSources } from './source-diagnostics';

import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
import {
  cancelSourceTimeline,
  inspectSourceTimelineTarget,
  recordSourceTimelineEvent,
  startSourceTimeline,
  stopSourceTimeline,
} from './source-timeline';
/** Dispatch extension-owned page commands; unrecognized actions are rejected. */
export async function executeContentMessage(
  session: ContentSession,
  message: ContentMessage,
) {
  const { control, mediaReplay, animationPhase, inventory } = session;

  switch (message.type) {
    case 'FG_PHASE_CLOCK':
      return animationPhase.clock();

    case 'FG_PHASE_BEGIN':
      return animationPhase.begin(message.generation!, message.segmentId!);

    case 'FG_PHASE_TRIGGER':
      return animationPhase.trigger(
        message.generation!,
        message.segmentId!,
        message.stage!,
      );

    case 'FG_PHASE_STOP':
      return animationPhase.stop(message.generation!, message.segmentId!);

    case 'FG_MEDIA_SNAPSHOT':
      return mediaReplay.snapshot();

    case 'FG_MEDIA_REPLAY_PREPARE':
      return mediaReplay.prepare(message.mediaPlan);

    case 'FG_MEDIA_REPLAY_RELEASE':
      return mediaReplay.release();

    case 'FG_MEDIA_OBSERVATION_START':
      return mediaReplay.start(message.generation!, message.segmentId!);

    case 'FG_MEDIA_OBSERVATION_PROGRESS':
      return mediaReplay.progress(
        message.generation!,
        message.segmentId!,
        message.mediaPlan,
      );

    case 'FG_MEDIA_OBSERVATION_BEGIN':
      return mediaReplay.begin(message.generation!, message.segmentId!);

    case 'FG_MEDIA_OBSERVATION_STOP':
      return mediaReplay.stop(message.generation!, message.segmentId!);

    case 'FG_SOURCE_TIMELINE_START':
      return startSourceTimeline({
        generation: message.generation!,
        segmentId: message.segmentId!,
      });

    case 'FG_SOURCE_TIMELINE_EVENT':
      return recordSourceTimelineEvent(
        message.event as Parameters<typeof recordSourceTimelineEvent>[0],
      );

    case 'FG_SOURCE_TIMELINE_STOP':
      return stopSourceTimeline({
        generation: message.generation!,
        segmentId: message.segmentId!,
      });

    case 'FG_INSPECT_SOURCE':
      return inspectSourceTimelineTarget(message.token!);

    case 'FG_DIAGNOSTIC_CONTEXT':
      return diagnosticContext();

    case 'FG_DIAGNOSTIC_SOURCES':
      return diagnosticSources(message.request!);

    case 'FG_CANCEL': {
      cancelSourceTimeline();
      mediaReplay.cancel();
      animationPhase.cancel();
      control.cancelled = true;
      control.generation++;
      return { achieved: true };
    }

    case 'FG_INVENTORY':
      return inventory();

    case 'FG_NAVIGATE': {
      return navigateContent(session, message);
    }

    case 'FG_SCROLL': {
      return scrollContent(session, message);
    }

    case 'FG_RESTORE': {
      return restoreContent(session, message);
    }

    case 'FG_HOVER':
      return {
        achieved: false,
        reason: 'HOVER_REQUIRES_TRUSTED_POINTER_DRIVER',
      };
  }

  if (
    ![
      'FG_ACTION',
      'FG_FOCUS',
      'FG_POINTER_TARGET',
      'FG_POINTER_CONFIRM',
    ].includes(message.type)
  )
    throw new Error('Unsupported content command');
  return executeContentControl(session, message);
}
