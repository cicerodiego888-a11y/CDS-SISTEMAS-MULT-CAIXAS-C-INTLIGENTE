/**
 * Sprint 08.5 — Política normativa de cancelamento extemporâneo NFC-e (modelo 65) no Ceará.
 *
 * RESULTADO DA AUDITORIA DOCUMENTAL:
 *   EXTEMPORANEO_NFCE_NAO_COMPROVADO
 *
 * NÃO compartilhar regras de NF-e modelo 55 (IN SEFAZ-CE 54/2020) com NFC-e 65
 * sem comprovação específica.
 *
 * NÃO implementar transmissão 110112 como escape genérico de prazo.
 */
'use strict';

const RESULTADO_PESQUISA = 'EXTEMPORANEO_NFCE_NAO_COMPROVADO';

/** Cancelamento operacional (não é status fiscal SEFAZ). */
const CANCELAMENTO_STATUS = Object.freeze({
  DENTRO_PRAZO_NORMAL: 'DENTRO_PRAZO_NORMAL',
  FORA_DO_PRAZO: 'FORA_DO_PRAZO',
  AGUARDANDO_PROCEDIMENTO: 'AGUARDANDO_PROCEDIMENTO',
  AUTORIZADO_ADMINISTRATIVO: 'AUTORIZADO_ADMINISTRATIVO',
  NAO_APLICAVEL: 'NAO_APLICAVEL'
});

/**
 * Fontes oficiais consultadas (Sprint 08.5).
 * Marcar aplicavel_nfce_65_ce = true SOMENTE com base específica.
 */
const FONTES_NORMATIVAS = Object.freeze([
  {
    id: 'decreto_ce_31922_2016_art21',
    titulo: 'Decreto Estadual CE nº 31.922/2016, Art. 21',
    escopo: 'NFC-e modelo 65 — cancelamento normal (máx. 30 minutos; sem circulação)',
    aplicavel_nfce_65_ce: true,
    tipo: 'cancelamento_normal',
    url: 'https://www.legisweb.com.br/legislacao/?id=318986'
  },
  {
    id: 'in_ce_27_2016_art33',
    titulo: 'Instrução Normativa SEFAZ-CE nº 27/2016, Art. 33',
    escopo: 'NFC-e modelo 65 — Registro do Evento de Cancelamento em até 30 minutos',
    aplicavel_nfce_65_ce: true,
    tipo: 'cancelamento_normal',
    url: 'https://www.normasbrasil.com.br/norma/instrucao-normativa-27-2016-ce_320010.html'
  },
  {
    id: 'ajuste_sinief_07_2018',
    titulo: 'Ajuste SINIEF 07/2018 (altera 19/2016) — cláusula 15ª',
    escopo: 'Prazo máximo nacional NFC-e: 30 minutos (UF pode reduzir)',
    aplicavel_nfce_65_ce: true,
    tipo: 'cancelamento_normal',
    url: 'https://blog.tecnospeed.com.br/prazo-de-cancelamento-da-nfc-e/'
  },
  {
    id: 'in_ce_54_2020',
    titulo: 'Instrução Normativa SEFAZ-CE nº 54/2020',
    escopo: 'Cancelamento extemporâneo de NF-e (modelo 55) e CT-e — NÃO menciona NFC-e 65',
    aplicavel_nfce_65_ce: false,
    tipo: 'extemporaneo_nfe_55',
    url: 'https://www.legisweb.com.br/legislacao/?id=400743',
    observacao: 'Não reutilizar para NFC-e modelo 65 sem norma específica.'
  },
  {
    id: 'nt_2018_004',
    titulo: 'Nota Técnica 2018.004 — Cancelamento por Substituição (tpEvento 110112)',
    escopo: 'NFC-e em duplicidade por contingência, com NFC-e substituta; prazo até 168h',
    aplicavel_nfce_65_ce: true,
    tipo: 'cancelamento_por_substituicao',
    url: 'http://svn.code.sf.net/p/acbr/code/tools/DFe/NFeNFCe/NT/2018/NFe_NT2018_004%20v1.00%20Cancelamento%20por%20Substituicao%20da%20NFC-e.pdf',
    observacao:
      'Finalidade restrita (duplicidade/contingência). NÃO é cancelamento extemporâneo genérico fora do prazo de 30 min.'
  }
]);

