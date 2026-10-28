/**
 * Install one page-local message dispatcher, owning action cancellation and restoration.
 * Discovery, control safety and media evidence remain separate collaborators; only
 * extension-origin messages enter this dispatcher. No remote report publication occurs here.
 */
import { evaluateAction, normalizePublicUrl, planRoute } from '@epi-less/core';
import { createAnimationPhaseContent } from './animation-phase-content';
import { createContentControls } from './content-controls';
import {
  composedClosest,
  controlledElement,
  observedPanel,
  reachable,
  visible,
} from './content-dom';
import { createContentInventory } from './content-inventory';
import { createContentTree } from './content-tree';
import { createMediaReplayContent } from './media-replay-content';
import type { PageInventory, ReplayTarget } from './model';
import {
  diagnosticContext,
  diagnosticSources,
  resolveDiagnosticPath,
  type DiagnosticRequest,
} from './source-diagnostics';
import {
  cancelSourceTimeline,
  inspectSourceTimelineTarget,
  recordSourceTimelineEvent,
  startSourceTimeline,
  stopSourceTimeline,
} from './source-timeline';

const runtime = globalThis as typeof globalThis & {
  __flashguardInstalled?: boolean;
};
if (!runtime.__flashguardInstalled) {
  runtime.__flashguardInstalled = true;
  let cancelled = false;
  let actionGeneration = 0;
  const originalMedia = new Map<
    HTMLVideoElement,
    {
      muted: boolean;
      paused: boolean;
      time: number;
      playbackRate: number;
      loop: boolean;
    }
  >();
  const tree = createContentTree();
  const { refreshTree, queryAll } = tree;
  function rememberOriginalMedia(video: HTMLVideoElement) {
    if (!originalMedia.has(video))
      originalMedia.set(video, {
        muted: video.muted,
        paused: video.paused,
        time: video.currentTime,
        playbackRate: video.playbackRate,
        loop: video.loop,
      });
  }
  const mediaReplay = createMediaReplayContent({
    remember: rememberOriginalMedia,
    discover: () => {
      refreshTree();
      return {
        videos: queryAll<HTMLVideoElement>('video'),
        roots: [
          document,
          ...tree.elements.flatMap((element) =>
            element.shadowRoot ? [element.shadowRoot] : [],
          ),
        ],
        complete:
          tree.limitations.length === 0 &&
          queryAll('iframe,object,embed').length === 0 &&
          !tree.elements.some(
            (element) => element.localName.includes('-') && !element.shadowRoot,
          ),
      };
    },
  });
  const animationPhase = createAnimationPhaseContent(() => {
    refreshTree();
    return {
      roots: [
        document,
        ...tree.elements.flatMap((element) =>
          element.shadowRoot ? [element.shadowRoot] : [],
        ),
      ],
      complete:
        tree.limitations.length === 0 &&
        queryAll('iframe,object,embed').length === 0 &&
        !tree.elements.some(
          (element) => element.localName.includes('-') && !element.shadowRoot,
        ),
    };
  });
  const policy = createContentControls(tree);
  const {
    modal,
    consentContainer,
    carouselSlides,
    slideState,
    controlState,
    deeplyFocused,
    controlKind,
    safeControl,
  } = policy;
  const hasHashRoute = (url: URL) => /^#!?\//.test(url.hash);
  const pageInventory = createContentInventory(tree, policy);
  function inventory(): PageInventory {
    cancelled = false;
    actionGeneration++;
    return pageInventory.read();
  }
  async function execute(message: {
    type: string;
    actionId?: string;
    y?: number;
    url?: string;
    request?: DiagnosticRequest;
    target?: ReplayTarget;
    expectedState?: string;
    generation?: string;
    segmentId?: string;
    event?: unknown;
    token?: string;
    mediaPlan?: unknown;
    stage?: 'before' | 'after';
  }) {
    if (message.type === 'FG_PHASE_CLOCK') return animationPhase.clock();
    if (message.type === 'FG_PHASE_BEGIN')
      return animationPhase.begin(message.generation!, message.segmentId!);
    if (message.type === 'FG_PHASE_TRIGGER')
      return animationPhase.trigger(
        message.generation!,
        message.segmentId!,
        message.stage!,
      );
    if (message.type === 'FG_PHASE_STOP')
      return animationPhase.stop(message.generation!, message.segmentId!);
    if (message.type === 'FG_MEDIA_SNAPSHOT') return mediaReplay.snapshot();
    if (message.type === 'FG_MEDIA_REPLAY_PREPARE')
      return mediaReplay.prepare(message.mediaPlan);
    if (message.type === 'FG_MEDIA_REPLAY_RELEASE')
      return mediaReplay.release();
    if (message.type === 'FG_MEDIA_OBSERVATION_START')
      return mediaReplay.start(message.generation!, message.segmentId!);
    if (message.type === 'FG_MEDIA_OBSERVATION_PROGRESS')
      return mediaReplay.progress(
        message.generation!,
        message.segmentId!,
        message.mediaPlan,
      );
    if (message.type === 'FG_MEDIA_OBSERVATION_BEGIN')
      return mediaReplay.begin(message.generation!, message.segmentId!);
    if (message.type === 'FG_MEDIA_OBSERVATION_STOP')
      return mediaReplay.stop(message.generation!, message.segmentId!);
    if (message.type === 'FG_SOURCE_TIMELINE_START')
      return startSourceTimeline({
        generation: message.generation!,
        segmentId: message.segmentId!,
      });
    if (message.type === 'FG_SOURCE_TIMELINE_EVENT')
      return recordSourceTimelineEvent(
        message.event as Parameters<typeof recordSourceTimelineEvent>[0],
      );
    if (message.type === 'FG_SOURCE_TIMELINE_STOP')
      return stopSourceTimeline({
        generation: message.generation!,
        segmentId: message.segmentId!,
      });
    if (message.type === 'FG_INSPECT_SOURCE')
      return inspectSourceTimelineTarget(message.token!);
    if (message.type === 'FG_DIAGNOSTIC_CONTEXT') return diagnosticContext();
    if (message.type === 'FG_DIAGNOSTIC_SOURCES')
      return diagnosticSources(message.request!);
    if (message.type === 'FG_CANCEL') {
      cancelSourceTimeline();
      mediaReplay.cancel();
      animationPhase.cancel();
      cancelled = true;
      actionGeneration++;
      return { achieved: true };
    }
    if (message.type === 'FG_INVENTORY') return inventory();
    if (message.type === 'FG_NAVIGATE') {
      refreshTree();
      if (tree.limitations.length)
        return { initiated: false, reason: 'NAVIGATION_DISCOVERY_INCOMPLETE' };
      const decision = planRoute({
        candidate: message.url ?? '',
        baseUrl: location.href,
        origin: location.origin,
        depth: 0,
      });
      if (
        !decision.allowed ||
        !decision.url ||
        hasHashRoute(new URL(message.url ?? '', location.href))
      )
        return { initiated: false, reason: 'NAVIGATION_OUTSIDE_POLICY' };
      const safeLink = (link: HTMLAnchorElement) =>
        visible(link) &&
        !link.download &&
        !composedClosest(link, 'form,[inert],[aria-hidden="true"]') &&
        !link.hasAttribute('aria-disabled') &&
        !link.hasAttribute('role') &&
        (!link.target || link.target === '_self') &&
        link.href === decision.url &&
        evaluateAction({
          kind: 'scroll',
          text: `${link.getAttribute('aria-label') ?? ''} ${link.textContent ?? ''}`,
        }).allowed;
      const link = queryAll<HTMLAnchorElement>('a[href]').find(safeLink);
      if (!link || modal())
        return { initiated: false, reason: 'NO_SUPPORTED_NAVIGATION_LINK' };
      cancelled = false;
      const generation = ++actionGeneration;
      link.scrollIntoView({ behavior: 'instant', block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (cancelled || generation !== actionGeneration || !safeLink(link))
        return { initiated: false, reason: 'NAVIGATION_CANCELLED' };
      refreshTree();
      if (tree.limitations.length)
        return { initiated: false, reason: 'NAVIGATION_DISCOVERY_INCOMPLETE' };
      if (modal() || !reachable(link))
        return { initiated: false, reason: 'NAVIGATION_LINK_OBSCURED' };
      const from = normalizePublicUrl(location.href);
      link.click();
      return { initiated: true, from };
    }
    if (message.type === 'FG_SCROLL') {
      const y = Math.max(0, Math.min(Number(message.y) || 0, 50_000));
      window.scrollTo({ left: 0, top: y, behavior: 'instant' });
      return {
        achieved:
          Math.abs(
            window.scrollY -
              Math.min(
                y,
                Math.max(
                  0,
                  document.documentElement.scrollHeight - innerHeight,
                ),
              ),
          ) < 4,
        reason: 'SCROLL_REQUESTED',
      };
    }
    if (message.type === 'FG_RESTORE') {
      cancelSourceTimeline();
      mediaReplay.cancel();
      animationPhase.cancel();
      cancelled = true;
      actionGeneration++;
      for (const [video, original] of originalMedia) {
        if (!video.isConnected) continue;
        video.pause();
        video.muted = original.muted;
        video.playbackRate = original.playbackRate;
        video.loop = original.loop;
        try {
          video.currentTime = original.time;
        } catch {
          /* Streaming media may not be seekable. */
        }
        // Never restart sound or playback during teardown.
      }
      originalMedia.clear();
      return { achieved: true };
    }
    if (message.type === 'FG_HOVER')
      return {
        achieved: false,
        reason: 'HOVER_REQUIRES_TRUSTED_POINTER_DRIVER',
      };
    if (
      ![
        'FG_ACTION',
        'FG_FOCUS',
        'FG_POINTER_TARGET',
        'FG_POINTER_CONFIRM',
      ].includes(message.type)
    )
      throw new Error('Unsupported content command');
    refreshTree();
    const resolved = message.target
      ? resolveDiagnosticPath(message.target.selectorPath)
      : undefined;
    const target =
      message.target && resolved instanceof HTMLElement
        ? { element: resolved, kind: message.target.kind }
        : pageInventory.resolveControl(message.actionId ?? '');
    if (
      message.target &&
      (!target || controlKind(target.element) !== message.target.kind)
    )
      return { achieved: false, reason: 'REPLAY_CONTROL_KIND_CHANGED' };
    if (!target || !safeControl(target.element, target.kind))
      return { achieved: false, reason: 'CONTROL_NO_LONGER_ALLOWED' };
    const { element, kind } = target;
    const generation = actionGeneration;
    element.scrollIntoView({ behavior: 'instant', block: 'center' });
    // Let scroll listeners run, then reject controls whose form/action semantics changed.
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (cancelled || generation !== actionGeneration)
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
      if (['media', 'consent-reject'].includes(kind))
        return { achieved: false, reason: 'POINTER_TARGET_OUTSIDE_POLICY' };
      const rect = element.getBoundingClientRect();
      const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
      const y =
        (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
      if (message.type === 'FG_POINTER_TARGET') return { achieved: true, x, y };
      await new Promise((resolve) => setTimeout(resolve, 300));
      const achieved =
        !cancelled &&
        generation === actionGeneration &&
        safeControl(element, kind) &&
        reachable(element) &&
        element.matches(':hover');
      return {
        achieved,
        reason: achieved ? undefined : 'NATIVE_HOVER_STATE_NOT_CONFIRMED',
        state: achieved ? `hover:${controlState(element, kind)}` : undefined,
      };
    }
    if (element.tabIndex >= 0) element.focus({ preventScroll: true });
    refreshTree();
    if (!safeControl(element, kind))
      return { achieved: false, reason: 'CONTROL_CHANGED_DURING_FOCUS' };
    if (!reachable(element))
      return { achieved: false, reason: 'CONTROL_OBSCURED' };
    if (message.type === 'FG_FOCUS') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const achieved =
        !cancelled &&
        generation === actionGeneration &&
        deeplyFocused(element) &&
        safeControl(element, kind) &&
        reachable(element);
      return {
        achieved,
        reason: achieved ? undefined : 'FOCUS_STATE_NOT_CONFIRMED',
        state: achieved ? `focus:${controlState(element, kind)}` : undefined,
        fromUrl: beforeUrl,
        url: normalizePublicUrl(location.href),
      };
    }
    if (kind === 'media' && element instanceof HTMLVideoElement) {
      rememberOriginalMedia(element);
      element.muted = true;
      let playTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const initialTime = element.currentTime;
        const initialFrames =
          element.getVideoPlaybackQuality().totalVideoFrames;
        await Promise.race([
          element.play(),
          new Promise<never>((_, reject) => {
            playTimeout = setTimeout(
              () => reject(new Error('PLAYBACK_TIMEOUT')),
              2500,
            );
          }),
        ]);
        const deadline = performance.now() + 1500;
        let progressed = false;
        while (
          performance.now() < deadline &&
          !cancelled &&
          generation === actionGeneration
        ) {
          progressed =
            element.currentTime > initialTime + 0.01 ||
            element.getVideoPlaybackQuality().totalVideoFrames > initialFrames;
          if (progressed) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const achieved =
          !cancelled &&
          generation === actionGeneration &&
          progressed &&
          !element.paused &&
          !element.ended;
        return {
          achieved,
          reason: achieved
            ? undefined
            : cancelled
              ? 'ACTION_CANCELLED'
              : 'MEDIA_PLAYBACK_NOT_PROGRESSING',
          fromUrl: beforeUrl,
          url: normalizePublicUrl(location.href),
          state: achieved ? controlState(element, kind) : undefined,
        };
      } catch {
        element.pause();
        return { achieved: false, reason: 'MEDIA_PLAYBACK_REFUSED' };
      } finally {
        if (playTimeout) clearTimeout(playTimeout);
      }
    }
    const controlled = controlledElement(element);
    if (kind === 'tab' && element.getAttribute('aria-selected') === 'true')
      return {
        achieved: Boolean(controlled && observedPanel(controlled)),
        reason: 'ALREADY_SELECTED',
        state: controlState(element, kind),
      };
    if (
      ['accordion', 'menu'].includes(kind) &&
      element.getAttribute('aria-expanded') === 'true'
    )
      return {
        achieved: Boolean(controlled && observedPanel(controlled)),
        reason: 'ALREADY_EXPANDED',
        state: controlState(element, kind),
      };
    const slidesBefore = kind === 'carousel' ? slideState(element) : '';
    const consentBefore =
      kind === 'consent-reject' ? consentContainer(element) : undefined;
    element.click();
    const confirm = () =>
      kind === 'carousel'
        ? slideState(element) !== slidesBefore &&
          carouselSlides(element).some(
            (slide) =>
              visible(slide) && slide.getAttribute('aria-hidden') !== 'true',
          )
        : kind === 'consent-reject'
          ? Boolean(
              consentBefore &&
              (!consentBefore.isConnected || !visible(consentBefore)),
            )
          : kind === 'tab'
            ? element.getAttribute('aria-selected') === 'true' &&
              Boolean(controlled && observedPanel(controlled))
            : element.getAttribute('aria-expanded') === 'true' &&
              Boolean(controlled && observedPanel(controlled));
    // Framework transitions and deferred controls need real state evidence,
    // not a fixed 300ms guess. Remain within the existing content RPC deadline.
    const deadline = performance.now() + 2_500;
    while (
      !confirm() &&
      performance.now() < deadline &&
      !cancelled &&
      generation === actionGeneration
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (cancelled || generation !== actionGeneration)
      return { achieved: false, reason: 'ACTION_CANCELLED' };
    const state = controlState(element, kind);
    const achieved =
      confirm() && (!message.expectedState || message.expectedState === state);
    return {
      achieved,
      reason: achieved ? undefined : 'CONTROL_STATE_NOT_CONFIRMED',
      fromUrl: beforeUrl,
      url: normalizePublicUrl(location.href),
      state: achieved ? state : undefined,
    };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !message?.type?.startsWith('FG_'))
      return;
    void execute(message).then(
      (value) => respond({ ok: true, value }),
      (error) => respond({ ok: false, error: String(error) }),
    );
    return true;
  });
}
