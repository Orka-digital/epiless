import { createAnimationPhaseContent } from './animation-phase-content';
import { evaluateAction, planRoute, normalizePublicUrl } from '@epi-less/core';
import type { PageInventory, ReplayTarget } from './model';
import { createMediaReplayContent } from './media-replay-content';
import {
  diagnosticContext,
  diagnosticSources,
  structuralDiagnosticPath,
  resolveDiagnosticPath,
  type DiagnosticRequest,
} from './source-diagnostics';
import {
  startSourceTimeline,
  recordSourceTimelineEvent,
  stopSourceTimeline,
  inspectSourceTimelineTarget,
  cancelSourceTimeline,
} from './source-timeline';

const runtime = globalThis as typeof globalThis & {
  __flashguardInstalled?: boolean;
};
if (!runtime.__flashguardInstalled) {
  runtime.__flashguardInstalled = true;
  let cancelled = false;
  let actionGeneration = 0;
  type ControlKind = PageInventory['actions'][number]['kind'];
  const controlIds = new WeakMap<HTMLElement, string>();
  const controls = new Map<
    string,
    { element: HTMLElement; kind: ControlKind }
  >();
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
  // Bound work on large documents while inspecting modern open web components.
  // Closed shadow roots cannot be inspected through the standard DOM API.
  let inspectedElements: Element[] = [];
  let discoveryLimitations: string[] = [];
  const selectorCache = new Map<string, Element[]>();
  function refreshTree() {
    inspectedElements = [];
    discoveryLimitations = [];
    selectorCache.clear();
    const walkers = [
      document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT),
    ];
    let shadowRoots = 0;
    while (walkers.length) {
      const element = walkers.at(-1)!.nextNode() as Element | null;
      if (!element) {
        walkers.pop();
        continue;
      }
      if (inspectedElements.length >= 12_000) {
        discoveryLimitations.push('DOM_DISCOVERY_LIMIT_REACHED');
        break;
      }
      inspectedElements.push(element);
      if (element.shadowRoot) {
        if (shadowRoots >= 64) {
          if (
            !discoveryLimitations.includes(
              'SHADOW_ROOT_DISCOVERY_LIMIT_REACHED',
            )
          )
            discoveryLimitations.push('SHADOW_ROOT_DISCOVERY_LIMIT_REACHED');
          continue;
        }
        shadowRoots++;
        walkers.push(
          document.createTreeWalker(
            element.shadowRoot,
            NodeFilter.SHOW_ELEMENT,
          ),
        );
      }
    }
  }
  function queryAll<T extends Element = HTMLElement>(selector: string): T[] {
    let found = selectorCache.get(selector);
    if (!found) {
      found = inspectedElements.filter((element) => element.matches(selector));
      selectorCache.set(selector, found);
    }
    return found.filter((element) => element.isConnected) as T[];
  }
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
          ...inspectedElements.flatMap((element) =>
            element.shadowRoot ? [element.shadowRoot] : [],
          ),
        ],
        complete:
          discoveryLimitations.length === 0 &&
          queryAll('iframe,object,embed').length === 0 &&
          !inspectedElements.some(
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
        ...inspectedElements.flatMap((element) =>
          element.shadowRoot ? [element.shadowRoot] : [],
        ),
      ],
      complete:
        discoveryLimitations.length === 0 &&
        queryAll('iframe,object,embed').length === 0 &&
        !inspectedElements.some(
          (element) => element.localName.includes('-') && !element.shadowRoot,
        ),
    };
  });
  function composedParent(element: Element): Element | null {
    if (element.assignedSlot) return element.assignedSlot;
    const root = element.getRootNode();
    return (
      element.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
    );
  }
  function composedClosest(element: Element, selector: string): Element | null {
    for (
      let current: Element | null = element;
      current;
      current = composedParent(current)
    )
      if (current.matches(selector)) return current;
    return null;
  }
  function composedContains(parent: Element, element: Element): boolean {
    for (
      let current: Element | null = element;
      current;
      current = composedParent(current)
    )
      if (current === parent) return true;
    return false;
  }
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (!element.isConnected || rect.width <= 0 || rect.height <= 0)
      return false;
    for (
      let current: Element | null = element;
      current;
      current = composedParent(current)
    ) {
      const style = getComputedStyle(current);
      if (
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.display === 'none' ||
        Number(style.opacity) === 0
      )
        return false;
    }
    return true;
  };
  function controlledElement(element: HTMLElement): HTMLElement | null {
    const root = element.getRootNode();
    return root instanceof Document || root instanceof ShadowRoot
      ? root.getElementById(element.getAttribute('aria-controls') ?? '')
      : null;
  }
  function reachable(element: HTMLElement): boolean {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left),
      right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top),
      bottom = Math.min(innerHeight, rect.bottom);
    if (right <= left || bottom <= top) return false;
    // A covered control must never be activated by a synthetic click through a modal,
    // sticky overlay or cookie wall. Nested components require a composed hit test.
    const insetX = Math.min(4, (right - left) / 4);
    const insetY = Math.min(4, (bottom - top) / 4);
    return [
      [(left + right) / 2, (top + bottom) / 2],
      [left + insetX, top + insetY],
      [right - insetX, top + insetY],
      [left + insetX, bottom - insetY],
      [right - insetX, bottom - insetY],
    ].some(([x, y]) => {
      let hit = document.elementFromPoint(x!, y!);
      for (let depth = 0; hit?.shadowRoot && depth < 64; depth++) {
        const nested = hit.shadowRoot.elementFromPoint(x!, y!);
        if (!nested || nested === hit) break;
        hit = nested;
      }
      return Boolean(hit && composedContains(element, hit));
    });
  }
  function observedPanel(element: HTMLElement): boolean {
    if (
      !visible(element) ||
      composedClosest(element, '[aria-hidden="true"],[inert]')
    )
      return false;
    const rect = element.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  }
  const modal = () =>
    queryAll('[role="dialog"][aria-modal="true"],dialog[open]').find(visible);
  const hasHashRoute = (url: URL) => /^#!?\//.test(url.hash);
  function consentContainer(element: HTMLElement): HTMLElement | undefined {
    // Explicit adapters, never infer permission from arbitrary “reject” text.
    const container =
      element.id === 'onetrust-reject-all-handler'
        ? element.closest<HTMLElement>('#onetrust-banner-sdk')
        : element.id === 'CybotCookiebotDialogBodyButtonDecline'
          ? element.closest<HTMLElement>('#CybotCookiebotDialog')
          : null;
    return container && visible(container) ? container : undefined;
  }
  function carouselSlides(element: HTMLElement): HTMLElement[] {
    const controlled = controlledElement(element);
    if (
      !controlled ||
      controlled.getAttribute('aria-roledescription')?.toLowerCase() !==
        'carousel'
    )
      return [];
    return queryAll('[aria-roledescription="slide"]').filter((slide) =>
      composedContains(controlled, slide),
    );
  }
  const slideState = (element: HTMLElement) =>
    carouselSlides(element)
      .map(
        (slide, index) =>
          `${index}:${visible(slide)}:${slide.getAttribute('aria-hidden')}:${slide.getAttribute('aria-current')}`,
      )
      .join('|');
  function controlState(element: HTMLElement, kind: ControlKind): string {
    if (kind === 'carousel') return slideState(element);
    if (kind === 'media' && element instanceof HTMLVideoElement)
      return `media:${element.paused ? 'paused' : 'playing'}:${element.muted}`;
    if (kind === 'consent-reject')
      return `consent:${Boolean(consentContainer(element))}`;
    const panel = controlledElement(element);
    return `${kind}:${element.getAttribute(kind === 'tab' ? 'aria-selected' : 'aria-expanded') === 'true'}:${Boolean(panel && observedPanel(panel))}`;
  }
  function deeplyFocused(element: HTMLElement): boolean {
    let current = document.activeElement;
    for (
      let depth = 0;
      current?.shadowRoot?.activeElement && depth < 64;
      depth++
    )
      current = current.shadowRoot.activeElement;
    return current === element;
  }
  function controlKind(element: HTMLElement): ControlKind {
    return consentContainer(element)
      ? 'consent-reject'
      : element instanceof HTMLVideoElement
        ? 'media'
        : element.getAttribute('role') === 'tab'
          ? 'tab'
          : carouselSlides(element).length
            ? 'carousel'
            : ['menu', 'true'].includes(
                  element.getAttribute('aria-haspopup') ?? '',
                )
              ? 'menu'
              : 'accordion';
  }
  function safeControl(element: HTMLElement, kind: ControlKind) {
    // Incomplete traversal cannot prove the absence of a nested form, password
    // field or blocking dialog. Keep observing pixels, but do not activate it.
    if (discoveryLimitations.length) return false;
    if (
      element.matches(
        'input,select,textarea,label,[form],[formaction],[formmethod]',
      ) ||
      (element instanceof HTMLButtonElement && element.form)
    )
      return false;
    if (
      !element.isConnected ||
      !visible(element) ||
      composedClosest(
        element,
        'form,[contenteditable]:not([contenteditable="false"]),[aria-hidden="true"],[inert],a[href]',
      ) ||
      element.hasAttribute('disabled') ||
      element.getAttribute('aria-disabled') === 'true'
    )
      return false;
    const consent =
      kind === 'consent-reject' ? consentContainer(element) : undefined;
    if (kind === 'consent-reject' && !consent) return false;
    const blockingModal = modal();
    if (
      blockingModal &&
      (!consent ||
        (!composedContains(consent, blockingModal) &&
          !composedContains(blockingModal, consent)))
    )
      return false;
    if (kind === 'media') return element instanceof HTMLVideoElement;
    const controlsId = consent?.id ?? element.getAttribute('aria-controls');
    if (!controlsId) return false;
    const controlled = consent ?? controlledElement(element);
    if (
      !controlled ||
      controlled.matches(
        `form,input,select,textarea${consent ? '' : ',[role="dialog"]'}`,
      ) ||
      queryAll(
        'form,input[type="password"],[autocomplete="one-time-code"],[id*="captcha"],[class*="captcha"],iframe[src*="captcha"]',
      ).some((sensitive) => composedContains(controlled, sensitive))
    )
      return false;
    if (kind === 'carousel' && carouselSlides(element).length < 2) return false;
    const identifiers = [
      element.id,
      element.getAttribute('name'),
      controlsId,
      element.getAttribute('aria-label'),
      element.textContent,
    ].join(' ');
    if (
      /log.?in|sign.?in|inloggen|aanmelden|permission|authorize|authorise|toestemming|password|wachtwoord|captcha/i.test(
        identifiers,
      )
    )
      return false;
    return evaluateAction({
      kind,
      role:
        element.getAttribute('role') ??
        (element instanceof HTMLButtonElement ? 'button' : undefined),
      type: element.getAttribute('type') ?? undefined,
      href: element.getAttribute('href') ?? undefined,
      text: (
        element.getAttribute('aria-label') ??
        element.textContent ??
        ''
      ).slice(0, 300),
      ariaControls: controlsId,
      ariaExpanded: element.hasAttribute('aria-expanded')
        ? element.getAttribute('aria-expanded') === 'true'
        : undefined,
      inForm: !!composedClosest(element, 'form'),
      download: element.hasAttribute('download'),
    }).allowed;
  }
  function inventory(): PageInventory {
    cancelled = false;
    actionGeneration++;
    controls.clear();
    refreshTree();
    const actions: PageInventory['actions'] = [];
    for (const element of queryAll(
      'button[aria-controls],[role="button"][aria-controls],[role="tab"][aria-controls],video,#onetrust-reject-all-handler,#CybotCookiebotDialogBodyButtonDecline',
    )) {
      const kind = controlKind(element);
      if (!safeControl(element, kind)) continue;
      const id = controlIds.get(element) ?? crypto.randomUUID();
      controlIds.set(element, id);
      controls.set(id, { element, kind });
      const selectorPath = structuralDiagnosticPath(element);
      actions.push({
        id,
        kind,
        label: kind,
        target: selectorPath ? { selectorPath, kind } : undefined,
        state: controlState(element, kind),
        focusable: element.tabIndex >= 0,
      });
      if (actions.length >= 25) break;
    }
    const limitations = [...discoveryLimitations];
    if (actions.length > 24) {
      limitations.push('CONTROL_DISCOVERY_LIMIT_REACHED');
      actions.length = 24;
    }
    if (actions.some((action) => action.kind === 'carousel'))
      limitations.push(
        'CAROUSEL_SAMPLING_LIMIT: supported controls have a bounded multi-step cycle; unvisited slide states remain untested.',
      );
    if (queryAll('iframe').length) limitations.push('IFRAME_DOM_NOT_INSPECTED');
    if (
      queryAll(
        'input[type="password"],iframe[src*="captcha"],[id*="captcha"],[class*="captcha"]',
      ).length
    )
      limitations.push('LOGIN_OR_CAPTCHA_UNOBSERVED');
    if (modal() && !actions.some((action) => action.kind === 'consent-reject'))
      limitations.push('MODAL_DIALOG_UNOBSERVED');
    const discoveredLinks = queryAll<HTMLAnchorElement>('a[href]').filter(
      (link) =>
        visible(link) &&
        !link.download &&
        !composedClosest(link, 'form,[inert],[aria-hidden="true"]'),
    );
    if (discoveredLinks.length > 1000)
      limitations.push('LINK_DISCOVERY_LIMIT_REACHED');
    const links = discoveredLinks.slice(0, 1000);
    if (links.some((link) => hasHashRoute(new URL(link.href))))
      limitations.push('HASH_ROUTER_ROUTES_UNOBSERVED');
    return {
      url: location.href,
      mediaPresent: queryAll('video').length > 0,
      title: '',
      links: links
        .filter((link) => !hasHashRoute(new URL(link.href)))
        .map((link) => link.href),
      actions,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      scrollHeight: document.documentElement.scrollHeight,
      scrollY,
      limitations,
    };
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
      if (discoveryLimitations.length)
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
      if (discoveryLimitations.length)
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
        : controls.get(message.actionId ?? '');
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
