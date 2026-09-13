'use strict';

/**
 * Candidate DTO — contrato congelado RC0.1 + RC1 (capacidades, assinatura).
 * RC1.1 — validação estrita, normalização de capacidades, sanitização.
 */

const crypto = require('crypto');

const CHAVES_CAPACIDADES = Object.freeze([
  'discovery',
  'configuracao',
  'diagnostico',
  'sincronizacao',
  'monitoramento'
]);

const CAPACIDADES_PADRAO = Object.freeze({
  discovery: true,
  configuracao: true,
  diagnostico: true,
  sincronizacao: true,
  monitoramento: false
});

/**
 * Assinatura (fingerprint técnico auxiliar — NÃO é PK).
 *
 * Composição atual:
 *   driver_codigo | transporte | ip | porta | porta_com | modelo | firmware
 *
 * Comportamento (RC1.1):
 * - Mesmo equipamento (mesmos campos) → mesma assinatura (estável entre varreduras).
 * - Mudança só de IP → assinatura muda (detecta mudança de endpoint).
 * - Mudança só de porta → assinatura muda.
 * - Mudança de firmware/modelo → assinatura muda.
 * - Identidade estável cross-IP (ex.: MAC) fica para RC futura; assinatura atual
 *   prioriza deduplicação e detecção de endpoint.
 *
 * @param {Object} dados
 * @returns {string} hex 16 chars
 */
function calcularAssinatura(dados = {}) {
  const base = [
    dados.driver_codigo || '',
    dados.transporte || '',
    dados.ip || '',
    dados.porta != null ? String(dados.porta) : '',
    dados.porta_com || '',
    dados.caminho_dispositivo || '',
    dados.vid || '',
    dados.pid || '',
    dados.modelo || '',
    dados.firmware || ''
  ].join('|');
  return crypto.createHash('sha1').update(base).digest('hex').slice(0, 16);
}

/**
 * Garante objeto de capacidades com chaves booleanas padronizadas.
 * @param {Object} [parcial]
 * @returns {Object}
 */
function normalizarCapacidades(parcial = {}) {
  const out = { ...CAPACIDADES_PADRAO };
  for (const chave of CHAVES_CAPACIDADES) {
    if (parcial[chave] !== undefined) {
      out[chave] = Boolean(parcial[chave]);
    }
  }
  return Object.freeze(out);
}

/**
 * Valida Candidate conforme contrato. Retorna lista de erros (vazia = ok).
 * @param {Object} c
 * @returns {string[]}
 */
function validarCandidate(c) {
  const erros = [];
  if (!c || typeof c !== 'object') {
    return ['candidate_ausente'];
  }
  if (!c.transporte) erros.push('transporte_obrigatorio');
  if (c.driver_codigo == null || c.driver_codigo === '') erros.push('driver_codigo_obrigatorio');
  if (c.confianca == null || Number.isNaN(Number(c.confianca))) erros.push('confianca_obrigatoria');
  if (!c.origem) erros.push('origem_obrigatoria');
  if (!c.descoberto_em) erros.push('descoberto_em_obrigatorio');
  if (!c.assinatura) erros.push('assinatura_obrigatoria');
  if (!c.capacidades || typeof c.capacidades !== 'object') {
    erros.push('capacidades_obrigatorias');
  } else {
    for (const chave of CHAVES_CAPACIDADES) {
      if (typeof c.capacidades[chave] !== 'boolean') {
        erros.push(`capacidade_${chave}_invalida`);
      }
    }
  }
  if (c.transporte === 'ethernet') {
    if (!c.ip) erros.push('ip_obrigatorio_ethernet');
    if (c.porta == null || Number.isNaN(Number(c.porta))) erros.push('porta_obrigatoria_ethernet');
  }
  if (c.transporte === 'serial') {
    if (!c.porta_com) erros.push('porta_com_obrigatoria_serial');
  }
  if (c.transporte === 'usb') {
    if (!c.vid && !c.pid && !c.caminho_dispositivo) {
      erros.push('usb_identificador_obrigatorio');
    }
  }
  return erros;
}

/**
 * @param {Object} parcial
 * @returns {Object} Candidate congelado e válido
 */
