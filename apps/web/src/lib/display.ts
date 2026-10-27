export const statusLabel = (status: string): string =>
  ({
    NO_ISSUES_OBSERVED: 'Geen problemen waargenomen',
    NEEDS_REVIEW: 'Beoordeling nodig',
    INCONCLUSIVE: 'Onbeslisbaar',
    ERROR: 'Meting mislukt',
    OBSERVED: 'Gemeten',
    PARTIAL: 'Gedeeltelijk',
    SKIPPED: 'Overgeslagen',
    COMPLETED: 'Afgerond',
    INTERRUPTED: 'Onderbroken',
    ACTIVE: 'Actief',
    REVOKED: 'Ingetrokken',
    HIDDEN_BY_MODERATION: 'Verborgen door beheer',
    PRIVATE: 'Privé',
    UNLISTED: 'Via een link',
    PUBLIC: 'Openbaar',
  })[status] || status;
export const dateLabel = (date: string): string =>
  new Intl.DateTimeFormat('nl-BE', {
    dateStyle: 'medium',
    timeZone: 'Europe/Brussels',
  }).format(new Date(date));
export const hostLabel = (origin: string): string => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};
