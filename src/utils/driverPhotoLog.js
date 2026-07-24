// Privacy-safe driver photo tracing. Never log local URIs, download URLs, image
// bytes, raw user IDs, CPF, document values or Firebase Storage paths.
// Candidate version + event + duration provide enough correlation for debugging.

const ALLOWED_KEYS = new Set([
  'version',
  'status',
  'source',
  'action',
  'stage',
  'progress',
  'durationMs',
  'width',
  'height',
  'hasApprovedPhoto',
  'hasCandidate',
  'reasonCode',
  'code',
  'message',
]);

export function logDriverPhotoEvent(event, details = {}, level = 'log') {
  const safe = { event, atMs: Date.now() };
  Object.entries(details || {}).forEach(([key, value]) => {
    if (!ALLOWED_KEYS.has(key) || value == null) return;
    if (key === 'message') safe[key] = String(value).slice(0, 160);
    else safe[key] = value;
  });
  const method = console[level] || console.log;
  method(`[DRIVER_PHOTO] ${event}`, safe);
}
