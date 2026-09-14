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

export function canonicalPixKeyType(value) {
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

export function validateAndNormalizePixKey(value, declaredType) {
  const raw = String(value || '').trim();
  const type = canonicalPixKeyType(declaredType) || inferPixKeyType(raw);
  if (!raw) return { valid: false, value: '', type, message: 'Informe sua chave Pix.' };
  if (!type) return { valid: false, value: raw, type: null, message: 'Escolha o tipo correto da chave Pix.' };

  if (type === PIX_KEY_TYPE.CPF) {
    const digits = raw.replace(/\D/g, '');
    return validCpfDigits(digits)
      ? { valid: true, value: digits, type, message: '' }
      : { valid: false, value: digits, type, message: 'Informe um CPF Pix válido com 11 dígitos.' };
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
    return valid
      ? { valid: true, value: normalized, type, message: '' }
      : { valid: false, value: normalized || raw, type, message: 'Informe um telefone brasileiro válido com DDD.' };
  }

  if (type === PIX_KEY_TYPE.EMAIL) {
    const normalized = raw.toLowerCase();
    const valid = normalized.length <= 77
      && /^[a-z0-9.!#$%&'*+/=?^_{}|~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(normalized);
    return valid
      ? { valid: true, value: normalized, type, message: '' }
      : { valid: false, value: normalized, type, message: 'Informe um e-mail Pix válido.' };
  }

  const normalized = raw.toLowerCase();
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
  return valid
    ? { valid: true, value: normalized, type, message: '' }
    : { valid: false, value: normalized, type, message: 'Informe a chave aleatória completa (UUID).' };
}

export { PIX_KEY_TYPE };
