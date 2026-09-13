'use strict';

/**
 * Score e chaves do Motor de Identidade (MIE) — RC2.1
 *
 * Prioridade:
 * 1 Serial Number → 2 MAC → 3 Firmware+Modelo → 4 VID/PID → 5 Driver → 6 Assinatura
 */

const LIMIARES = Object.freeze({
  MESMO: 0.95,
  PROVAVEL: 0.70,
  SEMELHANTE: 0.40,
  NOVO: 0
});

function normalizarTexto(v) {
  if (v == null || v === '') return null;
  return String(v).trim().toLowerCase();
}

function normalizarHex(v) {
  if (v == null || v === '') return null;
  return String(v).replace(/^0x/i, '').toUpperCase().padStart(4, '0');
}

/**
 * Extrai sinais de identidade de um Candidate (sem mutar o DTO).
 * @param {Object} c
 * @returns {Object}
 */
function extrairSinais(c = {}) {
  const ev = c.evidencias && typeof c.evidencias === 'object' ? c.evidencias : {};
  return {
    serial_number: c.serial_number || ev.serial_number || null,
    mac: c.mac || ev.mac || null,
    modelo: c.modelo || null,
    firmware: c.firmware || null,
    vid: normalizarHex(c.vid),
    pid: normalizarHex(c.pid),
    driver_codigo: c.driver_codigo || null,
    assinatura: c.assinatura || null,
    transporte: c.transporte || null,
    ip: c.ip || null,
    porta: c.porta != null ? Number(c.porta) : null,
    porta_com: c.porta_com || null,
    caminho_dispositivo: c.caminho_dispositivo || null
  };
}

/**
 * Chave lógica estável pela melhor evidência disponível.
 * @param {Object} sinais
 * @returns {{ chave: string, nivel: string }}
 */