/**
 * Política vigente do CDS para NFC-e 65 no CE.
 * cancelamento_extemporaneo_comprovado = true SOMENTE com norma oficial específica.
 */
const POLITICA_NFCE_65_CE = Object.freeze({
  uf: 'CE',
  modelo: '65',
  resultado_pesquisa: RESULTADO_PESQUISA,
  prazo_normal_minutos: 30,
  cancelamento_normal_comprovado: true,
  cancelamento_extemporaneo_comprovado: false,
  cancelamento_extemporaneo_disponivel: false,
  procedimento_extemporaneo: null,
  necessita_autorizacao_sefaz: null,
  cancelamento_por_substituicao_110112: Object.freeze({
    existe_nacionalmente: true,
    finalidade: 'duplicidade_por_contingencia_com_nfce_substituta',
    aplicavel_como_escape_de_prazo: false,
    implementado_no_cds: false,
    motivo_nao_implementar:
      '110112 exige NFC-e substituta em cenário de contingência; não serve para anular NFC-e de teste/fora do prazo sem substituta.'
  }),
  mensagem_sem_procedimento:
    'Não foi identificado procedimento de cancelamento extemporâneo aplicável a esta NFC-e no ambiente configurado.',
  mensagem_com_procedimento:
    'Existe procedimento de cancelamento extemporâneo.',
  fontes: FONTES_NORMATIVAS
});

/**
 * Política hipotética de NF-e 55 (somente para impedir vazamento automático para 65).
 * NÃO usar em fluxos de NFC-e.
 */
const POLITICA_NFE_55_CE = Object.freeze({
  uf: 'CE',
  modelo: '55',
  cancelamento_extemporaneo_comprovado: true,
  base: 'IN SEFAZ-CE 54/2020 (NF-e / CT-e)',
  prazo_extemporaneo_horas: 720,
  observacao: 'Regra exclusiva de NF-e modelo 55. Proibido aplicar automaticamente à NFC-e 65.'
});

function normalizarModelo(modelo) {
  const m = String(modelo == null ? '65' : modelo).replace(/\D/g, '');
  return m === '55' ? '55' : '65';
}

/**
 * Impede aplicação automática de regra extemporânea de NF-e 55 à NFC-e 65.
 */
function obterPoliticaCancelamentoPorModelo(modelo, override) {
  const mod = normalizarModelo(modelo);
  if (override && typeof override === 'object') {
    return Object.assign({}, mod === '55' ? POLITICA_NFE_55_CE : POLITICA_NFCE_65_CE, override, {
      modelo: mod
    });
  }
  return mod === '55' ? POLITICA_NFE_55_CE : POLITICA_NFCE_65_CE;
}

/**
 * Avalia disponibilidade de extemporâneo para o documento.
 * @param {object} opts
 * @param {string|number} [opts.modelo=65]
 * @param {boolean} [opts.dentroPrazoNormal]
 * @param {object} [opts.politicaOverride] — somente testes / futuro deferimento oficial
 * @param {boolean} [opts.autorizacaoAdministrativaComprovada] — futuro
 */
