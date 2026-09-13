'use strict';

/**
 * RC12.1 — Sanitização fail-closed de payloads de observabilidade.
 * Remove CSC, senhas PFX, tokens, JWT, PAN e XML completo.
 * @module observabilidade/eventSanitizer
 */

const SENSITIVE_KEY_RE = /^(csc|token_csc|fiscal_token_csc|senha|password|pwd|pass|secret|private[_-]?key|certificado[_-]?senha|fiscal_certificado_senha|jwt|authorization|bearer|pan|cvv|card[_-]?number|numero[_-]?cartao|access[_-]?token|refresh[_-]?token|api[_-]?key|master[_-]?key|encryption[_-]?key)$/i;

const SENSITIVE_SUBSTRING_RE = /(csc|senha|password|token|jwt|privatekey|pfx|bearer|pan\b|cvv)/i;

const XML_KEY_RE = /^(xml|xml_envio|xml_retorno|xml_assinado|soap|envelope|nfeProc|nfe_xml)$/i;

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const PAN_RE = /\b(?:\d[ -]*?){13,19}\b/g;

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function looksLikeXml(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 20) return false;
  return trimmed.startsWith('<') && (
    /<\/?[a-zA-Z_][\w:.-]*[\s>]/.test(trimmed)
    || trimmed.includes('<?xml')
    || trimmed.includes('<soap')
    || trimmed.includes('<NFe')
    || trimmed.includes('<nfeProc')
  );
}

function redactString(value) {
  let text = String(value);
  if (JWT_RE.test(text.trim())) return '[REDACTED_JWT]';
  if (looksLikeXml(text)) {
    return `[REDACTED_XML len=${text.length}]`;
  }
  text = text.replace(PAN_RE, '[REDACTED_PAN]');
  text = text.replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]');
  text = text.replace(/(senha|password|pwd|csc|token)\s*[:=]\s*["']?[^"'<\s]+/gi, '$1=[REDACTED]');
  return text;
}

/**
 * @param {any} value
 * @param {Set<string>} [seen]
 * @param {string} [keyHint]
 * @returns {{ value: any, redacted: boolean }}
 */
function sanitizeValue(value, seen = new Set(), keyHint = '') {
  if (value == null) return { value, redacted: false };

  if (typeof value === 'string') {
    const before = value;
    if (SENSITIVE_KEY_RE.test(keyHint) || (SENSITIVE_SUBSTRING_RE.test(keyHint) && keyHint.length < 64)) {
      return { value: '[REDACTED]', redacted: true };
    }
    if (XML_KEY_RE.test(keyHint) || looksLikeXml(value)) {
      return { value: `[REDACTED_XML len=${value.length}]`, redacted: true };
    }
    const after = redactString(value);
    return { value: after, redacted: after !== before };
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return { value, redacted: false };
  }

  if (typeof value === 'bigint') {
    return { value: Number(value), redacted: false };
  }

  if (value instanceof Date) {
    return { value: value.toISOString(), redacted: false };
  }

  if (typeof value === 'function') {
    return { value: '[Function]', redacted: true };
  }

  if (typeof value !== 'object') {
    return { value: String(value), redacted: false };
  }

  if (seen.has(value)) {
    return { value: '[Circular]', redacted: true };
  }
  seen.add(value);

  if (Array.isArray(value)) {
    let redacted = false;
    const out = value.map((item) => {
      const r = sanitizeValue(item, seen, keyHint);
      if (r.redacted) redacted = true;
      return r.value;
    });
    return { value: out, redacted };
  }

  if (!isPlainObject(value) && value && typeof value.toJSON === 'function') {
    try {
      return sanitizeValue(value.toJSON(), seen, keyHint);
    } catch {
      return { value: '[Unserializable]', redacted: true };
    }
  }

  let redacted = false;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key) || (SENSITIVE_SUBSTRING_RE.test(key) && /senha|password|token|csc|jwt|pfx|pan|secret|key/i.test(key))) {
      out[key] = '[REDACTED]';
      redacted = true;
      continue;
    }
    if (XML_KEY_RE.test(key)) {
      const len = typeof nested === 'string' ? nested.length : null;
      out[key] = len != null ? `[REDACTED_XML len=${len}]` : '[REDACTED_XML]';
      redacted = true;
      continue;
    }
    const r = sanitizeValue(nested, seen, key);
    out[key] = r.value;
    if (r.redacted) redacted = true;
  }
  return { value: out, redacted };
}

/**
 * @param {any} payload
 * @returns {{ payload: object, sanitized: boolean }}
 */
function sanitizePayload(payload) {
  if (payload == null) return { payload: {}, sanitized: false };
  const result = sanitizeValue(payload);
  if (!isPlainObject(result.value) && !Array.isArray(result.value)) {
    return { payload: { value: result.value }, sanitized: result.redacted };
  }
  if (Array.isArray(result.value)) {
    return { payload: { items: result.value }, sanitized: result.redacted };
  }
  return { payload: result.value, sanitized: result.redacted };
}

module.exports = {
  sanitizePayload,
  sanitizeValue,
  looksLikeXml,
  SENSITIVE_KEY_RE
};
