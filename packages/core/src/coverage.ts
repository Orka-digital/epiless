import type { AuditReport } from './report.js';
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
export const coverageLabels = {
  TESTED: 'Toestand bereikt en onderzocht',
  SKIPPED: 'Overgeslagen',
  UNREACHED: 'Toestand niet bereikt',
} as const;
/** Includes states without frames; these must not disappear from exported scope. */
export function renderCoverage(
  coverage: AuditReport['routes'][number]['coverage'],
): string {
  if (!coverage?.length) return '';
  return `<details class="scenario-coverage"><summary>Geteste en niet bereikte toestanden (${coverage.length})</summary><p>Een bereikte toestand zegt nog niets over de meetkwaliteit. De metingen hieronder tonen hoeveel beelden werkelijk geanalyseerd zijn.</p><ul>${coverage.map((entry) => `<li><strong>${escape(entry.scenario)}</strong> · ${coverageLabels[entry.outcome]}${entry.viewport ? ` · ${entry.viewport.width} × ${entry.viewport.height} CSS-pixels · DPR ${entry.viewport.dpr}` : ''}${entry.viewportMethod ? ` · ${entry.viewportMethod === 'CDP' ? 'Schermformaat via browseremulatie' : 'Fysiek browservenster'}` : ''}${entry.reason ? `<p>${escape(entry.reason)}</p>` : ''}</li>`).join('')}</ul></details>`;
}
