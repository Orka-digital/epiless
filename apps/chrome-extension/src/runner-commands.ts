import { ENGINE_VERSION } from '@epi-less/analysis-engine';
import { contentHash, normalizePublicUrl, planRoute } from '@epi-less/core';
import { SCANNER_BUILD_SHA256 } from './build-identity';
import { stopRequestedCapture } from './capture-stop';
import { parseBackgroundCommand } from './command-protocol';
import { matchingRecord } from './disposable-scan';
import {
  buildHistoryExport,
  buildHtmlReport,
  prepareExportJobs,
} from './export';
import { historySummary } from './history';
import {
  canResumeWithVersions,
  DEFAULT_LIMITS,
  RUNNER_VERSION,
  TERMINAL_STATES,
  viewportDuration,
  type ScanJob,
} from './model';
import { buildReport } from './report';
import type { RunnerOperations } from './runner-contracts';
import { hasHashRoute } from './runner-policy';
import type { CaptureOwner, ExecutionOwner } from './runner-runtime';
import {
  applyRetention,
  consumeStartIntent,
  createJob,
  deleteHistory,
  deleteJob,
  getHistorySettings,
  getJob,
  getPendingRecheck,
  getScanPreferences,
  getStartIntent,
  listJobs,
  mutateJob,
  putStartIntent,
  putTransfer,
  resumeLease,
  setHistorySettings,
  setPendingRecheck,
  setScanPreferences,
} from './store';
import { buildVerificationPlan } from './verification';
import { handleVerificationCommand } from './verification-control';

