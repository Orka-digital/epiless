import { executeContentMessage } from './content-dispatch';
import { createContentSession } from './content-session';
const runtime = globalThis as typeof globalThis & {
  __flashguardInstalled?: boolean;
};

if (!runtime.__flashguardInstalled) {
  runtime.__flashguardInstalled = true;
  const session = createContentSession();
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('FG_'))
      return;
    void executeContentMessage(session, message).then(
      (value) => respond({ ok: true, value }),
      (error) => respond({ ok: false, error: String(error) }),
    );
    return true;
  });
}
