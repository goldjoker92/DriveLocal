export const PASSENGER_PUBLIC_FALLBACK_NAME = 'Passageiro';
export const PASSENGER_PUBLIC_FIRST_NAME_MAX_LENGTH = 40;

export function safeAcceptedPassengerFirstName(identity) {
  const normalized = typeof identity?.firstName === 'string'
    ? identity.firstName.normalize('NFKC').trim().replace(/\s+/g, ' ')
    : '';
  if (!normalized || normalized.includes('@')) return PASSENGER_PUBLIC_FALLBACK_NAME;

  const firstToken = normalized.split(' ')[0]
    .replace(/[^\p{L}\p{M}'’-]/gu, '')
    .replace(/^['’\-]+|['’\-]+$/g, '')
    .slice(0, PASSENGER_PUBLIC_FIRST_NAME_MAX_LENGTH);

  return /\p{L}/u.test(firstToken) ? firstToken : PASSENGER_PUBLIC_FALLBACK_NAME;
}
