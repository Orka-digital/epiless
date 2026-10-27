import type { CommandAction } from './command-protocol';
import { type ScanMode } from './model';
import type { PendingRecheck } from './store';
import { ToolIcon } from './ToolIcon';
export function ScanStart({
  devtools,
  targetOrigin,
  recheck,
  busy,
  advancedPreparation,
  act,
  mode,
  setMode,
  viewportSeconds,
  setViewportSeconds,
  advancedBuild,
  useAdvanced,
  setAdvancedPointer,
  start,
}: {
  devtools: boolean;
  targetOrigin: string;
  recheck: PendingRecheck | undefined;
  busy: boolean;
  advancedPreparation:
    | {
        tabId: number;
        originalTabId: number;
        mode: ScanMode;
        viewportSeconds: number;
      }
    | undefined;
  act: CommandAction;
  mode: ScanMode;
  setMode: React.Dispatch<React.SetStateAction<ScanMode>>;
  viewportSeconds: number;
  setViewportSeconds: React.Dispatch<React.SetStateAction<number>>;
  advancedBuild: boolean;
  useAdvanced: boolean;
  setAdvancedPointer: React.Dispatch<React.SetStateAction<boolean>>;
  start: () => Promise<void>;
}) {
  return (
    <section className="start-card">
      <p className="label">
        {devtools ? 'START VANUIT DE TOOLBAR' : 'TE ONDERZOEKEN WEBSITE'}
      </p>
      <p className="origin">
        <ToolIcon name="globe" />
        {targetOrigin
          ? new URL(targetOrigin).host
          : 'Open een website om te beginnen'}
      </p>
      {recheck && (
        <div className="message">
          <strong>Gerichte hercontrole voorbereid</strong>
          <p>
            epi-less herhaalt het bewaarde scenario, inclusief viewport,
            scrollpositie en ondersteunde acties.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void (advancedPreparation
                ? act('CANCEL_ADVANCED_SCAN', {
                    tabId: advancedPreparation.tabId,
                  })
                : act('CANCEL_RECHECK'))
            }
          >
            Hercontrole annuleren
          </button>
        </div>
      )}
      {advancedPreparation && (
        <div className="message">
          <strong>Aparte scantab klaar</strong>
          <p>
            Start hieronder de opname. epi-less onderzoekt deze tijdelijke tab
            en sluit hem na afloop. Je oorspronkelijke tab blijft intact; het
            rapport blijft lokaal beschikbaar.
          </p>
          {!recheck && (
            <button
              disabled={busy}
              onClick={() =>
                void act('CANCEL_ADVANCED_SCAN', {
                  tabId: advancedPreparation.tabId,
                })
              }
            >
              Voorbereiding annuleren
            </button>
          )}
        </div>
      )}
      <p className="small scan-description">
        {mode === 'AUTONOMOUS'
          ? 'Onderzoekt pagina’s en interacties automatisch.'
          : 'Meet de beelden die nu zichtbaar zijn.'}
      </p>
      <label className="field">
        Scanmodus
        <select
          value={mode}
          disabled={!!advancedPreparation}
          onChange={(event) => {
            const value = event.target.value as ScanMode;
            setMode(value);
            void act('SET_SCAN_PREFERENCES', {
              mode: value,
              viewportSeconds,
            });
          }}
        >
          <option value="AUTONOMOUS">Hele website · automatisch</option>
          <option value="QUICK">Huidige weergave · 15 seconden</option>
          <option value="EXTENDED">Huidige weergave · eigen meetduur</option>
        </select>
      </label>
      {mode === 'EXTENDED' && (
        <label className="field">
          Meetduur (15–120 seconden)
          <input
            type="number"
            min="15"
            max="120"
            step="1"
            value={viewportSeconds}
            disabled={!!advancedPreparation}
            onChange={(event) => setViewportSeconds(Number(event.target.value))}
            onBlur={() => {
              const bounded = Math.max(
                15,
                Math.min(120, Math.round(viewportSeconds || 30)),
              );
              setViewportSeconds(bounded);
              void act('SET_SCAN_PREFERENCES', {
                mode,
                viewportSeconds: bounded,
              });
            }}
          />
        </label>
      )}
      {mode !== 'AUTONOMOUS' && (
        <p className="small">
          Alleen de huidige viewport wordt gemeten. Je kunt tijdens de meting
          zelf video of interacties starten; de scan navigeert en scrolt niet.
        </p>
      )}
      {devtools ? (
        <p className="notice">
          Klik op de epi-less-extensie naast de adresbalk om capture te
          autoriseren. Hier volg en bedien je dezelfde scan. De gekozen modus en
          meetduur worden overgenomen door de toolbar.
        </p>
      ) : (
        <>
          {advancedBuild && (
            <details className="scan-options">
              <summary>
                <ToolIcon name="settings" /> Extra interacties
              </summary>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={useAdvanced}
                  disabled={!!advancedPreparation}
                  onChange={(event) => setAdvancedPointer(event.target.checked)}
                />{' '}
                Echte hoverinteracties onderzoeken in een aparte scantab. Chrome
                toont een debugger-melding; sluit DevTools op die tab.
              </label>
            </details>
          )}
          {useAdvanced && !advancedPreparation && (
            <p className="small">
              Open eerst de aparte scantab. Open daar opnieuw de
              epi-less-toolbar en kies Start scan. Chrome vereist deze startklik
              voor de opname; daarna werkt de scanner autonoom.
            </p>
          )}
          <p className="scan-caution">
            <ToolIcon name="info" />
            {useAdvanced
              ? 'Werkt in een aparte scantab. Je oorspronkelijke tab blijft behouden.'
              : mode === 'AUTONOMOUS'
                ? 'Navigeert in deze tab. Bewaar eerst je open werk.'
                : 'Laat de te meten content zichtbaar.'}
          </p>
          <button
            className="primary start-button"
            disabled={busy || !targetOrigin}
            onClick={() => void start()}
          >
            {busy
              ? 'Voorbereiden…'
              : useAdvanced && !advancedPreparation
                ? 'Aparte scantab openen'
                : advancedPreparation
                  ? recheck
                    ? 'Hercontrole starten'
                    : 'Start scan'
                  : recheck
                    ? 'Hercontrole starten'
                    : mode !== 'AUTONOMOUS'
                      ? 'Start viewportmeting'
                      : 'Scan deze website'}{' '}
            <ToolIcon name="play" />
          </button>
        </>
      )}
      <p className="caption">
        {mode === 'AUTONOMOUS'
          ? 'Maximaal 50 routes · 4 linkniveaus · 20 minuten'
          : '1 viewport · geen automatische routeverkenning'}
      </p>
    </section>
  );
}
