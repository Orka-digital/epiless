import type { ScanMode } from './model';
import type { DiagnosticContext } from './source-diagnostics';

export const ADVANCED_SCAN_OWNER_KEY = 'advanced-scan-owner';

export interface DisposableScanOwner {
  version: 1;
  nonce: string;
  phase:
    'CREATE_INTENT' | 'PREPARED' | 'RUNNING' | 'PAUSED' | 'CLOSING' | 'MANUAL';
  createdAt: number;
  source: {
    tabId: number;
    windowId: number;
    index: number;
    url: string;
    context: DiagnosticContext;
    window: { width: number; height: number; left: number; top: number };
  };
  foreground: { tabId: number; windowId: number };
  route: string;
  mode: ScanMode;
  viewportSeconds: number;
  scanTabId?: number;
  scanWindowId?: number;
  /** Set only after the caller verifies its existing compact workspace owner. */
  cleanupWindowId?: number;
  /** Original expiry survives worker restart; expired close is never retried. */
  cleanupExpiresAt?: number;
  jobId?: string;
  generation?: string;
  dashboardTabId?: number;
  replayOf?: { jobId: string; taskId: string; observationId: string };
  reason?: string;
}

/** Compare persisted JSON meaning, including additional fields, without relying
 * on object key order. Non-JSON values cannot establish ownership. */
export function matchingRecord(a: unknown, b: unknown): boolean {
  const seenLeft = new Set<object>(),
    seenRight = new Set<object>();
  const same = (left: unknown, right: unknown): boolean => {
    if (typeof left !== typeof right) return false;
    if (typeof left === 'number')
      return Number.isFinite(left) && left === right;
    if (left === null || right === null) return left === right;
    if (typeof left !== 'object')
      return (
        ['undefined', 'string', 'boolean'].includes(typeof left) &&
        left === right
      );
    if (seenLeft.has(left) || seenRight.has(right as object)) return false;
    seenLeft.add(left);
    seenRight.add(right as object);
    try {
      if (Array.isArray(left) || Array.isArray(right)) {
        return (
          Array.isArray(left) &&
          Array.isArray(right) &&
          left.length === right.length &&
          left.every(
            (item, index) => item !== undefined && same(item, right[index]),
          )
        );
      }
      const plain = (value: object) =>
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
      if (!plain(left) || !plain(right as object)) return false;
      const first = left as Record<string, unknown>,
        second = right as Record<string, unknown>;
      const keys = Object.keys(first)
        .filter((key) => first[key] !== undefined)
        .sort();
      const other = Object.keys(second)
        .filter((key) => second[key] !== undefined)
        .sort();
      return (
        keys.length === other.length &&
        keys.every(
          (key, index) => key === other[index] && same(first[key], second[key]),
        )
      );
    } finally {
      seenLeft.delete(left);
      seenRight.delete(right as object);
    }
  };
  return same(a, b);
}

const id = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const reason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);
const changed = () => new Error('DISPOSABLE_SCAN_OWNER_CHANGED');

export function validOwnedStart(
  owner: DisposableScanOwner | undefined,
  start: {
    tabId: number;
    url: string;
    mode: ScanMode;
    viewportSeconds: number;
    replayOf?: DisposableScanOwner['replayOf'];
    nonce?: string;
  },
): boolean {
  if (
    !owner ||
    owner.version !== 1 ||
    !['PREPARED', 'PAUSED'].includes(owner.phase) ||
    !owner.nonce ||
    (start.nonce !== undefined && owner.nonce !== start.nonce) ||
    !id(owner.scanTabId) ||
    !id(owner.scanWindowId) ||
    owner.scanTabId === owner.source?.tabId ||
    start.tabId !== owner.scanTabId ||
    start.url !== owner.route ||
    start.mode !== owner.mode ||
    !['AUTONOMOUS', 'QUICK', 'EXTENDED'].includes(owner.mode) ||
    !Number.isInteger(owner.viewportSeconds) ||
    owner.viewportSeconds < 15 ||
    owner.viewportSeconds > 120 ||
    start.viewportSeconds !== owner.viewportSeconds ||
    !matchingRecord(owner.replayOf, start.replayOf)
  )
    return false;
  try {
    const source = new URL(owner.source.url),
      route = new URL(owner.route);
    return (
      ['http:', 'https:'].includes(source.protocol) &&
      source.origin === route.origin
    );
  } catch {
    return false;
  }
}

type Storage = {
  load(): Promise<DisposableScanOwner | undefined>;
  persist(owner: DisposableScanOwner): Promise<void>;
};

/** A failed write must not erase the locally acknowledged browser receipt.
 * A newer stored owner always wins; cleanup never replaces that owner. */
