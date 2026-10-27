import { describe, expect, it } from 'vitest';
import {
  sameWorkspaceOwnership,
  type ViewportWorkspace,
} from '../../apps/chrome-extension/src/viewport-workspace';

function workspace() {
  return {
    tabId: 11,
    windowId: 2,
    originalWindowId: 1,
    originalIndex: 3,
    originalViewport: {
      width: 900,
      height: 450,
      dpr: 2,
      scroll: { x: 0, y: 156 },
      visual: {
        width: 900,
        height: 450,
        offsetLeft: 0,
        offsetTop: 0,
        scale: 1,
      },
    },
    detachedViewport: { width: 900, height: 507, dpr: 2 },
    originalWindow: { width: 900, height: 650, left: 20, top: 20 },
  };
}

function reorder(value: unknown, order: 'reverse' | 'alphabetical'): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const entries = Object.entries(value);
  if (order === 'reverse') entries.reverse();
  else entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(
    entries.map(([key, child]) => [key, reorder(child, order)]),
  );
}

function numberPaths(
  value: Record<string, unknown>,
  prefix: string[] = [],
): string[][] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = [...prefix, key];
    if (typeof child === 'number') return [path];
    return child && typeof child === 'object' && !Array.isArray(child)
      ? numberPaths(child as Record<string, unknown>, path)
      : [];
  });
}

function parent(value: unknown, path: string[]): Record<string, unknown> {
  let current = value as Record<string, unknown>;
  for (const key of path.slice(0, -1))
    current = current[key] as Record<string, unknown>;
  return current;
}

const numericLeaves = numberPaths(workspace()).map(
  (path) => [path.join('.'), path] as const,
);

describe('persisted workspace ownership equality', () => {
  it.each(['reverse', 'alphabetical'] as const)(
    'accepts recursively %s key order from storage while the previous JSON text comparison differs',
    (order) => {
      const original = workspace();
      const stored = reorder(original, order) as ViewportWorkspace;
      expect(JSON.stringify(stored)).not.toBe(JSON.stringify(original));
      expect(sameWorkspaceOwnership(stored, original)).toBe(true);
      expect(sameWorkspaceOwnership(original, stored)).toBe(true);
    },
  );

  it.each(numericLeaves)(
    'rejects a changed numeric leaf at %s, including captured extra context',
    (_name, path) => {
      const original = workspace();
      const changed = structuredClone(original);
      const object = parent(changed, path);
      const key = path.at(-1)!;
      object[key] = (object[key] as number) + 1;
      expect(sameWorkspaceOwnership(changed, original)).toBe(false);
      expect(sameWorkspaceOwnership(original, changed)).toBe(false);
    },
  );

  it.each(numericLeaves)(
    'rejects a missing numeric leaf at %s',
    (_name, path) => {
      const original = workspace();
      const changed = structuredClone(original);
      delete parent(changed, path)[path.at(-1)!];
      expect(sameWorkspaceOwnership(changed, original)).toBe(false);
      expect(sameWorkspaceOwnership(original, changed)).toBe(false);
    },
  );

  it.each(Object.keys(workspace()))(
    'rejects a missing top-level ownership field %s',
    (key) => {
      const original = workspace();
      const changed = structuredClone(original) as Record<string, unknown>;
      delete changed[key];
      expect(
        sameWorkspaceOwnership(
          changed as unknown as ViewportWorkspace,
          original,
        ),
      ).toBe(false);
      expect(
        sameWorkspaceOwnership(
          original,
          changed as unknown as ViewportWorkspace,
        ),
      ).toBe(false);
    },
  );

  it.each([
    [],
    ['originalViewport'],
    ['originalViewport', 'scroll'],
    ['originalViewport', 'visual'],
    ['detachedViewport'],
    ['originalWindow'],
  ])('rejects a one-sided extra field under %j', (...path) => {
    const original = workspace();
    const changed = structuredClone(original);
    parent(changed, [...path, 'extra']).extra = 'new ownership context';
    expect(sameWorkspaceOwnership(changed, original)).toBe(false);
    expect(sameWorkspaceOwnership(original, changed)).toBe(false);
  });

  it('retains equally stored extra JSON fields instead of silently projecting only known dimensions', () => {
    const original = {
      ...workspace(),
      context: { reason: 'terminal restore', confirmed: true },
    };
    const stored = reorder(original, 'alphabetical') as typeof original;
    expect(sameWorkspaceOwnership(stored, original)).toBe(true);
    stored.context.confirmed = false;
    expect(sameWorkspaceOwnership(stored, original)).toBe(false);
  });

  it('accepts a symmetrically absent optional detached viewport', () => {
    const original: ViewportWorkspace = workspace();
    delete original.detachedViewport;
    expect(
      sameWorkspaceOwnership(
        reorder(original, 'reverse') as ViewportWorkspace,
        original,
      ),
    ).toBe(true);
  });

  it.each([undefined, null, [], 42, 'workspace', true])(
    'rejects malformed ownership %j',
    (owner) => {
      expect(
        sameWorkspaceOwnership(
          owner as ViewportWorkspace | undefined,
          workspace(),
        ),
      ).toBe(false);
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    'rejects non-JSON numeric ownership %s even when present identically on both sides',
    (invalid) => {
      const original = workspace();
      original.originalViewport.width = invalid;
      expect(sameWorkspaceOwnership(structuredClone(original), original)).toBe(
        false,
      );
    },
  );

  it.each([null, [], undefined, '900'])(
    'rejects malformed nested ownership %j',
    (invalid) => {
      const original = workspace();
      const changed = structuredClone(original) as Record<string, unknown>;
      changed.originalViewport = invalid;
      expect(
        sameWorkspaceOwnership(
          changed as unknown as ViewportWorkspace,
          original,
        ),
      ).toBe(false);
    },
  );
});
