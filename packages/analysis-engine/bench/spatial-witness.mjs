import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = (/** @type {import("node:crypto").BinaryLike} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const rectangleEqual = (
  /** @type {import("../../core/src/index.js").Finding["region"] | undefined} */ a,
  /** @type {import("../../core/src/index.js").Finding["region"] | undefined} */ b,
) =>
  a?.x === b?.x &&
  a?.y === b?.y &&
  a?.width === b?.width &&
  a?.height === b?.height;

/** Independent brute-force sums for small differential fixtures. No production
 * mask helper, sliding columns, activeCount shortcut, or bounding-box area. */
/**
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {import("../src/spatial.js").VisualFieldCalibration | undefined} field
 */
export function independentMaskWitness(mask, width, height, field) {
  assert.equal(mask.length, width * height);
  let total = 0;
  for (const value of mask) {
    assert.ok(value === 0 || value === 1, 'Expected the actual binary mask');
    total += value;
  }
  let area;
  if (field) {
    let maximumPixels = -1,
      left = 0,
      top = 0;
    // Nonnegative pixels: shifting a partly external window toward the image
    // cannot reduce the count. Larger-than-image fields retain their full area.
    for (let y = 0; y <= Math.max(0, height - field.heightPx); y++)
      for (let x = 0; x <= Math.max(0, width - field.widthPx); x++) {
        let sum = 0;
        for (let yy = y; yy < Math.min(height, y + field.heightPx); yy++)
          for (let xx = x; xx < Math.min(width, x + field.widthPx); xx++)
            sum += mask[yy * width + xx];
        if (sum > maximumPixels) {
          maximumPixels = sum;
          left = x;
          top = y;
        }
      }
    area = {
      ...field,
      maximumPixels,
      maximumRatio: maximumPixels / (field.widthPx * field.heightPx),
      thresholdRatio: /** @type {const} */ (0.25),
      exceedsThreshold: maximumPixels * 4 > field.widthPx * field.heightPx,
      window: {
        x: left,
        y: top,
        width: field.widthPx,
        height: field.heightPx,
      },
    };
  }
  const seen = new Set(),
    components = [];
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!mask[pixel] || seen.has(pixel)) continue;
    const component = [pixel];
    seen.add(pixel);
    for (let i = 0; i < component.length; i++) {
      const at = component[i],
        x = at % width,
        y = Math.floor(at / width);
      for (const [xx, yy] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        const next = yy * width + xx;
        if (mask[next] && !seen.has(next)) {
          seen.add(next);
          component.push(next);
        }
      }
    }
    const xs = component.map((p) => p % width),
      ys = component.map((p) => Math.floor(p / width));
    components.push({
      pixels: component.length,
      region: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
      },
    });
  }
  return { total, area, components };
}

/**
 * @param {{visualField?:{maximumPixels:number},simultaneousPixels:number,componentPixels:number}} spatial
 */
export function spatialRank(spatial) {
  return [
    spatial.visualField?.maximumPixels ?? spatial.simultaneousPixels,
    spatial.simultaneousPixels,
    spatial.componentPixels,
  ];
}

/** Strict lexicographic ordering; no same-value replacement of the first frame. */
/**
 * @param {{visualField?:{maximumPixels:number},simultaneousPixels:number,componentPixels:number}} next
 * @param {{visualField?:{maximumPixels:number},simultaneousPixels:number,componentPixels:number}} previous
 */
