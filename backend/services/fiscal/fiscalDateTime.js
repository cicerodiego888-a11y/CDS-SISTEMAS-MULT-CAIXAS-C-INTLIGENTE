/**
 * Sprint 08.4 — Data/hora fiscal do estabelecimento + prazo de cancelamento NFC-e (CE: 30 min).
 * Reutiliza o padrão de nowDhEmi (offset -03:00), sem toISOString() no XML.
 */
'use strict';

const PRAZO_CANCELAMENTO_NFCE_MINUTOS = 30;
/** Tolerância técnica de sincronização de relógio (segundos). Não amplia a janela legal. */
const TOLERANCIA_SYNC_SEGUNDOS = 10;
const OFFSET_FISCAL_PADRAO = '-03:00';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Horário local do processo com offset fiscal explícito (-03:00).
 * NÃO usa Date.toISOString() (UTC sem offset local).
 */
function obterDataHoraFiscalEstabelecimento(date = new Date(), offset = OFFSET_FISCAL_PADRAO) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error('Data inválida para horário fiscal.');
  }
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}${offset}`
  );
}

/** Alias oficial — mesmo contrato de nowDhEmi. */
function nowDhEmiFiscal(date) {
  return obterDataHoraFiscalEstabelecimento(date);
}

function parseDataHoraFiscal(texto) {
  if (!texto) return null;
  const raw = String(texto).trim();
  // SQLite local: "2026-09-13 18:36:23" → interpreta como horário local
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const withOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}${OFFSET_FISCAL_PADRAO}`;
  const d = new Date(withOffset);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function extrairTagXml(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'));
  return m ? m[1] : null;
}

/**
 * Fonte de autorização (ordem oficial):
 * 1) dhRecbto no XML de retorno SEFAZ
 * 2) dhEmi no XML enviado
 * 3) created_at da nota (fallback)
 */
function extrairDhAutorizacaoNota(nota) {
  const dhRecbto = extrairTagXml(nota && nota.xml_retorno, 'dhRecbto');
  if (dhRecbto) {
    return { fonte: 'dhRecbto', valor: dhRecbto, date: parseDataHoraFiscal(dhRecbto) };
  }
  const dhEmi = extrairTagXml(nota && nota.xml_enviado, 'dhEmi');
  if (dhEmi) {
    return { fonte: 'dhEmi', valor: dhEmi, date: parseDataHoraFiscal(dhEmi) };
  }
  if (nota && nota.created_at) {
    return {
      fonte: 'created_at',
      valor: String(nota.created_at),
      date: parseDataHoraFiscal(nota.created_at)
    };
  }
  return { fonte: null, valor: null, date: null };
}

function extrairUltimoCancelamento(nota) {
  const xr = String((nota && nota.xml_retorno) || '');
  const cStats = [...xr.matchAll(/<cStat>(\d+)<\/cStat>/gi)].map((m) => m[1]);
  const xMots = [...xr.matchAll(/<xMotivo>([^<]*)<\/xMotivo>/gi)].map((m) => m[1]);
  const dhRegs = [...xr.matchAll(/<dhRegEvento>([^<]+)<\/dhRegEvento>/gi)].map((m) => m[1]);
  let ultimo501 = null;
  for (let i = cStats.length - 1; i >= 0; i -= 1) {
    if (cStats[i] === '501') {
      ultimo501 = {
        cStat: '501',
        xMotivo: xMots[i] || null,
        dhRegEvento: dhRegs.length ? dhRegs[dhRegs.length - 1] : null
      };
      break;
    }
  }
  const ultimoOk = ['135', '136', '155'].find((c) => cStats.includes(c));
  return {
    ultimo_cStat_evento: cStats.length ? cStats[cStats.length - 1] : null,
    ultimo_xMotivo: xMots.length ? xMots[xMots.length - 1] : null,
    dhRegEvento: dhRegs.length ? dhRegs[dhRegs.length - 1] : null,
    rejeicao_501: ultimo501,
    teve_cancelamento_autorizado: Boolean(ultimoOk)
  };
}

