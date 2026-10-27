import assert from 'node:assert/strict';

/** A constant pre-encoded file, not a synthetic stream or flash stimulus.
 * No autoplay: only the scanner's supported media action starts this video. */
export function nativeLoopPage(encoded) {
  assert.equal(encoded?.fixed, true);
  assert.equal(encoded?.audio, false);
  assert.ok(
    encoded.frames.every((frame) => frame.rgba.join(',') === '35,35,35,255'),
  );
  return `<!doctype html><html lang="nl"><meta charset="utf-8"><title>FlashGuard autonome videolusproef</title>
  <style>html{overflow:hidden}body{margin:40px;font:18px system-ui;color:#234;background:#eee}
  video{display:block;width:64px;height:64px;background:#232323}
  .motion{position:fixed;left:30px;top:30px;width:4px;height:4px;background:#e8e8e8;animation:gentle 20s linear infinite alternate}
  @keyframes gentle{to{transform:translateX(180px)}}
  </style><body><h1>Autonome videoluscontrole</h1>
  <p>Een constante grijze video zonder geluid. De scanner mag de zichtbare video starten en een bestaande lusgrens onderzoeken. Er zijn geen flitsen; alleen een klein, langzaam bewegend cadencemerk.</p>
  <video id="loop-video" muted loop playsinline controls preload="auto" aria-label="Constante grijze testvideo"></video><i class="motion" aria-hidden="true"></i>
  <script>(()=>{
    const encoded=${JSON.stringify(encoded).replaceAll('<', '\\u003c')},video=document.querySelector('video');
    const epoch=()=>performance.timeOrigin+performance.now();
    const documentId=crypto.randomUUID(),documentStartedEpochMs=epoch();
    const state=window.__nativeCandidateFixture={mode:'NATIVE_ENCODED_LOOP',fixed:true,video:true,dense:false,loop:true,source:'ENCODED_VP9_WEBM',encoded,documentId,documentStartedEpochMs,events:[],samples:[],presentations:[],limitations:[]};
    let sequence=0;const pending={events:[],samples:[],presentations:[]};
    const append=(kind,value)=>{state[kind].push(value);if(state[kind].length>512)state[kind].shift();pending[kind].push(value);if(pending[kind].length>128){pending[kind].shift();if(!state.limitations.includes('PAGE_TRACE_QUEUE_TRUNCATED'))state.limitations.push('PAGE_TRACE_QUEUE_TRUNCATED');}};
    const flush=window.__nativeLoopFlush=()=>{if(!Object.values(pending).some(values=>values.length))return;
      const batch={documentId,documentStartedEpochMs,sequence,sourceSha256:encoded.sourceSha256,limitations:state.limitations,...pending};
      if(navigator.sendBeacon('/__native-loop-evidence',new Blob([JSON.stringify(batch)],{type:'application/json'}))){sequence++;for(const kind of Object.keys(pending))pending[kind]=[];}
    };
    const event=kind=>append('events',{kind,atEpochMs:epoch(),timeMs:video.currentTime*1000,durationMs:Number.isFinite(video.duration)?video.duration*1000:null,paused:video.paused,seeking:video.seeking,loop:video.loop,playbackRate:video.playbackRate});
    for(const name of ['loadedmetadata','playing','pause','seeking','seeked','ended','ratechange','error'])video.addEventListener(name,()=>event(name.toUpperCase()));
    video.muted=true;video.src=encoded.url;
    const sample=()=>{const r=video.getBoundingClientRect();append('samples',{atEpochMs:epoch(),timeMs:video.currentTime*1000,paused:video.paused,seeking:video.seeking,loop:video.loop,playbackRate:video.playbackRate,rect:{x:r.x,y:r.y,width:r.width,height:r.height}});};
    sample();setInterval(sample,50);setInterval(flush,1000);addEventListener('pagehide',flush);
    if(typeof video.requestVideoFrameCallback!=='function')event('RVFC_UNAVAILABLE');
    else{const presented=(now,metadata)=>{const r=video.getBoundingClientRect();append('presentations',{atEpochMs:epoch(),callbackEpochMs:performance.timeOrigin+now,timeMs:metadata.mediaTime*1000,presentedFrames:metadata.presentedFrames,presentationEpochMs:performance.timeOrigin+metadata.presentationTime,expectedDisplayEpochMs:performance.timeOrigin+metadata.expectedDisplayTime,videoWidth:video.videoWidth,videoHeight:video.videoHeight,rect:{x:r.x,y:r.y,width:r.width,height:r.height}});video.requestVideoFrameCallback(presented);};video.requestVideoFrameCallback(presented);}
  })();</script></body></html>`;
}