async function manual(
  owner: DisposableScanOwner,
  error: unknown,
  storage: Storage,
  versions: DisposableScanOwner[],
  allowAbsent = false,
): Promise<DisposableScanOwner> {
  const retained: DisposableScanOwner = {
    ...structuredClone(owner),
    phase: 'MANUAL',
    reason: reason(error),
  };
  try {
    const current = await storage.load();
    if (
      (allowAbsent && current === undefined) ||
      versions.some((version) => matchingRecord(current, version))
    )
      await storage.persist(structuredClone(retained));
  } catch {
    /* The caller still receives the known receipt for manual recovery. */
  }
  return retained;
}

export async function createDisposableScan(
  options: Storage & {
    owner: DisposableScanOwner;
    create(
      owner: DisposableScanOwner,
    ): Promise<{ tabId: number; windowId: number }>;
  },
): Promise<DisposableScanOwner> {
  let owner = structuredClone(options.owner);
  const versions = [structuredClone(owner)];
  let initiallyAbsent = false;
  let intentPersisted = false;
  try {
    if (
      owner.version !== 1 ||
      owner.phase !== 'CREATE_INTENT' ||
      !owner.nonce ||
      owner.scanTabId !== undefined ||
      owner.scanWindowId !== undefined
    )
      throw new Error('DISPOSABLE_SCAN_INVALID_CREATE_INTENT');
    const initial = await options.load();
    initiallyAbsent = initial === undefined;
    if (initial !== undefined && !matchingRecord(initial, owner))
      throw changed();
    await options.persist(structuredClone(owner));
    intentPersisted = true;
    if (!matchingRecord(await options.load(), owner)) throw changed();
    const receipt = await options.create(structuredClone(owner));
    if (id(receipt?.tabId) && receipt.tabId !== owner.source.tabId)
      owner = { ...owner, scanTabId: receipt.tabId };
    if (id(receipt?.windowId))
      owner = { ...owner, scanWindowId: receipt.windowId };
    if (
      !id(receipt?.tabId) ||
      !id(receipt?.windowId) ||
      receipt.tabId === owner.source.tabId
    )
      throw new Error('DISPOSABLE_SCAN_CREATE_RECEIPT_UNKNOWN');
    owner = {
      ...owner,
      scanTabId: receipt.tabId,
      scanWindowId: receipt.windowId,
      phase: 'PREPARED',
    };
    versions.push(structuredClone(owner));
    // A receipt remains local even if ownership or persistence changed while
    // creation was awaited. It never grants permission to delete another tab.
    if (!matchingRecord(await options.load(), versions[0])) throw changed();
    await options.persist(structuredClone(owner));
    if (!matchingRecord(await options.load(), owner)) throw changed();
    return owner;
  } catch (error) {
    return manual(
      owner,
      error,
      options,
      versions,
      initiallyAbsent && !intentPersisted,
    );
  }
}

export async function closeDisposableScan(
  options: Storage & {
    owner: DisposableScanOwner;
    guard(owner: DisposableScanOwner): Promise<void>;
    remove(tabId: number): Promise<void>;
    /** undefined means an authoritative missing-tab response, never query failure. */
    locate(
      tabId: number,
    ): Promise<{ tabId: number; windowId: number } | undefined>;
  },
): Promise<boolean> {
  let owner = structuredClone(options.owner);
  const versions = [structuredClone(owner)];
  const assertOwned = async () => {
    if (!matchingRecord(await options.load(), owner)) throw changed();
  };
  const assertLocation = (location: { tabId: number; windowId: number }) => {
    if (
      location.tabId !== owner.scanTabId ||
      location.windowId !== (owner.cleanupWindowId ?? owner.scanWindowId)
    )
      throw new Error('DISPOSABLE_SCAN_TAB_MOVED');
  };
  try {
    if (
      !id(owner.scanTabId) ||
      !id(owner.scanWindowId) ||
      (owner.cleanupWindowId !== undefined && !id(owner.cleanupWindowId)) ||
      owner.scanTabId === owner.source.tabId
    )
      throw new Error('DISPOSABLE_SCAN_CLOSE_RECEIPT_UNKNOWN');
    await assertOwned();
    await options.guard(structuredClone(owner));
    const before = await options.locate(owner.scanTabId);
    if (before) assertLocation(before);
    await assertOwned();
    await options.guard(structuredClone(owner));
    owner = { ...owner, phase: 'CLOSING' };
    versions.push(structuredClone(owner));
    await options.persist(structuredClone(owner));
    await assertOwned();
    await options.guard(structuredClone(owner));
    const current = await options.locate(owner.scanTabId!);
    if (current) assertLocation(current);
    await assertOwned();
    await options.guard(structuredClone(owner));
    if (current) {
      await options.remove(owner.scanTabId!);
      await assertOwned();
      await options.guard(structuredClone(owner));
      if (await options.locate(owner.scanTabId!))
        throw new Error('DISPOSABLE_SCAN_CLOSE_UNCONFIRMED');
    }
    return true;
  } catch (error) {
    await manual(owner, error, options, versions);
    return false;
  }
}
