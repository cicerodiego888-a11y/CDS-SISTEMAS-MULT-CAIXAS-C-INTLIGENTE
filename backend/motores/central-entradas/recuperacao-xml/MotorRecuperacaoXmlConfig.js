/**
 * Configuração do Motor de Recuperação Automática de XML (RC3.7.5 + Sprint 2).
 *
 * @module motores/central-entradas/recuperacao-xml/MotorRecuperacaoXmlConfig
 */

'use strict';

const CHAVES = Object.freeze({
  ATIVA: 'recuperacao_xml_ativa',
  INTERVALO_MIN: 'recuperacao_xml_intervalo_minutos',
  MAX_TENTATIVAS: 'recuperacao_xml_max_tentativas',
  MAX_DIAS: 'recuperacao_xml_max_dias_monitoramento',
  LOTE: 'recuperacao_xml_lote_por_ciclo',
  JANELA_DIAS: 'recuperacao_xml_janela_dias',
  ESTADO: 'recuperacao_xml_scheduler_state'
});

const INTERVALOS_PERMITIDOS = Object.freeze([30, 60, 120, 360, 1440]);

const DEFAULTS = Object.freeze({
  ativa: true,
  intervaloMinutos: 60,
  maxTentativas: 48,
  maxDiasMonitoramento: 30,
  lotePorCiclo: 5,
  janelaRecuperacaoDias: 90
});

/**
 * @param {Object} mapa — valores tipados do repositório KV
 * @returns {Object}
 */
function lerConfigDeMapa(mapa = {}) {
  const intervaloRaw = Number(mapa[CHAVES.INTERVALO_MIN]);
  let intervaloMinutos = Number.isFinite(intervaloRaw) && intervaloRaw > 0
    ? intervaloRaw
    : DEFAULTS.intervaloMinutos;
  if (!INTERVALOS_PERMITIDOS.includes(intervaloMinutos)) {
    const maisProximo = INTERVALOS_PERMITIDOS.reduce((best, n) => (
      Math.abs(n - intervaloMinutos) < Math.abs(best - intervaloMinutos) ? n : best
    ), INTERVALOS_PERMITIDOS[1]);
    intervaloMinutos = maisProximo;
  }

  const maxTentativas = Math.max(1, Number(mapa[CHAVES.MAX_TENTATIVAS]) || DEFAULTS.maxTentativas);
  const maxDias = Math.max(1, Number(mapa[CHAVES.MAX_DIAS]) || DEFAULTS.maxDiasMonitoramento);
  const lote = Math.min(20, Math.max(1, Number(mapa[CHAVES.LOTE]) || DEFAULTS.lotePorCiclo));
  const janelaRecuperacaoDias = Math.max(
    1,
    Number(mapa[CHAVES.JANELA_DIAS]) || DEFAULTS.janelaRecuperacaoDias
  );
  const ativa = mapa[CHAVES.ATIVA] !== false && mapa[CHAVES.ATIVA] !== 'false';

  return {
    ativa,
    intervaloMinutos,
    maxTentativas,
    maxDiasMonitoramento: maxDias,
    lotePorCiclo: lote,
    janelaRecuperacaoDias
  };
}

/**
 * Seed INSERT OR IGNORE para central_entradas_config.
 * @returns {ReadonlyArray<[string, string, string, string]>}
 */
function defaultsKv() {
  return Object.freeze([
    [CHAVES.ATIVA, 'true', 'boolean', 'RC3.7.5 — Recuperação automática de XML (procNFe)'],
    [CHAVES.INTERVALO_MIN, String(DEFAULTS.intervaloMinutos), 'number', 'Intervalo do scheduler (min): 30|60|120|360|1440'],
    [CHAVES.MAX_TENTATIVAS, String(DEFAULTS.maxTentativas), 'number', 'Máximo de tentativas consChNFe por documento'],
    [CHAVES.MAX_DIAS, String(DEFAULTS.maxDiasMonitoramento), 'number', 'Dias máximos em monitoramento'],
    [CHAVES.LOTE, String(DEFAULTS.lotePorCiclo), 'number', 'Documentos consultados por ciclo'],
    [CHAVES.JANELA_DIAS, String(DEFAULTS.janelaRecuperacaoDias), 'number', 'Sprint 2 — Janela DistDFe (dias) para recuperação']
  ]);
}

module.exports = {
  CHAVES,
  INTERVALOS_PERMITIDOS,
  DEFAULTS,
  lerConfigDeMapa,
  defaultsKv
};
