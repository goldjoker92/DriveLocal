import { validateCPF } from './validation';

const DISPLAY_TYPES = Object.freeze({
  cpf: 'CPF',
  phone: 'Telefone',
  email: 'E-mail',
  random: 'Chave aleatória',
});

function typeToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function resolveType(value) {
  const token = typeToken(value);
  if (token === 'cpf') return 'cpf';
  if (['telefone', 'phone', 'celular'].includes(token)) return 'phone';
  if (['email', 'emailpix'].includes(token)) return 'email';
  if (['chavealeatoria', 'aleatoria', 'random', 'evp'].includes(token)) return 'random';
  return null;
}

function invalid(message) {
  return { valid: false, key: null, pixKeyType: null, message };
}

function valid(key, keyType) {
  return { valid: true, key, pixKeyType: DISPLAY_TYPES[keyType], message: '' };
}

export function normalizePixKey(value, declaredType) {
  const raw = String(value || '').trim();
  if (!raw) return invalid('Informe sua chave Pix.');
  const keyType = resolveType(declaredType);
  if (!keyType) return invalid('Escolha um tipo de chave Pix válido.');

  if (keyType === 'cpf') {
    const cpfResult = validateCPF(raw);
    return cpfResult.valid
      ? valid(raw.replace(/\D/g, ''), keyType)
      : invalid('Informe um CPF válido para a chave Pix.');
  }

  if (keyType === 'phone') {
    const digits = raw.replace(/\D/g, '');
    const national = digits.startsWith('55') && [12, 13].includes(digits.length)
      ? digits.slice(2)
      : digits;
    if (![10, 11].includes(national.length) || national.startsWith('0')) {
      return invalid('Informe o telefone com DDD, por exemplo +55 85 99999-9999.');
    }
    return valid(`+55${national}`, keyType);
  }

  if (keyType === 'email') {
    const email = raw.toLowerCase();
    if (
      email.length > 77
      || !/^[\x21-\x7e]+$/.test(email)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return invalid('Informe um e-mail válido para a chave Pix.');
    }
    return valid(email, keyType);
  }

  const randomKey = raw.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(randomKey)) {
    return invalid('Informe a chave aleatória completa, com letras, números e hífens.');
  }
  return valid(randomKey, keyType);
}

export { DISPLAY_TYPES };