function avaliarCancelamentoExtemporaneo(opts) {
  opts = opts || {};
  const politica = obterPoliticaCancelamentoPorModelo(opts.modelo, opts.politicaOverride);
  const modelo = normalizarModelo(politica.modelo || opts.modelo);
  const dentro = opts.dentroPrazoNormal === true;

  // NF-e 55: política distinta — NÃO misturar no fluxo NFC-e
  if (modelo === '55') {
    return {
      modelo: '55',
      status_fiscal_sugerido: null,
      cancelamento_status: dentro
        ? CANCELAMENTO_STATUS.DENTRO_PRAZO_NORMAL
        : CANCELAMENTO_STATUS.FORA_DO_PRAZO,
      cancelamento_extemporaneo_disponivel: Boolean(politica.cancelamento_extemporaneo_comprovado),
      cancelamento_extemporaneo_comprovado: Boolean(politica.cancelamento_extemporaneo_comprovado),
      procedimento_extemporaneo: politica.base || null,
      necessita_autorizacao_sefaz: true,
      pode_transmitir_110111: dentro,
      pode_transmitir_extemporaneo: !dentro && Boolean(politica.cancelamento_extemporaneo_comprovado),
      motivo_bloqueio: dentro
        ? null
        : 'Regra de NF-e 55 não se aplica ao fluxo de NFC-e 65 deste serviço.',
      resultado_pesquisa: 'NFE_55_SEPARADO',
      mensagem_ui: politica.observacao
    };
  }

  const comprovado = politica.cancelamento_extemporaneo_comprovado === true;
  const disponivel = comprovado && politica.cancelamento_extemporaneo_disponivel === true;
  const authAdm = opts.autorizacaoAdministrativaComprovada === true && disponivel;

  let cancelamentoStatus = CANCELAMENTO_STATUS.NAO_APLICAVEL;
  if (dentro) {
    cancelamentoStatus = CANCELAMENTO_STATUS.DENTRO_PRAZO_NORMAL;
  } else if (authAdm) {
    cancelamentoStatus = CANCELAMENTO_STATUS.AUTORIZADO_ADMINISTRATIVO;
  } else if (disponivel) {
    cancelamentoStatus = CANCELAMENTO_STATUS.AGUARDANDO_PROCEDIMENTO;
  } else {
    cancelamentoStatus = CANCELAMENTO_STATUS.FORA_DO_PRAZO;
  }

  const pode110111 = dentro === true;
  let motivoBloqueio = null;
  if (!pode110111) {
    if (!comprovado) {
      motivoBloqueio = RESULTADO_PESQUISA + ': ' + POLITICA_NFCE_65_CE.mensagem_sem_procedimento;
    } else if (!authAdm) {
      motivoBloqueio = 'Cancelamento fora do prazo normal. Aguardando procedimento/autorização administrativa.';
    } else {
      motivoBloqueio = 'Autorização administrativa presente; transmissão do evento específico ainda não liberada neste sprint.';
    }
  }

  return {
    modelo: '65',
    resultado_pesquisa: politica.resultado_pesquisa || RESULTADO_PESQUISA,
    cancelamento_status: cancelamentoStatus,
    cancelamento_extemporaneo_disponivel: disponivel,
    cancelamento_extemporaneo_comprovado: comprovado,
    procedimento_extemporaneo: disponivel ? (politica.procedimento_extemporaneo || 'procedimento_oficial_pendente_implementacao') : null,
    necessita_autorizacao_sefaz: disponivel ? true : null,
    pode_transmitir_110111: pode110111,
    pode_transmitir_extemporaneo: false, // Sprint 08.5: nunca transmitir sem PO
    motivo_bloqueio: motivoBloqueio,
    mensagem_ui: disponivel
      ? POLITICA_NFCE_65_CE.mensagem_com_procedimento
      : (!dentro ? POLITICA_NFCE_65_CE.mensagem_sem_procedimento : null),
    substituicao_110112: POLITICA_NFCE_65_CE.cancelamento_por_substituicao_110112,
    fontes_aplicaveis: FONTES_NORMATIVAS.filter((f) => f.aplicavel_nfce_65_ce && f.tipo === 'cancelamento_normal')
  };
}

module.exports = {
  RESULTADO_PESQUISA,
  CANCELAMENTO_STATUS,
  FONTES_NORMATIVAS,
  POLITICA_NFCE_65_CE,
  POLITICA_NFE_55_CE,
  normalizarModelo,
  obterPoliticaCancelamentoPorModelo,
  avaliarCancelamentoExtemporaneo
};
