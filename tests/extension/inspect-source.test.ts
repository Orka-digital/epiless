import { afterEach, expect, it, vi } from 'vitest';
import { inspectSource } from '../../apps/chrome-extension/src/inspect-source';

const token = '11223344-5566-4788-9911-aabbccddeeff';
afterEach(() => vi.unstubAllGlobals());

it('does not evaluate malformed authority or inspect a different tab', async () => {
  const evaluate = vi.fn();
  vi.stubGlobal('chrome', {
    devtools: { inspectedWindow: { tabId: 42, eval: evaluate } },
  });
  await expect(inspectSource('";fetch("secret")', 42)).rejects.toThrow(
    'Ongeldige',
  );
  await expect(inspectSource(token, 43)).rejects.toThrow('oorspronkelijke');
  expect(evaluate).not.toHaveBeenCalled();
});

it('uses the content-script world and reports stale nodes or evaluation failures', async () => {
  let result = 'INSPECTED';
  let exception: Record<string, unknown> = {};
  const evaluate = vi.fn(
    (
      expression: string,
      options: unknown,
      callback: (result: unknown, exception: unknown) => void,
    ) => callback(result, exception),
  );
  vi.stubGlobal('chrome', {
    devtools: { inspectedWindow: { tabId: 42, eval: evaluate } },
  });
  await expect(inspectSource(token, 42)).resolves.toBeUndefined();
  expect(evaluate.mock.calls[0]![1]).toEqual({ useContentScriptContext: true });
  expect(evaluate.mock.calls[0]![0]).toContain('inspect(node)');
  result = 'UNAVAILABLE';
  await expect(inspectSource(token, 42)).rejects.toThrow('verlopen');
  result = 'INSPECTED';
  exception = { isException: true };
  await expect(inspectSource(token, 42)).rejects.toThrow('verlopen');
});