// Worker services are injected lazily; module construction never starts a scan.
export function createRunnerCommands(
  services: Pick<
    RunnerOperations,
    | 'initialized'
    | 'reconcileMissingAdvancedTab'
    | 'prepareAdvancedScan'
    | 'loadAdvancedOwner'
    | 'closeAdvancedOwner'
    | 'content'
    | 'unresolvedWorkspaceIntent'
    | '__WEB_ORIGIN__'
    | 'validateAdvancedStart'
    | 'now'
    | 'persistAdvancedOwner'
    | 'authorize'
    | 'showAdvancedDashboard'
    | 'offscreen'
    | 'finalizeAdvancedJob'
  > & { execution: ExecutionOwner; capture: CaptureOwner },
) {
  async function handle(input: unknown) {
    const message = parseBackgroundCommand(input);
    await services.initialized;
    if (message.type === 'PREPARE_ADVANCED_SCAN') {
      await services.reconcileMissingAdvancedTab();
      return services.prepareAdvancedScan(message);
    }
    if (message.type === 'CANCEL_ADVANCED_SCAN') {
      const owner = await services.loadAdvancedOwner();
      if (
        !owner ||
        owner.scanTabId !== message.tabId ||
        owner.phase !== 'PREPARED' ||
        owner.jobId
      )
        throw new Error(
          'Deze voorbereiding kan niet automatisch worden gesloten.',
        );
      if (!(await services.closeAdvancedOwner(owner)))
        throw new Error(
          'Het scantabblad bleef behouden: controleer de handmatige herstelmelding.',
        );
      const pending = await getPendingRecheck();
      if (
        pending &&
        pending.tabId === owner.scanTabId &&
        matchingRecord(pending.replayOf, owner.replayOf)
      )
        await setPendingRecheck(undefined);
      return {};
    }
    const verification = await handleVerificationCommand(message);
    if (verification.handled) return verification.value;
    if (message.type === 'CANDIDATE_EVENT') {
      const segment = services.capture.activeSegment;
      if (
        !segment ||
        message.generation !== segment.generation ||
        message.segmentId !== segment.segmentId ||
        segment.events.length >= 8
      )
        return {};
      const request = services
        .content(
          segment.jobId,
          segment.generation,
          'FG_SOURCE_TIMELINE_EVENT',
          {
            generation: segment.generation,
            segmentId: segment.segmentId,
            event: message,
          },
          1_500,
        )
        .catch(() => undefined);
      segment.events.push(request);
      await request;
      return {};
    }
    if (message.type === 'PREPARE_RECHECK') {
      if (services.execution.running || services.execution.authorizing)
        throw new Error(
          'Stop de huidige scan voordat je een hercontrole voorbereidt.',
        );
      const ref = message.replayOf;
      const previous = ref && (await getJob(ref.jobId));
      if (!previous) throw new Error('De oorspronkelijke scan ontbreekt.');
      const plan = buildVerificationPlan(
        previous,
        ref.taskId,
        ref.observationId,
      );
      if (previous.advancedPointer) {
        if (!previous.disposableSource)
          throw new Error(
            'Deze oudere geavanceerde scan vereist een nieuwe afzonderlijke voorbereiding.',
          );
        const original = await chrome.tabs
          .get(previous.disposableSource.originalTabId)
          .catch(() => undefined);
        if (
          !original ||
          original.id === undefined ||
          original.url !== previous.disposableSource.originalUrl
        )
          throw new Error(
            'Open eerst de oorspronkelijke website opnieuw en bereid een nieuwe geavanceerde scan voor.',
          );
        const prepared = await services.prepareAdvancedScan(
          {
            tabId: original.id,
            mode: 'AUTONOMOUS',
            viewportSeconds: 15,
            replayOf: {
              jobId: previous.id,
              taskId: ref.taskId,
              observationId: ref.observationId,
            },
          },
          plan.route,
          true,
        );
        await setPendingRecheck({
          replayOf: {
            jobId: previous.id,
            taskId: ref.taskId,
            observationId: ref.observationId,
          },
          route: plan.route,
          tabId: prepared.tabId,
        });
        return prepared;
      }
      const tab = await chrome.tabs.create({ url: plan.route, active: true });
      if (tab.id === undefined)
        throw new Error('Hercontroletab kon niet geopend worden.');
      await setPendingRecheck({
        replayOf: {
          jobId: previous.id,
          taskId: ref.taskId,
          observationId: ref.observationId,
        },
        route: plan.route,
        tabId: tab.id!,
      });
      return { tabId: tab.id };
    }
    if (message.type === 'PREPARE_START') {
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.url) throw new Error('Geen website geselecteerd.');
      const origin = new URL(tab.url).origin;
      await putStartIntent({
        id: crypto.randomUUID(),
        tabId: message.tabId,
        origin,
        mode:
          message.mode === 'EXTENDED'
            ? 'EXTENDED'
            : message.mode === 'QUICK'
              ? 'QUICK'
              : 'AUTONOMOUS',
        viewportSeconds:
          viewportDuration(
            message.mode ?? 'AUTONOMOUS',
            message.viewportSeconds,
          ) / 1000,
        expiresAt: Date.now() + 120_000,
        ...(message.replayOf ? { replayOf: message.replayOf } : {}),
        advancedPointer: message.advancedPointer === true,
      });
      await continueStartIntent();
      return {};
    }
    if (message.type === 'CONTINUE_START') {
      await continueStartIntent();
      return {};
    }
    if (message.type === 'CANCEL_START') {
      const intent = await getStartIntent();
      if (intent && intent.tabId === message.tabId)
        await consumeStartIntent(intent.id);
      return {};
    }
    if (message.type === 'GET_STATE') {
      await services.reconcileMissingAdvancedTab();
      if (Date.now() - services.execution.retentionCheckedAt > 3600_000) {
        await applyRetention();
        services.execution.retentionCheckedAt = Date.now();
      }
      const tab =
        typeof message.inspectedTabId === 'number'
          ? await chrome.tabs.get(message.inspectedTabId)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      const jobs = await listJobs();
      const workspaceRecovery = [];
      for (const job of jobs) {
        if (!TERMINAL_STATES.includes(job.state) && job.state !== 'PAUSED')
          continue;
        const intent = await services.unresolvedWorkspaceIntent(job.id);
        if (intent) workspaceRecovery.push({ jobId: job.id, ...intent });
      }
      const advancedOwner = await services.loadAdvancedOwner();
      return {
        ...(advancedOwner?.phase === 'PREPARED' &&
        advancedOwner.scanTabId !== undefined
          ? {
              advancedPreparation: {
                tabId: advancedOwner.scanTabId,
                originalTabId: advancedOwner.source.tabId,
                mode: advancedOwner.mode,
                viewportSeconds: advancedOwner.viewportSeconds,
              },
            }
          : {}),
        ...(advancedOwner &&
        ['MANUAL', 'CREATE_INTENT', 'CLOSING'].includes(advancedOwner.phase)
          ? {
              advancedRecovery: {
                tabId: advancedOwner.scanTabId,
                reason:
                  advancedOwner.reason ??
                  'De eigenaar of sluiting is niet bevestigd; er wordt geen tabblad geraden of verwijderd.',
              },
            }
          : {}),
        jobs,
        workspaceRecovery,
        tab: { id: tab?.id, url: tab?.url },
        webOrigin: services.__WEB_ORIGIN__,
        settings: await getHistorySettings(),
        sites: historySummary(jobs),
        preferences: await getScanPreferences(),
        recheck: await getPendingRecheck(),
        advancedPointerAvailable:
          chrome.runtime.getManifest().permissions?.includes('debugger') ===
          true,
      };
    }
    if (message.type === 'START') {
      if (services.execution.running || services.execution.authorizing)
        throw new Error('Er loopt al een scan.');
      const tab = await chrome.tabs.get(message.tabId);
      if (!tab.url || tab.id === undefined)
        throw new Error('Geen gewone website geselecteerd.');
      const parsed = new URL(tab.url);
      const previous =
        message.replayOf && (await getJob(message.replayOf.jobId));
      const replayTarget = message.replayOf
        ? previous
          ? buildVerificationPlan(
              previous,
              message.replayOf.taskId,
              message.replayOf.observationId,
            )
          : (() => {
              throw new Error('De oorspronkelijke scan ontbreekt.');
            })()
        : undefined;
      if (replayTarget?.viewportMethod === 'CDP')
        throw new Error(
          'Dit oudere CDP-profiel heeft geen bewezen native pixelkoppeling. Maak een nieuwe fysieke responsive scan.',
        );
      const advancedPointer = message.advancedPointer === true;
      const advancedOwner = advancedPointer
        ? await services.validateAdvancedStart(message)
        : undefined;
      if (
        !advancedPointer &&
        (await services.loadAdvancedOwner())?.scanTabId === tab.id
      )
        throw new Error(
          'Dit voorbereide tabblad moet via de geavanceerde toolbarstart worden gemeten.',
        );
      if (
        advancedPointer &&
        !chrome.runtime.getManifest().permissions?.includes('debugger')
      )
        throw new Error(
          'Echte hoverinteractie vereist de afzonderlijke geavanceerde extensie met debugger-toestemming.',
        );
      if (
        replayTarget?.steps.some((step) => step.kind === 'hover') &&
        !advancedPointer
      )
        throw new Error(
          'Dit scenario bevat echte hoverinteractie. Schakel de geavanceerde pointermeting expliciet in.',
        );
      if (replayTarget && new URL(replayTarget.route).origin !== parsed.origin)
        throw new Error(
          'Open de hercontroletab op dezelfde oorsprong als het bewaarde scenario.',
        );
      if (
        hasHashRoute(tab.url) &&
        message.mode !== 'QUICK' &&
        message.mode !== 'EXTENDED'
      )
        throw new Error(
          'Deze website gebruikt hash-routes. Autonome routeverkenning ondersteunt die nog niet. Kies een viewportmeting; de beperkte dekking wordt in het rapport vermeld.',
        );
      const decision = planRoute({
        candidate: tab.url,
        baseUrl: tab.url,
        origin: parsed.origin,
        depth: 0,
      });
      if (!decision.allowed || !decision.url)
        throw new Error(
          `Deze startpagina valt buiten de veilige routepolicy (${decision.reason}). Open een gewone pagina zonder queryparameters of accountactie.`,
        );
      if (
        !(await chrome.permissions.contains({
          origins: [`${parsed.origin}/*`],
        }))
      )
        throw new Error('Sitetoestemming ontbreekt.');
      const mode = replayTarget
        ? 'AUTONOMOUS'
        : message.mode === 'EXTENDED'
          ? 'EXTENDED'
          : message.mode === 'QUICK'
            ? 'QUICK'
            : 'AUTONOMOUS';
      const viewportMs = viewportDuration(mode, message.viewportSeconds);
      const job: ScanJob = {
        id: crypto.randomUUID(),
        engineVersion: ENGINE_VERSION,
        runnerVersion: RUNNER_VERSION,
        scannerBuildSha256: SCANNER_BUILD_SHA256,
        advancedPointer,
        ...(advancedOwner
          ? {
              disposableSource: {
                nonce: advancedOwner.nonce,
                originalTabId: advancedOwner.source.tabId,
                originalUrl: advancedOwner.source.url,
                closed: false,
                cleanupStatus: 'RETAINED' as const,
              },
            }
          : {}),
        tabId: tab.id!,
        origin: parsed.origin,
        startUrl: normalizePublicUrl(decision.url),
        startedAt: services.now(),
        updatedAt: services.now(),
        state: 'AUTHORIZING',
        stopIntent: false,
        generation: crypto.randomUUID(),
        elapsedMs: 0,
        tasks: [
          {
            id: crypto.randomUUID(),
            url: decision.url,
            depth: 0,
            state: 'QUEUED',
            observations: [],
            reasons: [],
          },
        ],
        skippedLinks: 0,
        limitations: [
          'SUPPORTED_UI_PATTERNS_ONLY',
          'BACKGROUND_CAPTURE_REQUIRES_VALIDATION',
          ...(hasHashRoute(tab.url)
            ? [
                'HASH_VIEW_ROUTE_UNOBSERVED: only the current viewport is captured; fragment routing identity is omitted for privacy and not indexed as a tested route.',
              ]
            : []),
          ...(mode !== 'AUTONOMOUS'
            ? [
                'VIEWPORT_ONLY: only the current rendered viewport is measured; no automatic route discovery, navigation or scrolling.',
              ]
            : [
                'NAVIGATION_TRANSITIONS_INCLUDE_SOURCE_AND_DESTINATION: capture spans navigation; candidates during transitions do not identify a source element.',
              ]),
        ],
        mode,
        viewportDurationMs: viewportMs,
        ...(replayTarget
          ? {
              replayTarget,
              verificationOf: {
                jobId: previous!.id,
                taskId: message.replayOf!.taskId,
                observationId: message.replayOf!.observationId,
              },
            }
          : {}),
        limits: {
          ...DEFAULT_LIMITS,
          maxRoutes:
            replayTarget || mode !== 'AUTONOMOUS'
              ? 1
              : DEFAULT_LIMITS.maxRoutes,
          maxDurationMs:
            mode !== 'AUTONOMOUS'
              ? viewportMs + 30_000
              : DEFAULT_LIMITS.maxDurationMs,
        },
      };
      if (replayTarget) {
        job.tasks[0].url = replayTarget.route;
        job.startUrl = replayTarget.route;
        job.limitations.push(
          'TARGETED_RECHECK_ONLY: one stored scenario is repeated; other states are not evaluated.',
        );
      }
      await createJob(job);
      if (advancedOwner) {
        if (!matchingRecord(await services.loadAdvancedOwner(), advancedOwner))
          throw new Error('ADVANCED_OWNER_CHANGED');
        await services.persistAdvancedOwner({
          ...advancedOwner,
          phase: 'RUNNING',
          jobId: job.id,
          generation: job.generation,
        });
      }
      await services.authorize(job);
      if (replayTarget) await setPendingRecheck(undefined);
      if (advancedOwner) await services.showAdvancedDashboard(job);
      else
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`dashboard.html#${job.id}`),
          active: true,
        });
      return { id: job.id };
    }
    if (message.type === 'RESUME') {
      if (services.execution.running || services.execution.authorizing)
        throw new Error('Wacht tot de vorige meetstap is afgesloten.');
      const previous = await getJob(message.id);
      if (previous && !canResumeWithVersions(previous, ENGINE_VERSION))
        throw new Error(
          'De exacte scannerbuild ontbreekt of verschilt sinds deze scan. Start een nieuwe scan zodat meetversies niet worden gemengd. Het bestaande rapport blijft bewaard.',
        );
      const resumeOwner = previous?.disposableSource
        ? await services.validateAdvancedStart(
            {
              tabId: previous.tabId,
              mode: previous.mode,
              viewportSeconds: (previous.viewportDurationMs ?? 15000) / 1000,
              replayOf: previous.verificationOf,
            },
            true,
          )
        : undefined;
      if (previous?.advancedPointer && !resumeOwner)
        throw new Error(
          'Start voor deze oudere geavanceerde scan een nieuwe afzonderlijke voorbereiding.',
        );
      if (
        resumeOwner &&
        (resumeOwner.jobId !== previous!.id ||
          resumeOwner.generation !== previous!.generation)
      )
        throw new Error('ADVANCED_JOB_OWNER_CHANGED');
      const job = await resumeLease(message.id, crypto.randomUUID());
      if (resumeOwner)
        await services.persistAdvancedOwner({
          ...resumeOwner,
          phase: 'RUNNING',
          generation: job.generation,
        });
      await services.authorize(job);
      if (resumeOwner) await services.showAdvancedDashboard(job);
      return { id: job.id };
    }
    if (message.type === 'PAUSE' || message.type === 'STOP') {
      await stopRequestedCapture({
        id: message.id,
        type: message.type,
        running: Boolean(services.execution.running),
        now: services.now,
        mutate: mutateJob,
        cancel: (tabId) =>
          chrome.tabs.sendMessage(tabId, { type: 'FG_CANCEL' }),
        stop: (generation) =>
          services.offscreen('CAPTURE_STOP', { generation }),
      });
      if (
        message.type === 'STOP' &&
        !services.execution.running &&
        !services.execution.authorizing
      ) {
        const stopped = await getJob(message.id);
        if (stopped?.disposableSource)
          await services.finalizeAdvancedJob(stopped.id, stopped.generation);
      }
      return {};
    }
    if (message.type === 'OPEN_TARGET') {
      const job = await getJob(message.id);
      if (job?.disposableSource?.closed)
        throw new Error(
          'Het tijdelijke scantabblad is gesloten; het rapport blijft beschikbaar.',
        );
      if (job) await chrome.tabs.update(job.tabId, { active: true });
      return {};
    }
    if (message.type === 'EXPORT') {
      const job = await getJob(message.id);
      if (!job) throw new Error('Rapport niet gevonden.');
      return buildReport(
        prepareExportJobs([job], message.pseudonymize === true)[0],
      );
    }
    if (message.type === 'EXPORT_HTML') {
      const job = await getJob(message.id);
      if (!job) throw new Error('Rapport niet gevonden.');
      return buildHtmlReport(job, message.pseudonymize === true);
    }
    if (message.type === 'EXPORT_HISTORY') {
      const jobs = (await listJobs()).filter(
        (job) => !message.origin || job.origin === message.origin,
      );
      return buildHistoryExport(
        jobs,
        await getHistorySettings(),
        message.origin ? 'SITE' : 'ALL',
        message.pseudonymize === true,
      );
    }
    if (message.type === 'SET_HISTORY_SETTINGS') {
      await setHistorySettings(message.settings);
      return {};
    }
    if (message.type === 'SET_SCAN_PREFERENCES') {
      await setScanPreferences(message.mode, message.viewportSeconds);
      return {};
    }
    if (message.type === 'DELETE_HISTORY') {
      const owner = await services.loadAdvancedOwner();
      if (owner?.jobId)
        throw new Error(
          'Sluit eerst de geavanceerde scan of handel de handmatige herstelmelding af.',
        );
      await deleteHistory(
        typeof message.origin === 'string' ? message.origin : undefined,
      );
      return {};
    }
    if (message.type === 'DELETE') {
      if ((await services.loadAdvancedOwner())?.jobId === message.id)
        throw new Error('Sluit eerst het bijbehorende scantabblad.');
      await deleteJob(message.id);
      return {};
    }
    if (message.type === 'OPEN_DASHBOARD') {
      await chrome.tabs.create({
        url: chrome.runtime.getURL('dashboard.html'),
      });
      return {};
    }
    if (message.type === 'PUBLISH_PREVIEW') {
      const job = await getJob(message.id);
      if (!job || !TERMINAL_STATES.includes(job.state))
        throw new Error(
          'Rond de scan eerst af voordat je een uploadvoorbeeld opent.',
        );
      const snapshot = JSON.parse(JSON.stringify(buildReport(job)));
      const hash = await contentHash(snapshot);
      const nonce = crypto.randomUUID() + crypto.randomUUID();
      const tab = await chrome.tabs.create({
        url: 'about:blank',
        active: true,
      });
      if (tab.id === undefined)
        throw new Error('Uploadvoorbeeld kon niet geopend worden.');
      await putTransfer({
        nonce,
        jobId: job.id,
        expectedTabId: tab.id,
        expiresAt: Date.now() + 5 * 60_000,
        snapshot,
        contentHash: hash,
      });
      await chrome.tabs.update(tab.id, {
        url: `${services.__WEB_ORIGIN__}/publish#extension=${chrome.runtime.id}&nonce=${nonce}`,
      });
      return {};
    }
    if (message.type === 'CAPTURE_HEARTBEAT') return {};
    if (message.type === 'CAPTURE_LOST') {
      for (const job of await listJobs())
        if (
          job.generation === message.generation &&
          ['AUTHORIZING', 'RUNNING'].includes(job.state) &&
          services.capture.captureSources.get(job.id)?.sourceId ===
            message.sourceId
        ) {
          await mutateJob(job.id, (state) => {
            state.state = 'INTERRUPTED';
            state.stopIntent = true;
            state.stopReason = message.reason ?? 'CAPTURE_LOST';
            state.endedAt = services.now();
          });
        }
      return {};
    }
    throw new Error('Onbekende opdracht.');
  }
  async function continueStartIntent() {
    const pending = await getStartIntent();
    if (
      !pending ||
      pending.expiresAt <= Date.now() ||
      !(await chrome.permissions.contains({ origins: [`${pending.origin}/*`] }))
    )
      return;
    const tab = await chrome.tabs.get(pending.tabId).catch(() => undefined);
    if (!tab?.url || new URL(tab.url).origin !== pending.origin) {
      await consumeStartIntent(pending.id);
      return;
    }
    const intent = await consumeStartIntent(pending.id);
    if (intent)
      await handle({
        type: 'START',
        tabId: intent.tabId,
        mode: intent.mode,
        viewportSeconds: intent.viewportSeconds,
        replayOf: intent.replayOf,
        advancedPointer: intent.advancedPointer,
      });
  }
  return { handle, continueStartIntent };
}
