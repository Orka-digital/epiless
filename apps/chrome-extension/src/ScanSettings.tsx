import type { CommandAction } from './command-protocol';
import type { AppState } from './ui-state';
/** Render controlled scan settings; changes are delegated to the owning state. */
export function ScanSettings({
  busy,
  state,
  act,
}: {
  busy: boolean;
  state: AppState | undefined;
  act: CommandAction;
}) {
  return (
    <section className="settings-card">
      <p className="label">OP DIT APPARAAT</p>{' '}
      <div className="settings-fields">
        <h2>Bewaarinstellingen</h2>
        <label className="field">
          Meetdetails bewaren
          <select
            disabled={busy}
            value={
              state?.settings.detailRetentionDays === null
                ? 'forever'
                : (state?.settings.detailRetentionDays ?? 90)
            }
            onChange={(event) =>
              void act('SET_HISTORY_SETTINGS', {
                settings: {
                  detailRetentionDays:
                    event.target.value === 'forever'
                      ? null
                      : event.target.value === '30'
                        ? 30
                        : event.target.value === '365'
                          ? 365
                          : 90,
                },
              })
            }
          >
            <option value="30">30 dagen</option>
            <option value="90">90 dagen (standaard)</option>
            <option value="365">365 dagen</option>
            <option value="forever">Tot ik zelf wis</option>
          </select>
        </label>
        <p className="small">
          Een kortere termijn verwijdert verlopen eventdetails meteen.
          Auditgeschiedenis, routes, meetkwaliteit en compacte
          kandidaatstatistieken blijven staan. Een langere termijn herstelt
          eerder verwijderde details niet. Ruwe pixels en video worden nooit
          opgeslagen.
        </p>
      </div>
      <p className="small">
        Je gegevens worden pas gedeeld wanneer je zelf een rapport publiceert.
      </p>
    </section>
  );
}
