// ============================================================
// Validation utilitaires DriveLocal — Iteration 1B
// Fonctions pures, testables, sans dépendances externes
// ============================================================

// Valide un CPF brésilien (algorithme officiel des 2 chiffres vérificateurs).
// Retourne { valid: bool, message: string PT-BR }.
export function validateCPF(cpf) {
  // 1. Ne garde que les chiffres (supprime points et tirets).
  const digits = String(cpf || '').replace(/\D/g, '');

  // 2. Doit contenir exactement 11 chiffres.
  if (digits.length !== 11) {
    console.log('[VALIDATION] CPF result: invalid (tamanho)');
    return { valid: false, message: 'CPF deve conter 11 dígitos.' };
  }

  // 3. Rejette les 11 chiffres identiques (ex: 00000000000).
  if (/^(\d)\1{10}$/.test(digits)) {
    console.log('[VALIDATION] CPF result: invalid (repetido)');
    return { valid: false, message: 'CPF inválido.' };
  }

  // 4. 1er chiffre vérificateur : somme pondérée des 9 premiers (10..2), mod 11.
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += parseInt(digits[i], 10) * (10 - i);
  let rest = sum % 11;
  const dv1 = rest < 2 ? 0 : 11 - rest;
  if (dv1 !== parseInt(digits[9], 10)) {
    console.log('[VALIDATION] CPF result: invalid (dv1)');
    return { valid: false, message: 'CPF inválido.' };
  }

  // 5. 2ème chiffre vérificateur : somme pondérée des 10 premiers (11..2), mod 11.
  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += parseInt(digits[i], 10) * (11 - i);
  rest = sum % 11;
  const dv2 = rest < 2 ? 0 : 11 - rest;
  if (dv2 !== parseInt(digits[10], 10)) {
    console.log('[VALIDATION] CPF result: invalid (dv2)');
    return { valid: false, message: 'CPF inválido.' };
  }

  // 6. CPF valide.
  console.log('[VALIDATION] CPF result: valid');
  return { valid: true, message: '' };
}

// Valide une plaque brésilienne (ancien format ou Mercosul).
// Retourne { valid: bool, message: string PT-BR }.
export function validatePlate(plate) {
  // Normalise en majuscules et retire les espaces.
  const p = String(plate || '').toUpperCase().replace(/\s/g, '');

  const oldFormat = /^[A-Z]{3}-?\d{4}$/; // ex: ABC-1234 ou ABC1234
  const mercosul = /^[A-Z]{3}\d[A-Z]\d{2}$/; // ex: ABC1D23

  const valid = oldFormat.test(p) || mercosul.test(p);
  console.log('[VALIDATION] plate result:', valid ? 'valid' : 'invalid', p);
  return {
    valid,
    message: valid ? '' : 'Placa inválida. Use o formato ABC-1234 ou ABC1D23.',
  };
}

// Valide l'année du véhicule : doit être >= (année actuelle - 10).
// Retourne { valid: bool, message: string PT-BR }.
export function validateVehicleYear(year) {
  const y = parseInt(year, 10);
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 10;

  if (Number.isNaN(y)) {
    console.log('[VALIDATION] year result: invalid (NaN)');
    return { valid: false, message: 'Informe um ano válido.' };
  }

  // Refuse les véhicules trop anciens, ou une année future irréaliste.
  if (y < minYear || y > currentYear + 1) {
    console.log('[VALIDATION] year result: invalid', y);
    return { valid: false, message: `Ano do veículo deve ser a partir de ${minYear}.` };
  }

  console.log('[VALIDATION] year result: valid', y);
  return { valid: true, message: '' };
}

// Formate 11 chiffres bruts en CPF lisible : 123.456.789-09.
// Retourne la chaîne d'origine si le format n'est pas exploitable.
export function formatCPF(cpf) {
  const digits = String(cpf || '').replace(/\D/g, '');
  if (digits.length !== 11) return String(cpf || '');
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

// Formate un téléphone brésilien en +55 85 99999-9999.
// Retourne la chaîne d'origine si le format n'est pas exploitable.
export function formatPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');

  // Retire l'indicatif pays s'il est déjà présent.
  if (digits.startsWith('55') && digits.length > 11) {
    digits = digits.slice(2);
  }

  // Attendu : DDD (2) + numéro (8 ou 9 chiffres).
  if (digits.length !== 10 && digits.length !== 11) {
    return String(phone || '');
  }

  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const splitAt = rest.length === 9 ? 5 : 4; // 9 chiffres -> 5-4, 8 chiffres -> 4-4
  const part1 = rest.slice(0, splitAt);
  const part2 = rest.slice(splitAt);
  return `+55 ${ddd} ${part1}-${part2}`;
}