/** Local fixture collector only. Independent document clocks, no scanner IDs.
 * Limits apply before retaining arbitrary request data; no frames are accepted. */
export function appendLoopTrace(documents, batch, sourceSha256) {
  const rowKeys = {
    events: [
      'kind',
      'atEpochMs',
      'timeMs',
      'durationMs',
      'paused',
      'seeking',
      'loop',
      'playbackRate',
    ],
    samples: [
      'atEpochMs',
      'timeMs',
      'paused',
      'seeking',
      'loop',
      'playbackRate',
      'rect',
    ],
    presentations: [
      'atEpochMs',
      'callbackEpochMs',
      'timeMs',
      'presentedFrames',
      'presentationEpochMs',
      'expectedDisplayEpochMs',
      'videoWidth',
      'videoHeight',
      'rect',
    ],
  };
  assert.match(batch.documentId, /^[a-f0-9-]{36}$/);
  assert.equal(batch.sourceSha256, sourceSha256);
  assert.ok(Number.isFinite(batch.documentStartedEpochMs));
  assert.ok(
    Number.isSafeInteger(batch.sequence) &&
      batch.sequence >= 0 &&
      batch.sequence <= 4096,
  );
  assert.ok(Array.isArray(batch.limitations) && batch.limitations.length <= 16);
  for (const key of ['events', 'samples', 'presentations']) {
    assert.ok(Array.isArray(batch[key]) && batch[key].length <= 128);
    for (const row of batch[key]) {
      assert.ok(
        row &&
          typeof row === 'object' &&
          Object.keys(row).every((name) => rowKeys[key].includes(name)),
      );
      assert.ok(
        Number.isFinite(row.atEpochMs) &&
          Number.isFinite(row.timeMs) &&
          row.timeMs >= 0,
      );
      for (const [name, value] of Object.entries(row)) {
        if (name === 'kind')
          assert.ok(typeof value === 'string' && /^[A-Z_]{1,40}$/.test(value));
        else if (name === 'rect') {
          assert.deepEqual(Object.keys(value).sort(), [
            'height',
            'width',
            'x',
            'y',
          ]);
          assert.ok(Object.values(value).every(Number.isFinite));
        } else if (['paused', 'seeking', 'loop'].includes(name))
          assert.equal(typeof value, 'boolean');
        else if (name === 'durationMs' && value === null) continue;
        else assert.ok(Number.isFinite(value));
      }
    }
  }
  let document = documents.get(batch.documentId);
  if (!document) {
    assert.ok(documents.size < 12, 'Loop document trace cap');
    document = {
      documentId: batch.documentId,
      documentStartedEpochMs: batch.documentStartedEpochMs,
      sourceSha256,
      lastSequence: -1,
      limitations: [],
      events: [],
      samples: [],
      presentations: [],
    };
    documents.set(batch.documentId, document);
  }
  assert.equal(document.documentStartedEpochMs, batch.documentStartedEpochMs);
  if (batch.sequence <= document.lastSequence) return;
  if (batch.sequence !== document.lastSequence + 1)
    document.limitations.push('COLLECTOR_BATCH_GAP');
  document.lastSequence = batch.sequence;
  document.limitations = [
    ...new Set([...document.limitations, ...batch.limitations]),
  ].slice(0, 16);
  for (const key of ['events', 'samples', 'presentations']) {
    const remaining = 8192 - document[key].length;
    if (batch[key].length > remaining)
      document.limitations = [
        ...new Set([...document.limitations, 'COLLECTOR_TRACE_TRUNCATED']),
      ];
    document[key].push(...batch[key].slice(0, Math.max(0, remaining)));
  }
}