function chaveIdentidade(sinais) {
  const sn = normalizarTexto(sinais.serial_number);
  if (sn) return { chave: `sn:${sn}`, nivel: 'serial_number' };

  const mac = normalizarTexto(sinais.mac);
  if (mac) return { chave: `mac:${mac.replace(/[^a-f0-9]/gi, '')}`, nivel: 'mac' };

  const modelo = normalizarTexto(sinais.modelo);
  const fw = normalizarTexto(sinais.firmware);
  if (modelo && fw) return { chave: `fm:${modelo}|${fw}`, nivel: 'firmware_modelo' };

  if (sinais.vid && sinais.pid) {
    return { chave: `usb:${sinais.vid}:${sinais.pid}`, nivel: 'vid_pid' };
  }

  const driver = normalizarTexto(sinais.driver_codigo);
  const tr = normalizarTexto(sinais.transporte) || 'x';
  if (driver) {
    const endpoint = sinais.porta_com
      || (sinais.ip ? `${sinais.ip}:${sinais.porta || ''}` : null)
      || sinais.caminho_dispositivo
      || '';
    return { chave: `drv:${driver}|${tr}|${normalizarTexto(endpoint) || 'na'}`, nivel: 'driver' };
  }

  if (sinais.assinatura) {
    return { chave: `sig:${sinais.assinatura}`, nivel: 'assinatura' };
  }

  return { chave: `tmp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, nivel: 'temporario' };
}

/**
 * Pontua correspondência entre sinais do candidato e registro persistido.
 * @param {Object} sinais
 * @param {Object} registro
 * @returns {{ score: number, matches: string[] }}
 */
function pontuarCorrespondencia(sinais, registro) {
  if (!registro) return { score: 0, matches: [] };

  const matches = [];
  let score = 0;

  const snA = normalizarTexto(sinais.serial_number);
  const snB = normalizarTexto(registro.serial_number);
  if (snA && snB && snA === snB) {
    matches.push('serial_number');
    score = Math.max(score, 0.98);
  }

  const macA = normalizarTexto(sinais.mac);
  const macB = normalizarTexto(registro.mac);
  if (macA && macB && macA.replace(/[^a-f0-9]/g, '') === macB.replace(/[^a-f0-9]/g, '')) {
    matches.push('mac');
    score = Math.max(score, 0.95);
  }

  const modA = normalizarTexto(sinais.modelo);
  const modB = normalizarTexto(registro.modelo);
  const fwA = normalizarTexto(sinais.firmware);
  const fwB = normalizarTexto(registro.firmware);
  if (modA && modB && fwA && fwB && modA === modB && fwA === fwB) {
    matches.push('firmware_modelo');
    score = Math.max(score, 0.88);
  } else if (modA && modB && modA === modB && fwA && fwB) {
    // mesmo modelo, firmware diferente: semelhante, não merge automático
    matches.push('modelo');
    score = Math.max(score, 0.42);
  }

  const vidA = normalizarHex(sinais.vid);
  const vidB = normalizarHex(registro.vid);
  const pidA = normalizarHex(sinais.pid);
  const pidB = normalizarHex(registro.pid);
  if (vidA && pidA && vidB && pidB && vidA === vidB && pidA === pidB) {
    matches.push('vid_pid');
    score = Math.max(score, 0.82);
  }

  const drvA = normalizarTexto(sinais.driver_codigo);
  const drvB = normalizarTexto(registro.driver_codigo);
  if (drvA && drvB && drvA === drvB) {
    matches.push('driver');
    // Driver sozinho não basta para afirmar identidade
    score = Math.max(score, 0.35);
  }

  if (sinais.assinatura && registro.assinatura_ref && sinais.assinatura === registro.assinatura_ref) {
    matches.push('assinatura');
    score = Math.max(score, 0.92);
  }

  // Mesmo endpoint ethernet/serial reforça se já há algum match fraco
  if (sinais.ip && registro.ip_atual && sinais.ip === registro.ip_atual) {
    matches.push('ip');
    if (score > 0 && score < 0.7) score = Math.min(0.75, score + 0.15);
  }
  if (sinais.porta_com && registro.porta_com_atual && sinais.porta_com === registro.porta_com_atual) {
    matches.push('porta_com');
    if (score > 0 && score < 0.7) score = Math.min(0.75, score + 0.15);
  }

  return { score: Math.min(1, Number(score.toFixed(4))), matches };
}

function classificarScore(score) {
  if (score >= LIMIARES.MESMO) return 'mesmo';
  if (score >= LIMIARES.PROVAVEL) return 'provavel';
  if (score >= LIMIARES.SEMELHANTE) return 'semelhante';
  return 'novo';
}

/**
 * Status operacional para UI.
 * @param {Object} sinais
 * @param {Object|null} anterior
 * @param {number} score
 * @returns {{ status: string, rotulo: string }}
 */
function resolverStatus(sinais, anterior, score) {
  if (!anterior || score < LIMIARES.SEMELHANTE) {
    return { status: 'novo', rotulo: 'Novo equipamento' };
  }

  const ipMudou = Boolean(
    sinais.ip
    && anterior.ip_atual
    && sinais.ip !== anterior.ip_atual
  );
  const fwMudou = Boolean(
    sinais.firmware
    && anterior.firmware
    && normalizarTexto(sinais.firmware) !== normalizarTexto(anterior.firmware)
  );
  const portaMudou = Boolean(
    (sinais.porta != null && anterior.porta_atual != null && Number(sinais.porta) !== Number(anterior.porta_atual))
    || (sinais.porta_com && anterior.porta_com_atual && sinais.porta_com !== anterior.porta_com_atual)
  );

  if (ipMudou) {
    return { status: 'ip_alterado', rotulo: 'IP alterado' };
  }
  if (fwMudou) {
    return { status: 'firmware_alterado', rotulo: 'Firmware alterado' };
  }
  if (portaMudou && score >= LIMIARES.PROVAVEL) {
    return { status: 'porta_alterada', rotulo: 'Porta/endpoint alterado' };
  }
  if (score >= LIMIARES.PROVAVEL) {
    return { status: 'conhecido', rotulo: 'Equipamento conhecido' };
  }
  return { status: 'semelhante', rotulo: 'Equipamento semelhante' };
}

module.exports = {
  LIMIARES,
  extrairSinais,
  chaveIdentidade,
  pontuarCorrespondencia,
  classificarScore,
  resolverStatus,
  normalizarTexto,
  normalizarHex
};
