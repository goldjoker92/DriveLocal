// Pure passenger dashboard helpers. Keep Firebase and React Native out of this file
// so name and display rules remain deterministic and inexpensive to test.

function cleanText(value, maxLength = 120) {
  const text = String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, maxLength) : '';
}

export function getPassengerFirstName(profile, authUser) {
  const candidates = [
    profile?.fullName,
    profile?.name,
    authUser?.displayName,
  ];

  for (const candidate of candidates) {
    const value = cleanText(candidate, 80);
    if (value && !value.includes('@')) return value.split(' ')[0].slice(0, 40);
  }

  return 'Passageiro';
}
