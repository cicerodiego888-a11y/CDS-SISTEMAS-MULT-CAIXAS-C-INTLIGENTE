/**
 * RC8.0.1 / RC4.1.0 — Nomenclatura oficial Comercial × Fiscal (V4 CONGELADA).
 * Não altera rotas, APIs nem enums de banco — apenas textos de UI.
 *
 * Comercial: Orçamento → Pedido → Separação → Expedição → Entrega → Concluído
 * Fiscal:    Venda (Núcleo) → Central de Faturamento → NF-e → Autorizado → DANFE
 *
 * Alias histórico: API /api/faturamento = UI Expedição (comercial).
 * Emissão NF-e canônica: Central de Faturamento (/api/central-faturamento).
 */
(function (global) {
  'use strict';

  const COMERCIAL = Object.freeze({
    expedicao: 'Expedição',
    expedir: 'Expedir',
    expedido: 'Expedido',
    expedidos: 'Expedidos',
    aguardandoExpedicao: 'Aguardando Expedição',
    vendasExpedidas: 'Vendas expedidas',
    centralVendasExpedidas: 'Central de Vendas Expedidas',
    enviarParaExpedicao: 'Enviar para Expedição',
    irParaExpedicao: 'Ir para Expedição',
    filaVazia: 'Nenhum pedido aguardando expedição.',
    modalExpedir: 'Expedir pedido',
    sucessoExpedido: 'Pedido expedido.',
    falhaExpedir: 'Falha ao expedir.',
    subtituloPagina: 'Pedido → Separação → Expedição · operação comercial',
    alertaSemNfe: 'Expedição comercial — a venda será concluída no Núcleo Transacional (sem documento fiscal).',
    receita: 'Receita'
  });

  const FISCAL = Object.freeze({
    faturamento: 'Faturamento',
    faturamentoFiscal: 'Faturamento fiscal',
    centralFaturamento: 'Central de Faturamento',
    painelOperacional: 'Painel Operacional Fiscal',
    emitirNfeAposExpedir: 'Após expedir, emita a NF-e na Central de Faturamento',
    documentoFiscal: 'Documento fiscal',
    comNfe: 'Com NF-e',
    semNfe: 'Sem NF-e',
    nfeEmitidas: 'NF-e Emitidas',
    nfeEmitidasHint: 'Consulta e eventos pós-emissão'
  });

  const ARQUITETURA_V4 = Object.freeze({
    versao: '4.0',
    status: 'CONGELADA',
    rc: 'RC4.1.0',
    fluxoCanonico: 'Pedido → Expedição → Núcleo → Central de Faturamento → NF-e → DANFE'
  });

  function nfeHabilitadoUi() {
    try {
      if (typeof global.obterRecursosImplantacao === 'function') {
        return global.obterRecursosImplantacao().nfe === true;
      }
      return !!(global.CONFIG_IMPLANTACAO && global.CONFIG_IMPLANTACAO.recursos
        && global.CONFIG_IMPLANTACAO.recursos.nfe);
    } catch (e) {
      return false;
    }
  }

  function fiscalHabilitadoUi() {
    if (typeof global.fiscalHabilitado === 'function') return global.fiscalHabilitado();
    if (typeof global.implantacaoPermiteFiscal === 'function') return global.implantacaoPermiteFiscal();
    return nfeHabilitadoUi();
  }

  /** Título da página/menu do módulo comercial (recurso licenciado: expedicao). */
  function tituloModuloExpedicao() {
    return COMERCIAL.expedicao;
  }

  /** Subtítulo: comercial puro; NF-e é responsabilidade da Central de Faturamento. */
  function subtituloModuloExpedicao() {
    if (nfeHabilitadoUi()) {
      return `${COMERCIAL.subtituloPagina} · NF-e na ${FISCAL.centralFaturamento}`;
    }
    return COMERCIAL.subtituloPagina;
  }

  global.CdsNomenclatura = {
    COMERCIAL,
    FISCAL,
    ARQUITETURA_V4,
    nfeHabilitadoUi,
    fiscalHabilitadoUi,
    tituloModuloExpedicao,
    subtituloModuloExpedicao
  };
})(typeof window !== 'undefined' ? window : globalThis);
