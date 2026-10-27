// Explicit native recheck variant. The original candidate page is untouched.
// The same URL deliberately serves changed site content between new documents;
// source-byte identity is recorded separately and is never a scanner claim.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { nativeCandidatePage } from './native-candidate-page.mjs';
import {
  encodedPageSource,
  serveEncodedAsset,
  sha256,
} from './native-encoded-source.mjs';

export const recheckMediaPath = '/__native-encoded/recheck.webm';
export const recheckEvidencePath = '/__native-encoded-recheck-evidence';
export const recheckPolicy = Object.freeze({
  version: 1,
  source: 'ENCODED_VP9_STABLE_LOCATOR_SITE_FIX',
  mediaPath: recheckMediaPath,
  action: 'Play the already paused-at-zero file without a redundant seek.',
  identity:
    'Identical locator, duration, rate and decoded PTS; signal/fixed file bytes intentionally differ. Locator equality is not content equality.',
});

export function encodedRecheckHtml(assets, fixed, identity) {
  const encoded = {
    ...encodedPageSource(assets, fixed),
    url: recheckMediaPath,
  };
  let html = nativeCandidatePage({ fixed, encoded });
  const oldAction = 'if(state.encoded){marker.currentTime=0;marker.play()';
  assert.equal(
    html.split(oldAction).length,
    2,
    'Original fixture action must be unambiguous',
  );
  html = html.replace(oldAction, 'if(state.encoded){marker.play()');
  const instrumentation = `<script>(()=>{
    const state=window.__nativeCandidateFixture,video=document.querySelector('#stimulus');
    state.recheckDocument=${JSON.stringify(identity)};
    const flush=()=>{const body=JSON.stringify(state);if(body.length<=131072)navigator.sendBeacon(${JSON.stringify(recheckEvidencePath)},new Blob([body],{type:'application/json'}));};
    video.addEventListener('seeking',()=>state.events.push({kind:'EXPLICIT_SEEK',at:performance.timeOrigin+performance.now(),mediaTime:video.currentTime}));
    video.addEventListener('ended',flush);addEventListener('pagehide',flush);window.__nativeRecheckFlush=flush;
  })();</script>`;
  assert.equal(html.split('</body>').length, 2);
  html = html.replace('</body>', `${instrumentation}</body>`);
  return html;
}

export class NativeEncodedRecheckFixture {
  documents = [];
  requests = [];
  pageEvidence = new Map();
  active;
  constructor(assets) {
    this.assets = assets;
  }
  document(fixed) {
    assert.equal(typeof fixed, 'boolean');
    assert.ok(this.documents.length < 100, 'Bounded document count');
    const encoded = {
      ...encodedPageSource(this.assets, fixed),
      url: recheckMediaPath,
    };
    const identity = {
      documentId: randomUUID(),
      fixed,
      url: recheckMediaPath,
      sourceSha256: encoded.sourceSha256,
      sourceBytes: encoded.sourceBytes,
      manifestSha256: encoded.manifestSha256,
    };
    const html = encodedRecheckHtml(this.assets, fixed, identity);
    const record = {
      ...identity,
      servedAtEpochMs: Date.now(),
      servedHtmlSha256: sha256(html),
    };
    this.documents.push(record);
    this.active = record;
    return html;
  }
  serve(request, response) {
    assert.ok(this.active, 'No document has selected a source');
    assert.ok(this.requests.length < 1000, 'Bounded media request count');
    const asset = this.assets.assets[this.active.fixed ? 'fixed' : 'signal'];
    this.requests.push({
      atEpochMs: Date.now(),
      documentId: this.active.documentId,
      path: request.url,
      method: request.method,
      range: request.headers.range ?? null,
      sourceSha256: asset.record.sha256,
      sourceBytes: asset.bytes.length,
    });
    serveEncodedAsset(request, response, asset.bytes);
  }
  append(value) {
    assert.ok(value && typeof value === 'object');
    assert.ok(JSON.stringify(value).length <= 131072, 'Bounded page evidence');
    const record = this.documents.find(
      (item) => item.documentId === value.recheckDocument?.documentId,
    );
    assert.ok(record, 'Evidence must name an actually served document');
    for (const key of [
      'fixed',
      'url',
      'sourceSha256',
      'sourceBytes',
      'manifestSha256',
    ])
      assert.equal(value.recheckDocument[key], record[key]);
    assert.equal(value.source, 'ENCODED_VP9_WEBM');
    assert.equal(value.encoded.sourceSha256, record.sourceSha256);
    for (const key of ['events', 'samples', 'presentations'])
      assert.ok(Array.isArray(value[key]) && value[key].length <= 512);
    this.pageEvidence.set(record.documentId, structuredClone(value));
  }
  snapshot() {
    return {
      policy: recheckPolicy,
      documents: structuredClone(this.documents),
      requests: structuredClone(this.requests),
      pageEvidence: [...this.pageEvidence.values()].map((value) =>
        structuredClone(value),
      ),
    };
  }
}
