import assert from 'node:assert/strict';
/** Check transport accounting, exact backend agreement and spatial evidence.
 * @param {Awaited<ReturnType<typeof import('./worker-capture-scenario.mjs').captureWorkerScenario>>} report
 * @param {import('./worker-capture-scenario.mjs').WorkerScenario} scenario
 * @param {Map<string, Awaited<ReturnType<typeof import('./worker-capture-scenario.mjs').captureWorkerScenario>>>} denseReports
 */
export function assertWorkerCapture(report, scenario, denseReports) {
  assert.equal(report.result.quality.frameCount, 76);
  assert.equal(report.completedFrames, 76);
  assert.equal(report.maximumInFlight, 3);
  assert.equal(report.pendingAtEnd, 3);
  assert.equal(report.transferredFramesClosed, true);
  assert.equal(report.empty.quality.frameCount, 0);
  assert.equal(report.empty.quality.processing.measuredFrames, 0);
  assert.equal(report.empty.quality.processing.maxMs, 0);
  assert.equal(report.empty.quality.processing.analysisBackend.denseFrames, 0);
  assert.equal(
    report.empty.quality.processing.analysisBackend.inputCopiedBytes,
    0,
  );
  assert.deepEqual(report.empty.findings, []);
  assert.equal(report.warmupEvents, 0);
  assert.equal(
    report.result.quality.downsampled,
    scenario.rescaledTransfer === true,
  );
  assert.deepEqual(report.result.quality.processing.conversionMethods, [
    scenario.rescaledTransfer || scenario.rgbaTransfer
      ? 'RGBA_TRANSFER'
      : 'VIDEOFRAME_COPY_RGBA',
  ]);
  if (!scenario.rescaledTransfer && !scenario.rgbaTransfer) {
    assert.equal(
      report.result.quality.processing.decoded.format,
      scenario.format,
    );
    assert.equal(
      report.result.quality.processing.decoded.codedWidth,
      scenario.width,
    );
  }
  assert.ok(report.result.quality.processing.conversionMeanMs >= 0);
  const diagnostic = report.result.findings.find(
    (f) => f.type === 'GENERAL_FLASH',
  ).diagnostic;
  assert.equal(diagnostic.complete, true);
  if (!scenario.dense)
    assert.deepEqual(
      [
        ...new Set(
          diagnostic.samples.map((s) => `${s.red},${s.green},${s.blue}`),
        ),
      ].sort(),
      scenario.disjoint ? ['0,0,0', '255,255,255'] : ['0,255,0', '255,0,0'],
    );
  assert.equal(new Set(report.events).size, report.events.length);
  assert.ok(report.events.length >= 1 && report.events.length <= 8);

  const findings = report.result.findings.filter(
    (finding) => finding.type === 'GENERAL_FLASH',
  );
  if (scenario.dense) {
    const backend = report.result.quality.processing.analysisBackend;
    assert.equal(report.result.status, 'NEEDS_REVIEW');
    assert.ok(
      report.result.findings.some((finding) => finding.type === 'RED_FLASH'),
    );
    assert.equal(
      backend.engineStateBytes,
      report.result.quality.spatial.stateBytes,
    );
    assert.ok(backend.engineStateBytes <= 256 * 1024 * 1024);
    const transport = scenario.rgbaTransfer ? 'transfer' : 'video';
    if (scenario.forceJavaScript) {
      assert.equal(backend.backend, 'JS');
      assert.equal(backend.selectionReason, 'FORCED_JS');
      assert.equal(backend.denseFrames, 0);
      assert.equal(backend.inputCopiedBytes, 0);
      assert.equal(backend.wasmMemoryBytes, 0);
      const baseline = denseReports.get(transport);
      assert.ok(
        baseline,
        'Run the measured WASM case before its forced-JS counterpart',
      );
      assert.deepEqual(
        comparableResult(report.result),
        comparableResult(baseline.result),
        'Complete findings and non-performance quality must match across backends',
      );
      assert.deepEqual(
        report.liveEvents,
        baseline.liveEvents,
        'All live event payloads must match across backends',
      );
      assert.equal(
        baseline.result.quality.spatial.stateBytes,
        report.result.quality.spatial.stateBytes +
          baseline.result.quality.processing.analysisBackend.extraStateBytes,
      );
    } else {
      assert.equal(backend.backend, 'WASM_DENSE');
      assert.equal(backend.selectionReason, 'READY');
      assert.ok(
        backend.denseFrames > 0,
        'Heterogeneous frames must actually call WASM',
      );
      assert.ok(backend.wasmMemoryBytes > 0);
      assert.equal(
        backend.inputCopiedBytes,
        scenario.rgbaTransfer
          ? backend.denseFrames * scenario.width * scenario.height * 4
          : 0,
        'Native copyTo must use the arena directly; external RGBA copies must be accounted exactly',
      );
      denseReports.set(transport, report);
    }
  } else if (scenario.disjoint) {
    const scale = scenario.dpr ?? 1;
    assert.equal(findings.length, 2);
    for (const finding of findings) {
      assert.equal(finding.spatial.componentPixels, 12000 * scale * scale);
      assert.equal(finding.spatial.simultaneousPixels, 24000 * scale * scale);
      assert.ok(
        finding.spatial.componentPixels < (341 * 256 * scale * scale) / 4,
      );
      if (scenario.rescaledTransfer) {
        assert.equal(finding.spatial.visualField, undefined);
        assert.equal(report.result.status, 'INCONCLUSIVE');
      } else {
        assert.equal(finding.spatial.visualField.basis, 'W3C_CSS_REFERENCE');
        assert.equal(finding.spatial.visualField.widthPx, 341 * scale);
        assert.equal(finding.spatial.visualField.heightPx, 256 * scale);
        assert.equal(
          finding.spatial.visualField.maximumPixels,
          24000 * scale * scale,
        );
        assert.equal(
          finding.spatial.visualField.maximumRatio,
          24000 / (341 * 256),
        );
        assert.equal(finding.spatial.visualField.exceedsThreshold, true);
        assert.match(
          finding.spatial.visualField.reference,
          /341x256 CSS pixels/,
        );
        assert.match(
          finding.spatial.visualField.reference,
          /standard browser zoom/,
        );
        assert.match(
          finding.spatial.visualField.reference,
          /not physical calibration or a WCAG verdict/,
        );
      }
    }
  } else {
    // A candidate below the fixed reference-area threshold remains a finding;
    // adding an assumption must never become an automatic safety exemption.
    assert.ok(findings.length > 0);
    if (scenario.missingMapping || scenario.pageZoom) {
      assert.equal(findings[0].spatial.visualField, undefined);
      assert.ok(
        report.result.limitations.some((value) =>
          value.startsWith('CSS_REFERENCE_'),
        ),
      );
    } else {
      assert.equal(findings[0].spatial.visualField.maximumPixels, 256);
      assert.equal(findings[0].spatial.visualField.exceedsThreshold, false);
    }
  }
}
function comparableResult(result) {
  const normalized = structuredClone(result);
  // These are the only permitted differences between processing backends.
  // Preserve status, limitations, source cadence, complete findings and all
  // other quality/conversion metadata, including the real decoded geometry.
  delete normalized.quality.spatial.stateBytes;
  for (const name of [
    'meanMs',
    'maxMs',
    'framesOver16_7Ms',
    'conversionMeanMs',
    'analysisMeanMs',
    'analysisBackend',
  ])
    delete normalized.quality.processing[name];
  return normalized;
}