/**
 * Calcula se a NFC-e está dentro da janela de 30 minutos (CE).
 * SEFAZ permanece a autoridade final.
 */
function calcularPrazoCancelamentoNfce(nota, agora = new Date()) {
  const now = agora instanceof Date ? agora : new Date(agora);
  const auth = extrairDhAutorizacaoNota(nota);
  const dhEventoEstimado = obterDataHoraFiscalEstabelecimento(now);

  if (!auth.date) {
    return {
      ok: false,
      codigo: 'SEM_DH_AUTORIZACAO',
      dentro_prazo: false,
      prazo_minutos: PRAZO_CANCELAMENTO_NFCE_MINUTOS,
      tolerancia_segundos: TOLERANCIA_SYNC_SEGUNDOS,
      dh_autorizacao: auth.valor,
      dh_autorizacao_fonte: auth.fonte,
      dh_atual_servidor: dhEventoEstimado,
      dh_evento_estimado: dhEventoEstimado,
      timezone: OFFSET_FISCAL_PADRAO,
      segundos_decorridos: null,
      minutos_decorridos: null,
      mensagem: 'Não foi possível determinar a data/hora de autorização da NFC-e.'
    };
  }

  const segundos = Math.floor((now.getTime() - auth.date.getTime()) / 1000);
  const limite = PRAZO_CANCELAMENTO_NFCE_MINUTOS * 60 + TOLERANCIA_SYNC_SEGUNDOS;
  const dentro = segundos <= limite;
  const minutos = Number((segundos / 60).toFixed(2));

  return {
    ok: true,
    codigo: dentro ? 'DENTRO_PRAZO' : 'CANCELAMENTO_FORA_DO_PRAZO',
    dentro_prazo: dentro,
    prazo_minutos: PRAZO_CANCELAMENTO_NFCE_MINUTOS,
    tolerancia_segundos: TOLERANCIA_SYNC_SEGUNDOS,
    dh_autorizacao: auth.valor,
    dh_autorizacao_fonte: auth.fonte,
    dh_atual_servidor: dhEventoEstimado,
    dh_evento_estimado: dhEventoEstimado,
    timezone: OFFSET_FISCAL_PADRAO,
    segundos_decorridos: segundos,
    minutos_decorridos: minutos,
    mensagem: dentro
      ? 'Esta NFC-e está dentro do prazo normal de cancelamento.'
      : 'A NFC-e está fora do prazo normal de cancelamento para este estabelecimento.'
  };
}

function extrairModeloNota(nota) {
  const chave = String((nota && nota.chave_acesso) || '');
  if (chave.length >= 22) {
    const mod = chave.substring(20, 22);
    if (mod === '55' || mod === '65') return mod;
  }
  const fromXml = extrairTagXml(nota && nota.xml_enviado, 'mod');
  if (fromXml === '55' || fromXml === '65') return fromXml;
  return '65';
}

/**
 * Diagnóstico completo de cancelamento (Sprint 08.4 + 08.5).
 * status_fiscal = status SEFAZ/persistido; cancelamento_status = operacional.
 */
