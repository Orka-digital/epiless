/** Only the extension's isolated-world, original-node capability can be inspected.
 * Never evaluate a page-provided selector, URL, expression or field value. */
export async function inspectSource(
  token: string,
  expectedTabId: number,
): Promise<void> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      token,
    )
  )
    throw new Error('Ongeldige lokale elementverwijzing.');
  const inspected = chrome.devtools?.inspectedWindow;
  if (!inspected || inspected.tabId !== expectedTabId)
    throw new Error(
      'Open het epi-less-paneel in DevTools van de oorspronkelijke scantab.',
    );
  const expression = `(() => { const node = globalThis.__flashguardInspectSource?.(${JSON.stringify(token)}); if (!node) return 'UNAVAILABLE'; inspect(node); return 'INSPECTED'; })()`;
  await new Promise<void>((resolve, reject) => {
    inspected.eval<unknown>(
      expression,
      { useContentScriptContext: true },
      (result, exception) => {
        if (
          exception?.isException ||
          exception?.isError ||
          result !== 'INSPECTED'
        )
          reject(
            new Error(
              'Het oorspronkelijke element is gewijzigd, verlopen of niet meer aanwezig. Voer het scenario opnieuw uit.',
            ),
          );
        else resolve();
      },
    );
  });
}
