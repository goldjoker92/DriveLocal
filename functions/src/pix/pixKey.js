// @ts-check
// Pure Pix-key normalization used before eligibility and BR Code generation.
// It never logs or returns the original key when validation fails.

const PIX_KEY_TYPES = Object.freeze({
  CPF: 'cpf',
  PHONE: 'phone',
  EMAIL: 'email',
  RANDOM: 'random',
});

const DISPLAY_TYPES = Object.freeze({
  [PIX_KEY_TYPES.CPF]: 'CPF',
  [PIX_KEY_TYPES.PHONE]: 'Telefone',
  [PIX_KEY_TYPES.EMAIL]: 'E-mail',
  [PIX_KEY_TYPES.RANDOM]: 'Chave aleatória',
});

function typeToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function resolvePixKeyType(value, key = '') {
  const token = typeToken(value);
  if (token === 'cpf') return PIX_KEY_TYPES.CPF;
  if (['telefone', 'phone', 'celular'].includes(token)) return PIX_KEY_TYPES.PHONE;
  if (['email', 'emailpix'].includes(token)) return PIX_KEY_TYPES.EMAIL;
  if (['chavealeatoria', 'aleatoria', 'random', 'evp'].includes(token)) {
    return PIX_KEY_TYPES.RANDOM;
  }
  if (token) return null;

  const raw = String(key || '').trim();
  if (raw.includes('@')) return PIX_KEY_TYPES.EMAIL;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return PIX_KEY_TYPES.RANDOM;
  }
  if (raw.startsWith('+')) return PIX_KEY_TYPES.PHONE;
  if (/^\d{11}$/.test(raw.replace(/\D/g, ''))) return PIX_KEY_TYPES.CPF;
  return null;
}

function isValidCpfDigits(digits) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(digits[i]) * (10 - i);
  let remainder = sum % 11;
  const first = remainder < 2 ? 0 : 11 - remainder;
  if (first !== Number(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(digits[i]) * (11 - i);
  remainder = sum % 11;
  const second = remainder < 2 ? 0 : 11 - remainder;
  return second === Number(digits[10]);
}

function invalid(reasonCode, keyType = null) {
  return {
    valid: false,
    key: null,
    keyType,
    pixKeyType: keyType ? DISPLAY_TYPES[keyType] : null,
    reasonCode,
  };
}

function valid(key, keyType) {
  return {
    valid: true,
    key,
    keyType,
    pixKeyType: DISPLAY_TYPES[keyType],
    reasonCode: null,
  };
}

function normalizePixKey(value, declaredType) {
  const raw = String(value || '').trim();
  if (!raw) return invalid('PIX_KEY_EMPTY');
  const keyType = resolvePixKeyType(declaredType, raw);
  if (!keyType) return invalid('PIX_KEY_TYPE_INVALID');

  if (keyType === PIX_KEY_TYPES.CPF) {
    const digits = raw.replace(/\D/g, '');
    return isValidCpfDigits(digits)
      ? valid(digits, keyType)
      : invalid('PIX_KEY_CPF_INVALID', keyType);
  }

  if (keyType === PIX_KEY_TYPES.PHONE) {
    const digits = raw.replace(/\D/g, '');
    const national = digits.startsWith('55') && [12, 13].includes(digits.length)
      ? digits.slice(2)
      : digits;
    if (![10, 11].includes(national.length) || national.startsWith('0')) {
      return invalid('PIX_KEY_PHONE_INVALID', keyType);
    }
    return valid(`+55${national}`, keyType);
  }

  if (keyType === PIX_KEY_TYPES.EMAIL) {
    const email = raw.toLowerCase();
    if (
      email.length > 77
      || !/^[\x21-\x7e]+$/.test(email)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return invalid('PIX_KEY_EMAIL_INVALID', keyType);
    }
    return valid(email, keyType);
  }

  const randomKey = raw.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(randomKey)) {
    return invalid('PIX_KEY_RANDOM_INVALID', keyType);
  }
  return valid(randomKey, keyType);
}

const PIX_KEY_TYPE = Object.freeze({
  CPF: 'CPF',
  PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  EVP: 'EVP',
});

const LEGACY_TYPE_BY_INTERNAL = Object.freeze({
  [PIX_KEY_TYPES.CPF]: PIX_KEY_TYPE.CPF,
  [PIX_KEY_TYPES.PHONE]: PIX_KEY_TYPE.PHONE,
  [PIX_KEY_TYPES.EMAIL]: PIX_KEY_TYPE.EMAIL,
  [PIX_KEY_TYPES.RANDOM]: PIX_KEY_TYPE.EVP,
});

function canonicalPixKeyType(value, key = '') {
  const internalType = resolvePixKeyType(value, key);
  return internalType ? LEGACY_TYPE_BY_INTERNAL[internalType] : null;
}

function validateAndNormalizePixKey(value, declaredType) {
  const normalized = normalizePixKey(value, declaredType);
  const reasonMap = {
    PIX_KEY_EMPTY: 'missing',
    PIX_KEY_TYPE_INVALID: 'unknown_type',
    PIX_KEY_CPF_INVALID: 'invalid_cpf',
    PIX_KEY_PHONE_INVALID: 'invalid_phone',
    PIX_KEY_EMAIL_INVALID: 'invalid_email',
    PIX_KEY_RANDOM_INVALID: 'invalid_evp',
  };

  return {
    valid: normalized.valid,
    value: normalized.valid ? normalized.key : String(value || '').trim(),
    type: normalized.keyType
      ? LEGACY_TYPE_BY_INTERNAL[normalized.keyType]
      : canonicalPixKeyType(declaredType, value),
    reason: normalized.valid
      ? null
      : (reasonMap[normalized.reasonCode] || 'invalid'),
  };
}

module.exports = {
  PIX_KEY_TYPE,
  canonicalPixKeyType,
  validateAndNormalizePixKey,
  validCpfDigits: isValidCpfDigits,
  PIX_KEY_TYPES,
  DISPLAY_TYPES,
  resolvePixKeyType,
  isValidCpfDigits,
  normalizePixKey,
};
