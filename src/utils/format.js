// Small formatting helpers for the UI.
// IMPORTANT: all money in DriveLocal is stored as integer cents (centavos).
// These helpers only format for display — never use them for math.

// Format integer cents as Brazilian Real, e.g. 1234 -> "R$ 12,34".
export function formatBRL(cents) {
  const value = (Number(cents) || 0) / 100;
  return 'R$ ' + value.toFixed(2).replace('.', ',');
}

// Format meters as kilometers, e.g. 3400 -> "3,4 km".
export function formatDistanceKm(meters) {
  const km = (Number(meters) || 0) / 1000;
  return km.toFixed(1).replace('.', ',') + ' km';
}

// Format route seconds as a passenger-friendly whole-minute estimate.
export function formatDurationMinutes(seconds) {
  const minutes = Math.max(1, Math.ceil((Number(seconds) || 0) / 60));
  return `${minutes} min`;
}
