// @ts-check
// Isolated, standards-compliant Pix "BR Code" (EMV-MPM) payload generator for
// direct passenger->driver ride payment. Pure string building + CRC16-CCITT
// (0x1021, init 0xFFFF). No provider, no secret, no external dependency. The
// caller supplies the VERIFIED driver Pix key (read server-side); this module
// never logs or persists it.

// Builds one EMV TLV field: id (2 chars) + length (2 digits) + value.
function tlv(id, value) {
  const v = String(value);
  const len = String(v.length).padStart(2, '0');
  return `${id}${len}${v}`;
}

// CRC16-CCITT (polynomial 0x1021, initial 0xFFFF) over the ASCII string.
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i += 1) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// Keeps only characters safe for the EMV name/city/txid fields and trims length.
function sanitizeText(value, max) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .slice(0, max);
}

// Alphanumeric reference (txid) — deterministic per ride; <= 25 chars.
function sanitizeTxid(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 25) || '***';
}

/**
 * Builds a static Pix BR Code payload with an amount.
 * @param {{pixKey:string, amountCentavos:number, merchantName:string, city:string, txid:string}} p
 * @returns {string} the copy-and-paste ("copia e cola") payload
 */
function buildPixPayload(p) {
  const amount = (Number(p.amountCentavos) / 100).toFixed(2);
  const merchantAccount = tlv('00', 'br.gov.bcb.pix') + tlv('01', String(p.pixKey));
  const additionalData = tlv('05', sanitizeTxid(p.txid));

  let payload =
    tlv('00', '01') + // payload format indicator
    tlv('26', merchantAccount) + // merchant account info (Pix)
    tlv('52', '0000') + // merchant category code
    tlv('53', '986') + // currency: BRL
    tlv('54', amount) + // transaction amount
    tlv('58', 'BR') + // country
    tlv('59', sanitizeText(p.merchantName, 25) || 'DRIVELOCAL') + // recipient name
    tlv('60', sanitizeText(p.city, 15) || 'HORIZONTE') + // city
    tlv('62', additionalData); // additional data (reference)

  // CRC is computed over the payload WITH the CRC field id+length ("6304") appended.
  payload += '6304';
  return payload + crc16(payload);
}

module.exports = { buildPixPayload, crc16, sanitizeText, sanitizeTxid };