function criarCandidate(parcial = {}) {
  const agora = new Date().toISOString();
  const confiancaRaw = Number(parcial.confianca != null ? parcial.confianca : 0);
  const confianca = Math.max(0, Math.min(1, Number.isFinite(confiancaRaw) ? confiancaRaw : 0));

  const candidate = {
    transporte: String(parcial.transporte || 'ethernet'),
    driver_codigo: parcial.driver_codigo != null ? String(parcial.driver_codigo) : null,
    confianca,
    origem: parcial.origem
      ? String(parcial.origem)
      : (String(parcial.transporte || 'ethernet') === 'serial'
        ? 'scan_serial'
        : (String(parcial.transporte || 'ethernet') === 'usb' ? 'scan_usb' : 'scan_ethernet')),
    descoberto_em: parcial.descoberto_em || agora,
    capacidades: normalizarCapacidades(parcial.capacidades || {})
  };

  if (candidate.transporte === 'ethernet') {
    if (parcial.ip != null) candidate.ip = String(parcial.ip).trim();
    if (parcial.porta != null) candidate.porta = Number(parcial.porta);
  }

  if (candidate.transporte === 'serial' || parcial.porta_com != null) {
    if (parcial.porta_com != null) candidate.porta_com = String(parcial.porta_com);
  }

  if (candidate.transporte === 'usb' || parcial.vid != null || parcial.pid != null || parcial.caminho_dispositivo != null) {
    if (parcial.caminho_dispositivo != null) {
      candidate.caminho_dispositivo = String(parcial.caminho_dispositivo);
    }
    if (parcial.vid != null) candidate.vid = String(parcial.vid).toUpperCase();
    if (parcial.pid != null) candidate.pid = String(parcial.pid).toUpperCase();
  }

  const opcionais = [
    'fabricante', 'modelo', 'protocolo', 'firmware', 'mac', 'hostname',
    'evidencias', 'observacoes', 'ja_cadastrado'
  ];
  for (const chave of opcionais) {
    if (parcial[chave] !== undefined) candidate[chave] = parcial[chave];
  }

  candidate.assinatura = parcial.assinatura || calcularAssinatura(candidate);

  const erros = validarCandidate(candidate);
  if (erros.length) {
    const err = new Error(`Candidate incompleto: ${erros.join(', ')}`);
    err.code = 'CANDIDATE_INVALIDO';
    err.erros = erros;
    throw err;
  }

  return Object.freeze(candidate);
}

/**
 * Tenta criar Candidate; se inválido retorna null (não interrompe varredura).
 * @param {Object} parcial
 * @returns {Object|null}
 */
function tentarCriarCandidate(parcial = {}) {
  try {
    return criarCandidate(parcial);
  } catch (_) {
    return null;
  }
}

/**
 * Filtra e revalida lista — nunca devolve Candidate incompleto.
 * @param {Object[]} lista
 * @returns {{ candidatos: Object[], rejeitados: number }}
 */
function sanitizarCandidatos(lista = []) {
  const candidatos = [];
  let rejeitados = 0;
  for (const item of lista || []) {
    if (!item) {
      rejeitados += 1;
      continue;
    }
    const erros = validarCandidate(item);
    if (erros.length) {
      const reparado = tentarCriarCandidate(item);
      if (reparado) candidatos.push(reparado);
      else rejeitados += 1;
      continue;
    }
    // Re-normaliza capacidades/assinatura via factory se vier cru
    if (!Object.isFrozen(item) || typeof item.capacidades?.discovery !== 'boolean') {
      const reparado = tentarCriarCandidate(item);
      if (reparado) candidatos.push(reparado);
      else rejeitados += 1;
    } else {
      candidatos.push(item);
    }
  }
  return { candidatos, rejeitados };
}

function criarDiscoveryResult({ sucesso = true, candidatos = [], erros = [], meta = {} } = {}) {
  const { candidatos: limpos, rejeitados } = sanitizarCandidatos(candidatos);
  const metaBase = {
    iniciado_em: meta.iniciado_em || null,
    finalizado_em: meta.finalizado_em || null,
    duracao_ms: Number(meta.duracao_ms || 0),
    probes_total: Number(meta.probes_total || 0),
    probes_ok: Number(meta.probes_ok || 0),
    transportes_executados: Array.isArray(meta.transportes_executados)
      ? meta.transportes_executados
      : []
  };
  for (const [k, v] of Object.entries(meta || {})) {
    if (!(k in metaBase) && v !== undefined) metaBase[k] = v;
  }
  if (rejeitados > 0) metaBase.candidatos_rejeitados = rejeitados;

  return Object.freeze({
    sucesso: Boolean(sucesso),
    candidatos: limpos,
    erros: Array.isArray(erros) ? erros : [],
    meta: Object.freeze(metaBase)
  });
}

module.exports = {
  CHAVES_CAPACIDADES,
  CAPACIDADES_PADRAO,
  calcularAssinatura,
  normalizarCapacidades,
  validarCandidate,
  criarCandidate,
  tentarCriarCandidate,
  sanitizarCandidatos,
  criarDiscoveryResult
};
