// Passive timing only in the copied native fixture bundle. Preserve the native
// debugger call, result and rejection; never attach/detach on the observer's own.
(() => {
  // Observe persisted production transitions without initiating or awaiting any
  // restoration. This distinguishes an exercised fallback from ordinary settle.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith('viewport-rebind:')) continue;
      const value = change.newValue ?? change.oldValue;
      if (!value?.jobId || !value?.generation) continue;
      void chrome.runtime
        .sendMessage({
          type: 'FIXTURE_CONTEXT_EVIDENCE',
          event: {
            kind: 'VIEWPORT_REBIND_PERSISTED_PHASE',
            at: Date.now(),
            jobId: value.jobId,
            generation: value.generation,
            tabId: value.workspace?.tabId,
            placeholderTabId: value.placeholderTabId,
            phase: change.newValue ? value.phase : 'CLEARED',
          },
        })
        .catch(() => {});
    }
  });
  const detach = chrome.debugger.detach.bind(chrome.debugger);
  const config = fetch(
    chrome.runtime.getURL('fixture-context-config.json'),
  ).then((reply) => reply.json());
  let sequence = 0;
  const record = (kind, requestId, target, error) => {
    const at = Date.now();
    void chrome.runtime
      .sendMessage({
        type: 'FIXTURE_CONTEXT_EVIDENCE',
        event: {
          kind,
          at,
          requestId,
          tabId: target.tabId,
          ...(error ? { error: String(error) } : {}),
        },
      })
      .catch(() => {});
    if (kind === 'DEBUGGER_DETACH_REPLY') {
      // The service-worker timer wakes the hidden controller without depending
      // on its throttled page interval. Only the controller may run the opt-in
      // hypothesis, after independent real browser ownership/release checks.
      void config
        .then((value) => {
          if (!value.tabSwitchProbe) return;
          setTimeout(
            () => {
              void chrome.runtime
                .sendMessage({
                  type: 'FIXTURE_CONTEXT_EVIDENCE',
                  event: {
                    kind: 'TAB_SWITCH_PROBE_DUE',
                    at: Date.now(),
                    requestId,
                    tabId: target.tabId,
                    detachedAt: at,
                  },
                })
                .catch(() => {});
            },
            Math.max(0, at + 5200 - Date.now()),
          );
        })
        .catch(() => {});
    }
  };
  chrome.debugger.detach = (target, callback) => {
    const requestId = ++sequence;
    record('DEBUGGER_DETACH_REQUEST', requestId, target);
    if (callback) {
      return detach(target, () => {
        const error = chrome.runtime.lastError;
        record(
          error ? 'DEBUGGER_DETACH_ERROR' : 'DEBUGGER_DETACH_REPLY',
          requestId,
          target,
          error?.message,
        );
        callback();
      });
    }
    return detach(target).then(
      (value) => {
        record('DEBUGGER_DETACH_REPLY', requestId, target);
        return value;
      },
      (error) => {
        record('DEBUGGER_DETACH_ERROR', requestId, target, error);
        throw error;
      },
    );
  };
})();
