import { planRoute } from '@epi-less/core';
import type { BackgroundCommand } from './command-protocol';
import { matchingRecord } from './disposable-scan';
import type { CommandServices } from './runner-command-services';
import { initialScanJob } from './runner-job-factory';
import { hasHashRoute } from './runner-policy';
import { createJob, getJob, setPendingRecheck } from './store';
import { buildVerificationPlan } from './verification';
/** Handle start commands after runtime parsing; ownership checks precede mutations. */
export async function runnerCommandStart(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'START' }>,
) {
  if (message.type === 'START') {
    if (services.execution.running || services.execution.authorizing)
      throw new Error('Er loopt al een scan.');
    const tab = await chrome.tabs.get(message.tabId);
    if (!tab.url || tab.id === undefined)
      throw new Error('Geen gewone website geselecteerd.');
    const parsed = new URL(tab.url);
    const previous = message.replayOf && (await getJob(message.replayOf.jobId));
    const replayTarget = message.replayOf
      ? previous
        ? buildVerificationPlan(
            previous,
            message.replayOf.taskId,
            message.replayOf.observationId,
          )
        : (() => {
            throw new Error('De oorspronkelijke scan ontbreekt.');
          })()
      : undefined;
    if (replayTarget?.viewportMethod === 'CDP')
      throw new Error(
        'Dit oudere CDP-profiel heeft geen bewezen native pixelkoppeling. Maak een nieuwe fysieke responsive scan.',
      );
    const advancedPointer = message.advancedPointer === true;
    const advancedOwner = advancedPointer
      ? await services.validateAdvancedStart(message)
      : undefined;
    await validateStartPermissions(services, message, {
      tab: { id: tab.id, url: tab.url },
      advancedPointer,
      replayTarget,
      origin: parsed.origin,
    });
    const decision = planRoute({
      candidate: tab.url,
      baseUrl: tab.url,
      origin: parsed.origin,
      depth: 0,
    });
    if (!decision.allowed || !decision.url)
      throw new Error(
        `Deze startpagina valt buiten de veilige routepolicy (${decision.reason}). Open een gewone pagina zonder queryparameters of accountactie.`,
      );
    if (
      !(await chrome.permissions.contains({
        origins: [`${parsed.origin}/*`],
      }))
    )
      throw new Error('Sitetoestemming ontbreekt.');
    const job = initialScanJob(services, message, {
      tab: { id: tab.id, url: tab.url },
      parsed,
      decision: { url: decision.url },
      replayTarget,
      advancedOwner,
      previous,
      advancedPointer,
    });
    await createJob(job);
    if (advancedOwner) {
      if (!matchingRecord(await services.loadAdvancedOwner(), advancedOwner))
        throw new Error('ADVANCED_OWNER_CHANGED');
      await services.persistAdvancedOwner({
        ...advancedOwner,
        phase: 'RUNNING',
        jobId: job.id,
        generation: job.generation,
      });
    }
    await services.authorize(job);
    if (replayTarget) await setPendingRecheck(undefined);
    if (advancedOwner) await services.showAdvancedDashboard(job);
    else
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`dashboard.html#${job.id}`),
        active: true,
      });
    return { id: job.id };
  }
  throw new Error('Unsupported command group');
}

async function validateStartPermissions(
  services: CommandServices,
  message: Extract<BackgroundCommand, { type: 'START' }>,
  context: {
    tab: { id: number; url: string };
    advancedPointer: boolean;
    replayTarget?: import('./model').ReplayScenario;
    origin: string;
  },
) {
  const { tab, advancedPointer, replayTarget, origin } = context;
  if (
    !advancedPointer &&
    (await services.loadAdvancedOwner())?.scanTabId === tab.id
  )
    throw new Error(
      'Dit voorbereide tabblad moet via de geavanceerde toolbarstart worden gemeten.',
    );
  if (
    advancedPointer &&
    !chrome.runtime.getManifest().permissions?.includes('debugger')
  )
    throw new Error(
      'Echte hoverinteractie vereist de afzonderlijke geavanceerde extensie met debugger-toestemming.',
    );
  if (
    replayTarget?.steps.some((step) => step.kind === 'hover') &&
    !advancedPointer
  )
    throw new Error(
      'Dit scenario bevat echte hoverinteractie. Schakel de geavanceerde pointermeting expliciet in.',
    );
  if (replayTarget && new URL(replayTarget.route).origin !== origin)
    throw new Error(
      'Open de hercontroletab op dezelfde oorsprong als het bewaarde scenario.',
    );
  if (
    hasHashRoute(tab.url) &&
    message.mode !== 'QUICK' &&
    message.mode !== 'EXTENDED'
  )
    throw new Error(
      'Deze website gebruikt hash-routes. Autonome routeverkenning ondersteunt die nog niet. Kies een viewportmeting; de beperkte dekking wordt in het rapport vermeld.',
    );
}
