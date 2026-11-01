import assert from 'node:assert/strict';
import { encodedSpec } from './native-encoded-source.mjs';
/** Assert actual playback disclosure, decoded-frame identity and presentation geometry. */
export function assertEncodedPlayback(fixture, assets) {
  const events = fixture.events;
  assert.ok(
    !events.some((value) =>
      [
        'MEDIA_ERROR',
        'RVFC_UNAVAILABLE',
        'ENCODED_TIMESTAMP_UNMATCHED',
      ].includes(value.kind),
    ),
  );
  const control = events.find((value) => value.kind === 'CONTROL');
  const playing = events.filter((value) => value.kind === 'ENCODED_PLAYING');
  assert.ok(control && playing.length > 0);
  assert.ok(
    playing.every((value) => value.at >= control.at),
    'No playback before disclosure.',
  );
  assert.ok(events.some((value) => value.kind === 'ENCODED_ENDED'));
  const metadata = events.find((value) => value.kind === 'ENCODED_METADATA');
  assert.equal(metadata.videoWidth, 2);
  assert.equal(metadata.videoHeight, 2);
  assert.ok(Math.abs(metadata.duration * 1000 - encodedSpec.durationMs) <= 1);
  assert.ok(fixture.presentations.length >= 20);
  const observedColours = new Set();
  for (const presentation of fixture.presentations) {
    const expected =
      assets.assets.signal.record.frames[
        Math.round(
          (presentation.mediaTime * 1000) / encodedSpec.frameDurationMs,
        )
      ];
    assert.ok(expected);
    assert.ok(
      Math.abs(presentation.mediaTime * 1000 - expected.timestampMs) < 0.1,
    );
    assert.deepEqual(presentation.expectedDecodedFrame, {
      index: expected.index,
      timestampMs: expected.timestampMs,
      rgba: expected.rgba,
      rgbaSha256: expected.rgbaSha256,
    });
    assert.equal(presentation.videoWidth, 2);
    assert.equal(presentation.videoHeight, 2);
    assert.deepEqual(presentation.rect, {
      x: 100,
      y: 240,
      width: 2,
      height: 2,
    });
    if (presentation.at < control.at)
      assert.equal(
        expected.rgba[0],
        35,
        'No changed signal may be shown before disclosure.',
      );
    observedColours.add(expected.rgba[0]);
  }
  assert.deepEqual(
    [...observedColours].sort((a, b) => a - b),
    [35, 125],
  );
}
