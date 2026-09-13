/**
 * MPFC — Motor de Política Fiscal Comercial (RC8.1 / RC8.2 / RC8.2.2)
 *
 * Stateless. Responsabilidade única: obterPolitica() + resolução de snapshot.
 * Não calcula, não grava banco, não distribui pagamentos, não gera XML.
 *
 * Fluxo oficial: configuracaoService → MPFC → PoliticaFiscalComercialV1 → motores
 * Pós-venda: mpfc_politica_snapshot → resolverPoliticaOperacionalDaVenda (nunca config atual)
 */
'use strict';

const configService = require('../configuracaoService');
const {
  VERSAO_CONTRATO,
  MODOS,
  CODIGOS_POLITICA,
  DEFAULTS_V1,
  criarPoliticaFiscalComercialV1,
  serializarSnapshotPolitica
} = require('./PoliticaFiscalComercialV1');
const {
  criarPoliticaFiscalComercialSnapshot,
  snapshotParaJson
} = require('./PoliticaFiscalComercialSnapshot');
const {
  receberPoliticaMotorComercial,
  receberPoliticaMotorFiscalNaoFiscal
} = require('./interfacesConsumidores');
const {
  validarMargemMinimaComercial: validarMargemCore,
  precoMinimoPelaMargem
} = require('./ValidadorMargemComercial');
const {
  logPoliticaCarregada,
  logSnapshotGravado,
  logValidacaoMargem,
  VERSAO_MOTOR
} = require('./auditoriaLogs');
const {
  resolverPoliticaOperacionalDaVenda,
  politicaFromSnapshot,
  parseSnapshotRaw
} = require('./resolverPoliticaVenda');

const MOTOR = 'MPFC';

function clampPercentual(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

/**
 * Mapeia configuração da empresa → PoliticaFiscalComercialV1.
 * Único ponto de leitura das chaves de política (ativar_midp / mpfc_*).
 */
function obterPolitica(opcoes = {}) {
  const emitirLog = opcoes.emitirLog !== false;

  const cfg = opcoes.config != null
    ? opcoes.config
    : (typeof configService.readConfig === 'function'
      ? configService.readConfig()
      : {});

  const ativarMidp = typeof configService.isMidpAtivado === 'function'
    ? Boolean(configService.isMidpAtivado(cfg))
    : Boolean(cfg.ativar_midp);

  const modoRaw = String(cfg.mpfc_modo || cfg.mpfcModo || MODOS.FIXA).toUpperCase();
  const modo = modoRaw === MODOS.FLEXIVEL ? MODOS.FLEXIVEL : MODOS.FIXA;

  const percentual = clampPercentual(
    cfg.mpfc_percentual_dinheiro_fiscal != null
      ? cfg.mpfc_percentual_dinheiro_fiscal
      : (cfg.mpfcPercentualDinheiroFiscal != null
        ? cfg.mpfcPercentualDinheiroFiscal
        : DEFAULTS_V1.percentualDinheiroFiscal)
  );

  const margem = Number(
    cfg.mpfc_margem_minima_sobre_custo != null
      ? cfg.mpfc_margem_minima_sobre_custo
      : (cfg.mpfcMargemMinimaSobreOCusto != null
        ? cfg.mpfcMargemMinimaSobreOCusto
        : DEFAULTS_V1.margemMinimaSobreOCusto)
  );

  const nuncaVender = cfg.mpfc_nunca_vender_abaixo_margem != null
    ? Boolean(cfg.mpfc_nunca_vender_abaixo_margem)
    : (cfg.mpfcNuncaVenderAbaixoDaMargem != null
      ? Boolean(cfg.mpfcNuncaVenderAbaixoDaMargem)
      : DEFAULTS_V1.nuncaVenderAbaixoDaMargem);

  const preservarDinheiro = modo === MODOS.FIXA ? ativarMidp : false;

  const politica = criarPoliticaFiscalComercialV1({
    versao: DEFAULTS_V1.versao,
    modo,
    percentualDinheiroFiscal: modo === MODOS.FLEXIVEL ? percentual : 0,
    margemMinimaSobreOCusto: Number.isFinite(margem) ? margem : DEFAULTS_V1.margemMinimaSobreOCusto,
    nuncaVenderAbaixoDaMargem: nuncaVender,
    preservarDinheiro
  });

  if (emitirLog) {
    logPoliticaCarregada(politica);
  }

  return politica;
}

function prepararSnapshot(politica, meta = {}) {
  const pol = politica || obterPolitica({ emitirLog: false });
  return criarPoliticaFiscalComercialSnapshot(pol, {
    ...meta,
    fonte: meta.fonte || 'mpfc'
  });
}

/**
 * Emite log oficial de snapshot gravado (chamado pelo núcleo ao persistir a venda).
 */
function registrarSnapshotGravado(politica, meta = {}) {
  return logSnapshotGravado(politica, meta);
}

/**
 * Validação comercial com log oficial (não altera regra).
 */
function validarMargemMinimaComercial(itens, produtosPorId, politica) {
  const resultado = validarMargemCore(itens, produtosPorId, politica);
  logValidacaoMargem(resultado, {
    margemMinimaSobreOCusto: politica && politica.margemMinimaSobreOCusto,
    nuncaVenderAbaixoDaMargem: politica && politica.nuncaVenderAbaixoDaMargem
  });
  return resultado;
}

module.exports = {
  MOTOR,
  VERSAO_MOTOR,
  VERSAO_CONTRATO,
  MODOS,
  CODIGOS_POLITICA,
  DEFAULTS_V1,
  obterPolitica,
  prepararSnapshot,
  registrarSnapshotGravado,
  emitirLogPoliticaCarregada: logPoliticaCarregada,
  criarPoliticaFiscalComercialV1,
  criarPoliticaFiscalComercialSnapshot,
  serializarSnapshotPolitica,
  snapshotParaJson,
  receberPoliticaMotorComercial,
  receberPoliticaMotorFiscalNaoFiscal,
  validarMargemMinimaComercial,
  precoMinimoPelaMargem,
  resolverPoliticaOperacionalDaVenda,
  politicaFromSnapshot,
  parseSnapshotRaw
};
