import assert from 'node:assert/strict';
/** Sample actual document clocks and CSS colours without claiming native capture evidence. */
export function createPhaseObserver(page, validPhaseEvidence) {
  let count = 0;
  const observe = async (
    startAge,
    duration,
    action = false,
    allowIncomplete = false,
  ) => {
    await page.waitForFunction((age) => performance.now() >= age, startAge);
    const segment = `phase-${++count}`;
    await page.evaluate(
      ({ segment, action }) => {
        phase.begin('proof', segment);
        const colors = [];
        let running = true;
        const frame = () => {
          if (!running) return;
          colors.push({
            documentMs: performance.now(),
            epochMs: performance.timeOrigin + performance.now(),
            color: getComputedStyle(document.querySelector('#signal'))
              .backgroundColor,
          });
          requestAnimationFrame(frame);
        };
        frame();
        globalThis.stopPhase = () => {
          running = false;
          return {
            evidence: phase.stop('proof', segment),
            colors,
            timerFiredAt: globalThis.timerFiredAt ?? null,
          };
        };
        if (action) {
          phase.trigger('proof', segment, 'before');
          document.querySelector('button').click();
          phase.trigger('proof', segment, 'after');
        }
      },
      { segment, action },
    );
    await page.waitForTimeout(duration);
    const result = await page.evaluate(() => stopPhase());
    assert.equal(
      validPhaseEvidence(result.evidence),
      true,
      JSON.stringify(result.evidence),
    );
    assert.equal(
      result.evidence.complete,
      !allowIncomplete,
      JSON.stringify(result.evidence.reasons),
    );
    return result;
  };
  return observe;
}
