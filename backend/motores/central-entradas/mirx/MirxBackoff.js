/**
 * MIRX — Backoff inteligente progressivo (RC3.4.1).
 *
 * Escalonamento: 5m → 15m → 30m → 1h → 2h → 4h → 8h → 24h
 * Após recuperação bem-sucedida, o ciclo reinicia (tentativa 0).
 *
 * @module motores/central-entradas/mirx/MirxBackoff
 */

/** Minutos entre tentativas (índice = tentativa já realizada). */
const BACKOFF_MINUTOS = Object.freeze([5, 15, 30, 60, 120, 240, 480, 1440]);

function minutosParaMs(min) {
  return Number(min) * 60 * 1000;
}

/**
 * @param {number} tentativa Número de tentativas já feitas (0 = primeira espera)
 * @returns {number} ms
 */
function calcularBackoffMs(tentativa) {
  const idx = Math.max(0, Math.min(BACKOFF_MINUTOS.length - 1, Number(tentativa) || 0));
  return minutosParaMs(BACKOFF_MINUTOS[idx]);
}

/**
 * @param {number} tentativa
 * @param {Date|number} [agora]
 * @returns {string} ISO
 */
function calcularProximaEm(tentativa, agora = new Date()) {
  const base = agora instanceof Date ? agora.getTime() : Number(agora) || Date.now();
  return new Date(base + calcularBackoffMs(tentativa)).toISOString();
}

/**
 * @param {number} tentativa
 * @returns {{ minutos: number, label: string, ms: number }}
 */
function descreverBackoff(tentativa) {
  const idx = Math.max(0, Math.min(BACKOFF_MINUTOS.length - 1, Number(tentativa) || 0));
  const minutos = BACKOFF_MINUTOS[idx];
  let label = `${minutos} min`;
  if (minutos >= 60) {
    const h = minutos / 60;
    label = Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
  }
  return { minutos, label, ms: minutosParaMs(minutos), degrau: idx + 1 };
}

module.exports = {
  BACKOFF_MINUTOS,
  calcularBackoffMs,
  calcularProximaEm,
  descreverBackoff,
  minutosParaMs
};
