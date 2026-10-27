import type { CommandArgs, CommandResult } from './command-protocol';

/** The response cast is confined to the extension-owned Chrome transport boundary. */
export async function command<A extends CommandArgs>(
  ...args: A
): Promise<CommandResult<A[0]>> {
  const [type, values] = args;
  const response: unknown = await chrome.runtime.sendMessage({
    type,
    ...values,
  });
  if (!response || typeof response !== 'object' || !('ok' in response))
    throw new Error('epi-less antwoordt niet. Open de extensie opnieuw.');
  if (response.ok !== true)
    throw new Error(
      'error' in response && typeof response.error === 'string'
        ? response.error
        : 'De opdracht is mislukt.',
    );
  if (!('value' in response))
    throw new Error('Ongeldig antwoord van epi-less.');
  return response.value as CommandResult<A[0]>;
}
