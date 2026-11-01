import assert from 'node:assert/strict';
/** Assert preparation receipts predate capture and leave the original page untouched. */
export function verifyOwnedPreparation(evidence) {
  const { job, ownedScan: owned } = evidence;
  assert.equal(
    evidence.environment.extensionBuild.embeddedScannerBuildSha256,
    job.scannerBuildSha256,
    'Actual cold-build identity must match the owned scan job.',
  );
  assert.equal(owned?.version, 1);
  const initial = owned.originalInitial,
    prepared = owned.preparation;
  assert.ok(
    initial && prepared?.owner && prepared.original && owned.after,
    'Original pre-PREPARE and actual PREPARED snapshots are required.',
  );
  const owner = prepared.owner;
  assert.equal(owner.version, 1);
  assert.equal(owner.phase, 'PREPARED');
  assert.ok(typeof owner.nonce === 'string' && owner.nonce.length >= 16);
  assert.ok(Number.isFinite(owner.createdAt));
  assert.ok(
    initial.at <= owner.createdAt &&
      owner.createdAt <= prepared.at &&
      prepared.at < Date.parse(job.startedAt),
    'Original evidence must precede the real preparation and second toolbar start.',
  );
  assert.equal(initial.document.width, 900);
  assert.equal(initial.document.height, 507);
  assert.ok(
    initial.document.at <= initial.at &&
      initial.at - initial.document.at < 1500,
  );
  assert.ok(
    typeof initial.document.documentId === 'string' &&
      initial.document.documentId.length >= 16,
  );
  assert.ok(Number.isFinite(initial.document.timeOrigin));
  assert.equal(initial.tab.active, true);
  assert.equal(initial.window.focused, true);
  assert.equal(initial.foregroundTabId, initial.tab.id);
  assert.equal(owner.source.tabId, initial.tab.id);
  assert.equal(owner.source.windowId, initial.tab.windowId);
  assert.equal(owner.source.index, initial.tab.index);
  assert.equal(owner.source.url, initial.document.url);
  assert.equal(owner.source.context.url, owner.source.url);
  for (const field of ['width', 'height', 'left', 'top'])
    assert.equal(owner.source.window[field], initial.window[field]);
  assert.ok(
    typeof owner.source.context.documentToken === 'string' &&
      owner.source.context.documentToken.length >= 16,
  );
  assert.equal(owner.scanTabId, job.tabId);
  assert.notEqual(
    job.tabId,
    initial.tab.id,
    'Capture must use the disposable tab, never the original.',
  );
  assert.equal(owner.scanWindowId, initial.tab.windowId);
  assert.equal(job.disposableSource?.nonce, owner.nonce);
  assert.equal(job.disposableSource.originalTabId, initial.tab.id);
  assert.equal(job.disposableSource.originalUrl, owner.source.url);
  assert.equal(job.disposableSource.closed, true);
  assert.equal(job.disposableSource.cleanupStatus, 'CLOSED');
  assert.ok(
    !prepared.capturedTabs.some(
      (value) =>
        [owner.scanTabId, initial.tab.id].includes(value.tabId) &&
        ['active', 'pending'].includes(value.status),
    ),
    'PREPARE alone must not start capture.',
  );
  assert.ok(
    !prepared.debuggerTabIds.some((id) =>
      [owner.scanTabId, initial.tab.id].includes(id),
    ),
    'PREPARE alone must not attach the debugger.',
  );

  return { initial, prepared, owner };
}

/** Confirm the original tab, document and window retain their pre-scan identity. */
export function assertOwnedOriginal(snapshot, initial, owner) {
  assert.ok(
    snapshot?.document && snapshot.context,
    'Current original document evidence is required.',
  );
  for (const field of ['id', 'windowId', 'index', 'url', 'pinned', 'groupId'])
    assert.equal(
      snapshot.tab[field],
      initial.tab[field],
      `Original tab ${field} changed.`,
    );
  for (const field of ['id', 'width', 'height', 'left', 'top'])
    assert.equal(
      snapshot.window[field],
      initial.window[field],
      `Original window ${field} changed.`,
    );
  for (const field of [
    'documentId',
    'url',
    'timeOrigin',
    'width',
    'height',
    'dpr',
  ])
    assert.equal(
      snapshot.document[field],
      initial.document[field],
      `Original page ${field} changed.`,
    );
  assert.equal(snapshot.zoom, initial.zoom);
  assert.equal(
    snapshot.context.documentToken,
    owner.source.context.documentToken,
  );
  assert.equal(snapshot.context.url, owner.source.context.url);
  assert.deepEqual(snapshot.context.viewport, owner.source.context.viewport);
  if (owner.source.context.viewportRevision !== undefined)
    assert.equal(
      snapshot.context.viewportRevision,
      owner.source.context.viewportRevision,
    );
  for (const field of ['width', 'height', 'dpr'])
    assert.equal(snapshot.context.viewport[field], initial.document[field]);
}
