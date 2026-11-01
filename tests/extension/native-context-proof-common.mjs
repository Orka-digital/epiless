// Pure evidence checker. Usage: node verify-native-context-guard.mjs evidence.json
// This does not generate evidence or start/attach a browser.

export const hash = /^[a-f0-9]{64}$/;

export const pixelFinding = ({ id, type, startMs, endMs, region, spatial }) => {
  const result = structuredClone({ id, type, startMs, endMs, region, spatial });
  if (result.spatial) delete result.spatial.visualField;
  return result;
};

export const hasActiveCapture = (snapshot, tabId) =>
  snapshot.capturedTabs.some(
    (value) =>
      value.tabId === tabId && ['active', 'pending'].includes(value.status),
  );

export const hasLiveTrack = (snapshot) =>
  snapshot.tracks.context === 'OPEN' &&
  snapshot.tracks.streams.some(
    (stream) =>
      stream.active &&
      stream.tracks.some((track) => track.readyState === 'live'),
  );
