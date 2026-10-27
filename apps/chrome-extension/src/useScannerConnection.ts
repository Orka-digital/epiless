import { useCallback, useEffect, useRef, useState } from 'react';
import { command } from './command-client';
import type { CommandAction } from './command-protocol';
import type { ScanJob, ScanMode } from './model';
import type { AppState } from './ui-state';
/** Polling, command feedback and gesture-bound capture actions share one connection. */
export function useScannerConnection(devtools: boolean) {
  const requestSequence = useRef(0);
  const [state, setState] = useState<AppState>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ScanMode>('AUTONOMOUS');
  const [viewportSeconds, setViewportSeconds] = useState(30);
  const preferencesLoaded = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++requestSequence.current;
    try {
      const next = await command(
        'GET_STATE',
        devtools
          ? { inspectedTabId: chrome.devtools.inspectedWindow.tabId }
          : {},
      );
      if (request !== requestSequence.current) return;
      setState(next);
      if (!preferencesLoaded.current) {
        preferencesLoaded.current = true;
        const prepared =
          next.advancedPreparation?.tabId === next.tab.id
            ? next.advancedPreparation
            : undefined;
        setMode(prepared?.mode ?? next.preferences.mode);
        setViewportSeconds(
          prepared?.viewportSeconds ?? next.preferences.viewportSeconds,
        );
      }
    } catch (cause) {
      if (request === requestSequence.current) setError(String(cause));
    }
  }, [devtools]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1500);
    return () => {
      clearInterval(timer);
      requestSequence.current++;
    };
  }, [refresh]);
  const act: CommandAction = async (...args) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await command(...args);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const start = async ({
    targetOrigin,
    useAdvanced,
    advancedPreparation,
    recheck,
  }: {
    targetOrigin: string;
    useAdvanced: boolean;
    advancedPreparation: AppState['advancedPreparation'];
    recheck: AppState['recheck'];
  }) => {
    if (!targetOrigin || state?.tab.id === undefined) return;
    setBusy(true);
    setError('');
    try {
      if (useAdvanced && !advancedPreparation) {
        const granted = await chrome.permissions.request({
          origins: [`${targetOrigin}/*`],
        });
        if (!granted)
          throw new Error(
            'Zonder toestemming voor deze website kan de scan niet starten.',
          );
        await command('PREPARE_ADVANCED_SCAN', {
          tabId: state.tab.id,
          mode,
          viewportSeconds,
          ...(recheck ? { replayOf: recheck.replayOf } : {}),
        });
        await refresh();
        return;
      }
      // Permission request is invoked directly from the button gesture, scoped to this exact origin.
      const prepared = command('PREPARE_START', {
        tabId: state.tab.id,
        mode,
        viewportSeconds,
        advancedPointer: useAdvanced,
        ...(recheck ? { replayOf: recheck.replayOf } : {}),
      });
      const granted = await chrome.permissions.request({
        origins: [`${targetOrigin}/*`],
      });
      if (!granted) {
        await command('CANCEL_START', { tabId: state.tab.id });
        throw new Error(
          'Zonder toestemming voor deze website kan de scan niet starten.',
        );
      }
      await prepared;
      await command('CONTINUE_START');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const resume = async (job: ScanJob, popup: boolean) => {
    if (popup && state?.tab.id === job.tabId) {
      await act('RESUME', { id: job.id });
      return;
    }
    await act('OPEN_TARGET', { id: job.id });
    setNotice(
      'Open de epi-less-toolbar op de scantab en kies Hervat. Zo kan Chrome opnieuw toegang geven.',
    );
  };
  return {
    state,
    error,
    setError,
    notice,
    setNotice,
    busy,
    mode,
    setMode,
    viewportSeconds,
    setViewportSeconds,
    act,
    start,
    resume,
  };
}
