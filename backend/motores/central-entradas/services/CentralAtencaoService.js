/**
 * CentralAtencaoService — Painel "O que requer sua atenção".
 *
 * @class CentralAtencaoService
 */

const CentralAlertasService = require('./CentralAlertasService');
const CentralPendenciasService = require('./CentralPendenciasService');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');

class CentralAtencaoService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    const documentosRepository = deps.documentosRepository
      ?? new (require('../repositories/CentralDocumentosRepository'))();
    const nsuRepository = deps.nsuRepository
      ?? new (require('../repositories/CentralNsuRepository'))();

    /** @private */
    this._alertasService = deps.alertasService
      ?? new CentralAlertasService({ documentosRepository, nsuRepository });
    /** @private */
    this._pendenciasService = deps.pendenciasService
      ?? new CentralPendenciasService({ documentosRepository, nsuRepository });
  }

  /**
   * @param {Object} [opcoes]
   * @param {Object} [opcoes.alertasResultado]
   * @param {Object} [opcoes.pendenciasResultado]
   * @returns {Promise<{ total: number, itens: Object[] }>}
   */
  async obterItensAtencao(opcoes = {}) {
    const alertas = opcoes.alertasResultado
      ?? await this._alertasService.listarAlertas();
    const pendencias = opcoes.pendenciasResultado
      ?? await this._pendenciasService.obterPendencias({
        limite: opcoes.limitePendencias ?? 5,
        alertasResultado: alertas
      });

    const itens = [];

    const revisao = pendencias.secoes?.aguardandoRevisao || [];
    if (revisao.length) {
      itens.push({
        id: 'revisao',
        icone: 'fa-user-check',
        cor: '#fd7e14',
        mensagem: revisao.length === 1
          ? 'Existe 1 documento aguardando revisão.'
          : `Existem ${revisao.length} documentos aguardando revisão.`,
        quantidade: revisao.length,
        acao: { tipo: 'filtrar_status', status: DocumentoFiscalStatus.AGUARDANDO_REVISAO, label: 'Ver revisões' }
      });
    }

    const compras = pendencias.secoes?.comprasAbertas || [];
    if (compras.length) {
      itens.push({
        id: 'compra_aberta',
        icone: 'fa-shopping-cart',
        cor: '#6610f2',
        mensagem: compras.length === 1
          ? 'Existe 1 compra aberta.'
          : `Existem ${compras.length} compras abertas.`,
        quantidade: compras.length,
        acao: {
          tipo: 'filtrar_status',
          status: DocumentoFiscalStatus.EM_COMPRA,
          label: 'Ver compras abertas'
        }
      });
    }

    const fornecedorNovo = (alertas.alertas || []).find((a) => a.tipo === 'FORNECEDOR_NOVO');
    if (fornecedorNovo?.quantidade) {
      itens.push({
        id: 'fornecedor_novo',
        icone: 'fa-user-plus',
        cor: '#0dcaf0',
        mensagem: fornecedorNovo.quantidade === 1
          ? 'Existe fornecedor novo na Central.'
          : `Existem ${fornecedorNovo.quantidade} fornecedores novos.`,
        quantidade: fornecedorNovo.quantidade,
        acao: {
          tipo: 'abrir_alerta',
          alertaTipo: 'FORNECEDOR_NOVO',
          documentoId: fornecedorNovo.documentoIds?.[0] || null,
          label: 'Ver fornecedor'
        }
      });
    }

    const erros = pendencias.secoes?.erros || [];
    if (erros.length) {
      itens.push({
        id: 'erros',
        icone: 'fa-exclamation-triangle',
        cor: '#dc3545',
        mensagem: erros.length === 1
          ? 'Existe 1 documento com erro.'
          : `Existem ${erros.length} documentos com erro.`,
        quantidade: erros.length,
        acao: { tipo: 'filtrar_status', status: DocumentoFiscalStatus.ERRO, label: 'Ver erros' }
      });
    }

    const sync = (alertas.alertas || []).find((a) => a.tipo === 'FALHA_SINCRONIZACAO');
    if (sync) {
      itens.push({
        id: 'sync',
        icone: 'fa-satellite-dish',
        cor: '#f59e0b',
        mensagem: sync.descricao,
        quantidade: 1,
        acao: { tipo: 'sincronizar', label: 'Sincronizar SEFAZ' }
      });
    }

    const naoProcessadas = (alertas.alertas || []).find((a) => a.tipo === 'SINCRONIZADA_NAO_PROCESSADA');
    if (naoProcessadas?.quantidade) {
      itens.push({
        id: 'nao_processadas',
        icone: 'fa-play-circle',
        cor: '#0d6efd',
        mensagem: naoProcessadas.quantidade === 1
          ? 'Existe 1 nota sincronizada não processada.'
          : `Existem ${naoProcessadas.quantidade} notas sincronizadas não processadas.`,
        quantidade: naoProcessadas.quantidade,
        acao: {
          tipo: 'filtrar_status',
          status: DocumentoFiscalStatus.SINCRONIZADA,
          label: 'Ver novas'
        }
      });
    }

    return {
      total: itens.length,
      itens
    };
  }
}

module.exports = CentralAtencaoService;
