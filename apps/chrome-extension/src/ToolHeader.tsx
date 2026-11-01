import type { CommandAction } from './command-protocol';
import { ToolIcon } from './ToolIcon';
/** Keep popup navigation and workspace identity consistent across extension surfaces. */
export function ToolHeader({
  popup,
  workspaceView,
  act,
}: {
  popup: boolean;
  workspaceView: 'scan' | 'history' | 'settings';
  act: CommandAction;
}) {
  return (
    <header className="tool-header">
      {popup ? (
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            void act('OPEN_DASHBOARD');
          }}
        >
          <span className="brand-symbol">
            <ToolIcon name="scan" />
          </span>
          epi-less
        </a>
      ) : (
        <div className="breadcrumb">
          Lokale werkruimte <span>/</span>{' '}
          <h1>
            {workspaceView === 'history'
              ? 'Geschiedenis'
              : workspaceView === 'settings'
                ? 'Instellingen'
                : 'Scaninspectie'}
          </h1>
        </div>
      )}
      {popup ? (
        <button
          className="icon-button"
          aria-label="Open werkruimte"
          title="Open werkruimte"
          onClick={() => void act('OPEN_DASHBOARD')}
        >
          <ToolIcon name="external" />
        </button>
      ) : (
        <span className="preview-tag">Ontwikkelversie</span>
      )}
    </header>
  );
}
