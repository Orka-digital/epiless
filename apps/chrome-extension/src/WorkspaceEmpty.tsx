import { ToolIcon } from './ToolIcon';

import { useScannerConnection } from './useScannerConnection';

/** Render workspace empty evidence; actions remain explicit callbacks owned by the workspace. */
export function WorkspaceEmpty({
  state,
}: {
  state: ReturnType<typeof useScannerConnection>['state'];
}) {
  return (
    <section className="workspace-empty">
      <span className="empty-symbol">
        <ToolIcon name="scan" />
      </span>
      <p className="label">NOG GEEN LOKALE SCANS</p>
      <h2>Je onderzoek begint op een website.</h2>
      <p>
        Open de website die je wilt onderzoeken. Klik op epi-less naast de
        adresbalk en kies <strong>Scan deze website</strong>.
      </p>
      <div className="empty-steps">
        <span>
          <b>1</b> Open een website
        </span>
        <span>
          <b>2</b> Start via de extensie
        </span>
        <span>
          <b>3</b> Onderzoek hier de resultaten
        </span>
      </div>
      <a
        href={`${state?.webOrigin || ''}/docs`}
        target="_blank"
        rel="noreferrer"
      >
        Handleiding openen <ToolIcon name="arrow" />
      </a>
    </section>
  );
}