export function strongerSpatial(next, previous) {
  const a = spatialRank(next),
    b = spatialRank(previous);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Observe the frozen oracle immediately before its cluster consumes the mask.
 * Frozen pattern helpers/currentMotion describe this same real decoded frame.
 * Only the independent mask/components and explicit retention policy are new. */
/**
 * @param {import("./probe-types.js").SpatialProbe} analyzer
 * @param {import("./probe-types.js").Checkerboard} frozenCheckerboard
 */
export function observeFrozenSpatial(analyzer, frozenCheckerboard) {
  /** @typedef {NonNullable<import("../../core/src/index.js").Finding["spatial"]>} Spatial
   * @typedef {{frameIndex:number,sampledAtMs:number,rgbaSha256:string,maskSha256:string,maskBase64:string,previousRank:number[],nextRank:number[],spatial:Spatial}} SpatialUpdate */
  /** @type {Map<string,{initial:Spatial,retained:Spatial,updates:SpatialUpdate[]}>} */
  const entries = new Map();
  let capturedMasks = 0,
    comparedFindings = 0,
    differingSpatialChecks = 0;
  const original = analyzer.cluster;
  analyzer.cluster = function (history, type, ended) {
    if (!history.hasActive) return original.call(this, history, type, ended);
    const mask = history.active.slice(),
      width = this.width,
      height = this.height,
      field = !(this.quality?.downsampled ?? this.downsampled)
        ? this.visualField
        : undefined;
    const measured = independentMaskWitness(mask, width, height, field);
    assert.equal(
      measured.total,
      history.activeCount,
      'Frozen active mask count',
    );
    const rgba = this.currentRgba;
    assert.ok(rgba, 'Witness must be tied to the actual current RGBA frame');
    const source = {
      frameIndex: this.frameIndex,
      sampledAtMs: ended,
      rgbaSha256: hash(
        Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      ),
      maskSha256: hash(mask),
      // Replayable exact mask, not merely its hash or bounding box.
      maskBase64: Buffer.from(mask).toString('base64'),
    };
    /** @type {{region:import("../../core/src/index.js").Finding["region"],spatial:Spatial}[]} */
    const witnessed = measured.components.map((component) => ({
      region: component.region,
      spatial: {
        version: 1,
        coordinateSpace: 'ANALYSIS_PIXELS',
        analysisWidth: width,
        analysisHeight: height,
        sampledAtMs: ended,
        componentPixels: component.pixels,
        simultaneousPixels: measured.total,
        simultaneousRatio: measured.total / (width * height),
        maskBasis: 'QUALIFYING_TRANSITIONS_SAME_FRAME',
        ...(measured.area ? { visualField: measured.area } : {}),
        pattern:
          component.pixels === component.region.width * component.region.height
            ? frozenCheckerboard(rgba, width, component.region, field)
            : { kind: 'NONE_DEMONSTRATED', automaticallyExcluded: false },
        motion: structuredClone(this.currentMotion),
      },
    }));
    capturedMasks++;
    const returned = original.call(this, history, type, ended);
    for (const witness of witnessed) {
      const finding = this.findings.find(
        (f, index) =>
          index >= this.mergeFrom &&
          f.type === type &&
          f.endMs === ended &&
          rectangleEqual(f.region, witness.region),
      );
      // The production/frozen 100-finding cap can intentionally omit components.
      if (!finding) continue;
      const previous = entries.get(finding.id);
      if (!previous) {
        assert.deepEqual(
          finding.spatial,
          witness.spatial,
          'Frozen first witness',
        );
        entries.set(finding.id, {
          initial: structuredClone(witness.spatial),
          retained: structuredClone(witness.spatial),
          updates: [],
        });
      } else if (strongerSpatial(witness.spatial, previous.retained)) {
        previous.updates.push({
          ...source,
          previousRank: spatialRank(previous.retained),
          nextRank: spatialRank(witness.spatial),
          spatial: structuredClone(witness.spatial),
        });
        previous.retained = structuredClone(witness.spatial);
      }
    }
    return returned;
  };
  return {
    /** @param {import("../../core/src/index.js").Finding[]} frozen
     * @param {import("../../core/src/index.js").Finding[]} current
     * @param {string} label
     * @returns {import("../../core/src/index.js").Finding[]} */
    assertFindings(frozen, current, label) {
      assert.equal(current.length, frozen.length, `${label}/finding count`);
      const expected = frozen.map((finding, i) => {
        const entry = entries.get(finding.id);
        assert.ok(entry, `${label}/${finding.id}/actual mask witness`);
        assert.deepEqual(
          finding.spatial,
          entry.initial,
          `${label}/frozen initial`,
        );
        // Exact object replacement is allowed only after deriving every field
        // independently above. Unknown/non-spatial differences still fail.
        const justified = { ...finding, spatial: entry.retained };
        assert.deepEqual(current[i], justified, `${label}/${finding.id}`);
        comparedFindings++;
        if (JSON.stringify(entry.initial) !== JSON.stringify(entry.retained))
          differingSpatialChecks++;
        return justified;
      });
      return structuredClone(expected);
    },
    evidence() {
      return {
        capturedMasks,
        comparedFindings,
        differingSpatialChecks,
        findingsWithSpatialUpdates: [...entries]
          .filter(([, entry]) => entry.updates.length)
          .map(([id, entry]) => ({ id, ...entry })),
      };
    },
  };
}
