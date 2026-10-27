export const labels: Record<string, string> = {
  AUTHORIZING: 'Toegang voorbereiden',
  RUNNING: 'Scan loopt',
  PAUSED: 'Gepauzeerd',
  STOPPING: 'Scan wordt gestopt',
  COMPLETED: 'Scan afgerond',
  PARTIAL: 'Gedeeltelijk onderzocht',
  INTERRUPTED: 'Onderbroken',
  ERROR: 'Scan mislukt',
};
export function scenarioLabel(value: string) {
  const compact = value.startsWith('compact-');
  const scenario = value.replace(/^compact-/, '');
  const names: Record<string, string> = {
    viewport: 'Zichtbare pagina',
    initial: 'Eerste weergave',
    accordion: 'Uitklapbaar onderdeel',
    tab: 'Tabblad',
    menu: 'Menu',
    media: 'Media',
    carousel: 'Carousel',
    focus: 'Toetsenbordfocus',
    hover: 'Hoverinteractie',
    scroll: 'Scrollpositie',
  };
  const match = scenario.match(/^([a-z]+)(?:-(\d+))?$/);
  const label =
    match && names[match[1]]
      ? `${names[match[1]]}${match[2] ? ` · ${match[2]}` : ''}`
      : scenario.replaceAll('-', ' ');
  return `${label}${compact ? ' · compact scherm' : ''}`;
}
export function stopSummary(reason: string | undefined) {
  if (!reason) return 'Voortgang wordt lokaal bewaard.';
  const names: Record<string, string> = {
    QUEUE_EXHAUSTED:
      'Het scanplan is doorlopen. Bekijk de meetdekking voor overgeslagen toestanden.',
    USER_STOP: 'De scan is gestopt. De reeds gemaakte metingen zijn bewaard.',
    SCAN_TAB_CLOSED: 'De scantab werd gesloten.',
    BROWSER_OR_WORKER_RESTART:
      'De scan is onderbroken door een browser- of extensieherstart.',
  };
  return (
    names[reason] ??
    'De scan is beëindigd. De afsluitreden staat bij de meetdetails.'
  );
}
