import { evaluateAction } from '@epi-less/core';
import {
  composedClosest,
  composedContains,
  controlledElement,
  observedPanel,
  visible,
} from './content-dom';
import type { createContentTree } from './content-tree';
import type { PageInventory } from './model';

type ControlKind = PageInventory['actions'][number]['kind'];

/**
 * Build conservative control policy against the current bounded DOM snapshot.
 * @param tree - Shared traversal owner, refreshed by the caller before each action.
 * @returns Read-only predicates and observed state; methods never activate controls.
 */
export function createContentControls(
  tree: ReturnType<typeof createContentTree>,
) {
  const { queryAll } = tree;
  const modal = () =>
    queryAll('[role="dialog"][aria-modal="true"],dialog[open]').find(visible);
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
  /** Reject incomplete discovery, forms, authorization flows and unknown modal boundaries. */
  function safeControl(element: HTMLElement, kind: ControlKind) {
    // Incomplete traversal cannot prove the absence of a nested form, password
    // field or blocking dialog. Keep observing pixels, but do not activate it.
    if (tree.limitations.length) return false;
    if (!availableControlElement(element)) return false;
    const consent =
      kind === 'consent-reject' ? consentContainer(element) : undefined;
    if (kind === 'consent-reject' && !consent) return false;
    const blockingModal = modal();
    if (blockedByModal(blockingModal, consent)) return false;
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
    return allowedControlSemantics(element, kind, controlsId);
  }
  return {
    modal,
    consentContainer,
    carouselSlides,
    slideState,
    controlState,
    deeplyFocused,
    controlKind,
    safeControl,
  };
}

function allowedControlSemantics(
  element: HTMLElement,
  kind: ControlKind,
  controlsId: string,
): boolean {
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

function availableControlElement(element: HTMLElement): boolean {
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
  return true;
}

function blockedByModal(
  blockingModal: HTMLElement | undefined,
  consent: HTMLElement | undefined,
): boolean {
  return Boolean(
    blockingModal &&
    (!consent ||
      (!composedContains(consent, blockingModal) &&
        !composedContains(blockingModal, consent))),
  );
}