function montarDiagnosticoCancelamento(nota, agora = new Date(), opts) {
  opts = opts || {};
  const {
    avaliarCancelamentoExtemporaneo,
    CANCELAMENTO_STATUS
  } = require('./cancelamentoExtemporaneoNfceCe');

  const prazo = calcularPrazoCancelamentoNfce(nota, agora);
  const ultimo = extrairUltimoCancelamento(nota);
  const modelo = extrairModeloNota(nota);
  const ext = avaliarCancelamentoExtemporaneo({
    modelo,
    dentroPrazoNormal: prazo.dentro_prazo === true,
    politicaOverride: opts.politicaOverride,
    autorizacaoAdministrativaComprovada: opts.autorizacaoAdministrativaComprovada === true
  });

  const statusFiscal = String((nota && nota.status) || '').toLowerCase() || null;
  let cancelamentoStatus = ext.cancelamento_status;
  if (statusFiscal === 'cancelada') {
    cancelamentoStatus = CANCELAMENTO_STATUS.NAO_APLICAVEL;
  }

  return {
    nfce_id: nota && nota.id,
    origem: nota && nota.origem,
    modelo,
    serie: nota && nota.serie,
    numero: nota && nota.numero,
    chave: nota && nota.chave_acesso,
    ambiente: nota && nota.ambiente,
    status: statusFiscal,
    status_fiscal: statusFiscal,
    cancelamento_status: cancelamentoStatus,
    fechamento_fiscal_id: nota && nota.fechamento_fiscal_id,
    venda_id: nota && nota.venda_id != null ? nota.venda_id : null,
    dh_autorizacao: prazo.dh_autorizacao,
    dh_atual: prazo.dh_atual_servidor,
    dh_atual_servidor: prazo.dh_atual_servidor,
    dh_evento_estimado: prazo.dh_evento_estimado,
    timezone: prazo.timezone,
    prazo_normal_minutos: prazo.prazo_minutos,
    prazo_minutos: prazo.prazo_minutos,
    tempo_decorrido_segundos: prazo.segundos_decorridos,
    segundos_decorridos: prazo.segundos_decorridos,
    minutos_decorridos: prazo.minutos_decorridos,
    dentro_prazo_normal: prazo.dentro_prazo,
    dentro_prazo: prazo.dentro_prazo,
    codigo: prazo.codigo,
    ok: prazo.ok,
    mensagem: prazo.mensagem,
    tolerancia_segundos: prazo.tolerancia_segundos,
    dh_autorizacao_fonte: prazo.dh_autorizacao_fonte,
    cancelamento_extemporaneo_disponivel: ext.cancelamento_extemporaneo_disponivel,
    cancelamento_extemporaneo_comprovado: ext.cancelamento_extemporaneo_comprovado,
    procedimento_extemporaneo: ext.procedimento_extemporaneo,
    necessita_autorizacao_sefaz: ext.necessita_autorizacao_sefaz,
    pode_transmitir_110111: statusFiscal === 'cancelada' ? false : ext.pode_transmitir_110111,
    motivo_bloqueio: statusFiscal === 'cancelada'
      ? 'NFC-e já cancelada.'
      : (ext.pode_transmitir_110111 ? null : ext.motivo_bloqueio),
    resultado_pesquisa_extemporaneo: ext.resultado_pesquisa,
    mensagem_extemporaneo_ui: ext.mensagem_ui,
    substituicao_110112: ext.substituicao_110112,
    ultimo_cancelamento: ultimo,
    cStat: ultimo.ultimo_cStat_evento,
    xMotivo: ultimo.ultimo_xMotivo
  };
}

function logPrazoCancelamento(diag, extra = {}) {
  const payload = {
    nfce_id: diag.nfce_id,
    chave: diag.chave,
    autorizacao: diag.dh_autorizacao,
    tentativa: diag.dh_atual_servidor,
    dhEvento: diag.dh_evento_estimado,
    timezone: diag.timezone,
    segundos_decorridos: diag.segundos_decorridos,
    minutos_decorridos: diag.minutos_decorridos,
    prazo_maximo_minutos: diag.prazo_minutos,
    dentro_prazo: diag.dentro_prazo,
    cStat: extra.cStat || diag.cStat || null,
    xMotivo: extra.xMotivo || diag.xMotivo || null,
    tipo_evento: '110111',
    origem: diag.origem || null
  };
  console.log('[FiscalCancelamento:Prazo]', JSON.stringify(payload));
}

module.exports = {
  PRAZO_CANCELAMENTO_NFCE_MINUTOS,
  TOLERANCIA_SYNC_SEGUNDOS,
  OFFSET_FISCAL_PADRAO,
  obterDataHoraFiscalEstabelecimento,
  nowDhEmiFiscal,
  parseDataHoraFiscal,
  extrairDhAutorizacaoNota,
  extrairUltimoCancelamento,
  extrairModeloNota,
  calcularPrazoCancelamentoNfce,
  montarDiagnosticoCancelamento,
  logPrazoCancelamento
};
