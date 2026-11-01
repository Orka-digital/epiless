import { createAnimationPhaseContent } from './animation-phase-content';

import { createContentControls } from './content-controls';

import { createContentInventory } from './content-inventory';

import { createContentTree } from './content-tree';

import { createMediaReplayContent } from './media-replay-content';

import type { PageInventory } from './model';

/** Own one installed document's cancellation, discovery and media restoration receipts. */
export function createContentSession() {
  const control = { cancelled: false, generation: 0 };
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

  const hasHashRoute = (url: URL) => /^#!?\//.test(url.hash);
  const pageInventory = createContentInventory(tree, policy);
  function inventory(): PageInventory {
    control.cancelled = false;
    control.generation++;
    return pageInventory.read();
  }

  return {
    control,
    originalMedia,
    tree,
    policy,
    pageInventory,
    rememberOriginalMedia,
    mediaReplay,
    animationPhase,
    hasHashRoute,
    inventory,
  };
}
export type ContentSession = ReturnType<typeof createContentSession>;
