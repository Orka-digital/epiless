import { useEffect, useState } from 'react';
import { TERMINAL_STATES, type ScanJob } from './model';
import type { AppState } from './ui-state';
export function useScanSelection(state: AppState | undefined, popup: boolean) {
  const [selected, setSelected] = useState(location.hash.slice(1));
  const [site, setSite] = useState('');
  const [workspaceView, setWorkspaceView] = useState<
    'scan' | 'history' | 'settings'
  >('scan');
  const [routeView, setRouteView] = useState<'all' | 'findings' | 'unreached'>(
    'all',
  );
  const [scanQuery, setScanQuery] = useState('');
  const [deletion, setDeletion] = useState<{ origin?: string; id?: string }>();
  useEffect(() => {
    if (
      state &&
      site &&
      !state.sites.some((summary) => summary.origin === site)
    )
      setSite('');
  }, [state, site]);
  const jobs = state?.jobs ?? [];
  const active = jobs.find((job) => !TERMINAL_STATES.includes(job.state));
  const recheck =
    state?.recheck?.tabId === state?.tab.id ? state?.recheck : undefined;
  const advancedPreparation =
    state?.advancedPreparation?.tabId === state?.tab.id
      ? state?.advancedPreparation
      : undefined;
  const chosen =
    jobs.find((job) => job.id === selected) ??
    active ??
    (popup
      ? jobs.find(
          (job) =>
            job.state === 'INTERRUPTED' &&
            !job.disposableSource?.closed &&
            job.tabId === state?.tab.id,
        )
      : undefined) ??
    jobs[0];
  const popupReport = Boolean(
    active ||
    (chosen?.state === 'INTERRUPTED' &&
      !chosen.disposableSource?.closed &&
      chosen.tabId === state?.tab.id),
  );
  const findingsCount = (job: ScanJob) =>
    job.detailsExpiredAt
      ? (job.retainedCandidates ?? []).reduce(
          (total, candidate) => total + candidate.occurrences,
          0,
        )
      : job.tasks.reduce(
          (total, task) =>
            total +
            task.observations.reduce(
              (sum, observation) =>
                sum + (observation.measurement?.findings.length ?? 0),
              0,
            ),
          0,
        );
  const selectScan = (id: string) => {
    setSelected(id);
    setWorkspaceView('scan');
    setRouteView('all');
    history.replaceState(null, '', `#${id}`);
    window.scrollTo({ top: 0 });
  };
  const incompleteRoute = (task: ScanJob['tasks'][number]) =>
    task.state === 'SKIPPED' ||
    task.state === 'QUEUED' ||
    task.observations.some(
      (observation) =>
        observation.coverage === 'SKIPPED' ||
        observation.coverage === 'UNREACHED',
    );
  const visibleTasks =
    chosen?.tasks.filter(
      (task) =>
        routeView === 'all' ||
        (routeView === 'findings'
          ? task.observations.some(
              (observation) => observation.measurement?.findings.length,
            )
          : incompleteRoute(task)),
    ) ?? [];
  let targetOrigin = '';
  try {
    const url = new URL(state?.tab.url ?? '');
    if (['http:', 'https:'].includes(url.protocol)) targetOrigin = url.origin;
  } catch {
    /* No inspectable active tab. */
  }
  return {
    jobs,
    active,
    recheck,
    advancedPreparation,
    chosen,
    popupReport,
    findingsCount,
    selectScan,
    incompleteRoute,
    visibleTasks,
    targetOrigin,
    site,
    setSite,
    workspaceView,
    setWorkspaceView,
    routeView,
    setRouteView,
    scanQuery,
    setScanQuery,
    deletion,
    setDeletion,
  };
}
