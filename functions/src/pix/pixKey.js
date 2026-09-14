// @ts-check
// Authoritative Pix key validation used before dispatch and BR Code generation.

const PIX_KEY_TYPE = Object.freeze({
  CPF: 'CPF',
  PHONE: 'PHONE',
  EMAIL: 'EMAIL',
  EVP: 'EVP',
});

function comparableType(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function canonicalPixKeyType(value) {
  const type = comparableType(value);
  if (type === 'cpf') return PIX_KEY_TYPE.CPF;
  if (type === 'telefone' || type === 'phone' || type === 'celular') return PIX_KEY_TYPE.PHONE;
  if (type === 'e-mail' || type === 'email') return PIX_KEY_TYPE.EMAIL;
  if (type === 'chave aleatoria' || type === 'evp' || type === 'aleatoria') return PIX_KEY_TYPE.EVP;
  return null;
}

function validCpfDigits(digits) {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(digits[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return Number(digits[length]) === (remainder === 10 ? 0 : remainder);
  };
  return check(9) && check(10);
}

function inferPixKeyType(raw) {
  if (raw.includes('@')) return PIX_KEY_TYPE.EMAIL;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return PIX_KEY_TYPE.EVP;
  }
  if (raw.startsWith('+') || /[()]/.test(raw)) return PIX_KEY_TYPE.PHONE;
  const digits = raw.replace(/\D/g, '');
  if (validCpfDigits(digits)) return PIX_KEY_TYPE.CPF;
  if (digits.length === 10 || ((digits.length === 12 || digits.length === 13) && digits.startsWith('55'))) {
    return PIX_KEY_TYPE.PHONE;
  }
  return null;
}

function validateAndNormalizePixKey(value, declaredType) {
  const raw = String(value || '').trim();
  const type = canonicalPixKeyType(declaredType) || inferPixKeyType(raw);
  if (!raw) return { valid: false, value: '', type, reason: 'missing' };
  if (!type) return { valid: false, value: raw, type: null, reason: 'unknown_type' };

  if (type === PIX_KEY_TYPE.CPF) {
    const digits = raw.replace(/\D/g, '');
    const valid = validCpfDigits(digits);
    return { valid, value: digits, type, reason: valid ? null : 'invalid_cpf' };
  }

  if (type === PIX_KEY_TYPE.PHONE) {
    const digits = raw.replace(/\D/g, '');
    const normalized = raw.startsWith('+')
      ? '+' + digits
      : (digits.startsWith('55') && (digits.length === 12 || digits.length === 13))
        ? '+' + digits
        : (digits.length === 10 || digits.length === 11)
          ? '+55' + digits
          : '';
    const valid = /^\+55\d{10,11}$/.test(normalized);
    return { valid, value: normalized || raw, type, reason: valid ? null : 'invalid_phone' };
  }

  if (type === PIX_KEY_TYPE.EMAIL) {
    const normalized = raw.toLowerCase();
    const valid = normalized.length <= 77
      && /^[a-z0-9.!#$%&'*+/=?^_{}|~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(normalized);
    return { valid, value: normalized, type, reason: valid ? null : 'invalid_email' };
  }

  const normalized = raw.toLowerCase();
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
  return { valid, value: normalized, type, reason: valid ? null : 'invalid_evp' };
}

module.exports = {
  PIX_KEY_TYPE,
  canonicalPixKeyType,
  validateAndNormalizePixKey,
  validCpfDigits,
};
