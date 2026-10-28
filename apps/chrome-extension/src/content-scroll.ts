import type { ContentMessage } from './content-message';
import type { ContentSession } from './content-session';
/** Request bounded immediate scrolling and report the actually reached offset. */
export async function scrollContent(
  _session: ContentSession,
  message: ContentMessage,
) {
  const y = Math.max(0, Math.min(Number(message.y) || 0, 50_000));
  window.scrollTo({ left: 0, top: y, behavior: 'instant' });
  return {
    achieved:
      Math.abs(
        window.scrollY -
          Math.min(
            y,
            Math.max(0, document.documentElement.scrollHeight - innerHeight),
          ),
      ) < 4,
    reason: 'SCROLL_REQUESTED',
  };
}
