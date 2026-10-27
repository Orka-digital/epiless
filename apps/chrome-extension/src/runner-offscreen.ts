// Worker services are injected lazily; module construction never starts a scan.
export function createRunnerOffscreen() {
  let creatingOffscreen: Promise<void> | undefined;
  async function offscreen(
    type: string,
    values: Record<string, unknown> = {},
  ): Promise<unknown> {
    const response = await timed(
      chrome.runtime.sendMessage({ target: 'offscreen', type, ...values }),
      20_000,
    );
    if (!response?.ok)
      throw new Error(response?.error ?? 'Capture context did not answer');
    return response.value;
  }
  async function ensureOffscreen() {
    if (
      (
        await chrome.runtime.getContexts({
          contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
        })
      ).length
    )
      return;
    creatingOffscreen ??= chrome.offscreen
      .createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification:
          'Analyse explicitly authorised tab frames locally without storing video.',
      })
      .finally(() => {
        creatingOffscreen = undefined;
      });
    await creatingOffscreen;
  }
  async function timed<T>(promise: Promise<T>, timeout: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('STEP_TIMEOUT')), timeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { offscreen, ensureOffscreen, timed };
}
