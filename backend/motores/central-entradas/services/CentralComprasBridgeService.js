/**
 * CentralComprasBridgeService — Ponte entre Central de Entradas e Compras.
 *
 * RC1: transições via DocumentoTransitionService; reutiliza parse/MIIP persistido.
 *
 * @class CentralComprasBridgeService
 */

const {
  DocumentoFiscalStatus,
  normalizarStatus
} = require('../core/DocumentoFiscalStatus');
const { validarTransicao } = require('../core/MaquinaEstadosDocumento');
const { paraDocumentoDetalheDTO } = require('../utils/centralEntradasMapper');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const DocumentoTransitionService = require('./DocumentoTransitionService');
const { financeiroPayloadCompleto } = require('./centralComprasFinanceiroBridge');

class CentralComprasBridgeService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository();
    /** @private */
    this._transitionService = deps.transitionService
      ?? new DocumentoTransitionService({
        documentosRepository: this._documentosRepository,
        historicoRepository: deps.historicoRepository
      });
    /** @private */
    this._revisaoPersistenteService = deps.revisaoPersistenteService
      ?? deps.revisaoService
      ?? null;
    /** @private @type {Map<string, Promise>} */
    this._finalizarEntradaEmAndamento = new Map();
  }

  /**
   * @private
   * @returns {import('./CentralRevisaoPersistenteService')|null}
   */
  _obterRevisaoService() {
    if (this._revisaoPersistenteService) return this._revisaoPersistenteService;
    try {
      const CentralRevisaoPersistenteService = require('./CentralRevisaoPersistenteService');
      this._revisaoPersistenteService = new CentralRevisaoPersistenteService({
        documentosRepository: this._documentosRepository
      });
      return this._revisaoPersistenteService;
    } catch {
      return null;
    }
  }

  /**
   * @private
   * @param {Object} documento
   * @returns {Object}
   */
  _obterPayloadParsePersistido(documento) {
    if (!documento.parseJson) {
      const erro = new Error(
        'Documento ainda não processado. O pipeline Parser + MIIP deve ser concluído antes de abrir Compras.'
      );
      erro.statusCode = 400;
      throw erro;
    }

    // RC8.4.0 — deep clone para isolar itens (evita referências compartilhadas)
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(documento.parseJson);
      }
    } catch {
      /* fallback */
    }
    return JSON.parse(JSON.stringify(documento.parseJson));
  }

  /**
   * RC COMPRAS 5.4.1 — completa financeiro a partir do XML se parse antigo não tiver.
   * Não reprocessa MIIP/itens; só enriquece pag/cobr/IPI.
   * @private
   */
  async _enriquecerFinanceiroDoXml(payload, xml) {
    if (!xml || typeof xml !== 'string') return payload;

    if (financeiroPayloadCompleto(payload)) return payload;

    try {
      const NFeParserService = require('../../../shared/nfe/NFeParserService');
      const json = await NFeParserService.parse(xml);
      const parcelasXml = Array.isArray(json.parcelas_detalhe) ? json.parcelas_detalhe : [];
      const duplicatasXml = Array.isArray(json.duplicatas) ? json.duplicatas : [];
      const gradeAtual = Array.isArray(payload.parcelas_detalhe) ? payload.parcelas_detalhe : [];
      const gradeComVencimento = gradeAtual.length > 0
        && gradeAtual.every((p) => String(p?.vencimento || p?.dVenc || '').trim().length >= 10);

      return {
        ...payload,
        valor_ipi: payload.valor_ipi ?? json.valor_ipi ?? 0,
        valor_seguro: payload.valor_seguro ?? json.valor_seguro ?? 0,
        forma_pagamento: payload.forma_pagamento || json.forma_pagamento || null,
        condicao_pagamento: payload.condicao_pagamento || json.condicao_pagamento || null,
        pagamentos: (payload.pagamentos && payload.pagamentos.length)
          ? payload.pagamentos
          : (json.pagamentos || []),
        duplicatas: (payload.duplicatas && payload.duplicatas.length)
          ? payload.duplicatas
          : duplicatasXml,
        parcelas_detalhe: gradeComVencimento
          ? gradeAtual
          : (parcelasXml.length ? parcelasXml : gradeAtual),
        parcelas: parcelasXml.length
          ? parcelasXml.length
          : (payload.parcelas || json.parcelas || 1),
        data_vencimento: payload.data_vencimento
          || json.data_vencimento
          || parcelasXml[0]?.vencimento
          || null,
        valor_total_nota: payload.valor_total_nota || json.valor_total_nota
      };
    } catch {
      return payload;
    }
  }

  /**
   * @param {number|string} documentoId
   * @returns {Promise<Object>}
   */
  async montarPayloadAbrirCompra(documentoId) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    let payload = this._obterPayloadParsePersistido(documento);
    payload = await this._enriquecerFinanceiroDoXml(payload, documento.xml);

    return {
      sucesso: true,
      documentoId: documento.id,
      chave: documento.chave,
      status: documento.status,
      dadosCompra: {
        ...payload,
        xml: documento.xml || null,
        natureza_operacao: payload.natureza_operacao || payload.natureza || null,
        cfop: payload.cfop || null
      }
    };
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async registrarAberturaCompra(documentoId, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const statusPermitidos = [
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA,
      DocumentoFiscalStatus.REVISADA,
      DocumentoFiscalStatus.EM_COMPRA
    ];

    if (!statusPermitidos.includes(documento.status)) {
      const erro = new Error(`Documento não está pronto para Compras (status: ${documento.status})`);
      erro.statusCode = 400;
      throw erro;
    }

    if (documento.status !== DocumentoFiscalStatus.EM_COMPRA) {
      await this._transitionService.transicionar(
        documentoId,
        documento.status,
        DocumentoFiscalStatus.EM_COMPRA,
        {
          detalhe: 'Compra aberta na tela de Compras',
          usuarioId: opcoes.usuarioId
        }
      );
    }

    const payload = await this.montarPayloadAbrirCompra(documentoId);
    const atualizado = await this._documentosRepository.buscarPorId(documentoId);

    return {
      ...payload,
      documento: paraDocumentoDetalheDTO(atualizado)
    };
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async concluirRevisao(documentoId, dados = {}) {
    const correlationId = dados.correlationId ?? dados.correlation_id ?? null;
    const usuarioId = dados.usuarioId ?? dados.usuario_id ?? null;
    let etapa = 'buscar';

    try {
      const documento = await this._documentosRepository.buscarPorId(documentoId);
      if (!documento) {
        const erro = new Error('Documento não encontrado');
        erro.statusCode = 404;
        throw erro;
      }

      const statusCanonico = normalizarStatus(documento.status);
      const itensParse = Array.isArray(documento.parseJson?.itens)
        ? documento.parseJson.itens
        : [];

      console.log('[CentralRevisao][concluir] start', {
        correlationId,
        documentoId,
        usuarioId,
        statusAnterior: documento.status,
        qtyItens: itensParse.length
      });

      const revisaoService = this._obterRevisaoService();

      // IDEMPOTENCY — já pronta: não re-transiciona / não duplica histórico
      if (statusCanonico === DocumentoFiscalStatus.PRONTA_IMPORTACAO) {
        etapa = 'sessao';
        if (revisaoService) {
          const ativa = await revisaoService.buscarSessaoAtiva(documentoId);
          if (ativa) {
            await revisaoService.marcarSessaoConcluida(ativa.id);
          }
        }

        return {
          sucesso: true,
          documento: paraDocumentoDetalheDTO(documento),
          parse: documento.parseJson || null,
          proximaAcao: 'abrir_compra',
          idempotente: true
        };
      }

      etapa = 'validar';
      if (statusCanonico !== DocumentoFiscalStatus.EM_REVISAO) {
        const erro = new Error(
          `Revisão só pode ser concluída em EM_REVISAO (atual: ${documento.status})`
        );
        erro.statusCode = 400;
        throw erro;
      }

      const parseAtual = documento.parseJson || {};
      let itensAtualizados = Array.isArray(parseAtual.itens) ? parseAtual.itens.slice() : [];
      const permitirParcial = dados.permitirParcial === true;
      const itensLegado = Array.isArray(dados.itens) ? dados.itens : null;

      etapa = 'sessao';
      let sessaoAtiva = null;
      if (revisaoService) {
        const merge = await revisaoService.mesclarDecisoesNaSessao(documentoId, itensAtualizados);
        sessaoAtiva = merge.sessao;
        itensAtualizados = merge.itens;

        if (sessaoAtiva && !permitirParcial) {
          const total = Number(sessaoAtiva.totalItens || 0);
          const legadoOk = Array.isArray(itensLegado) && itensLegado.length >= total;
          if (!merge.completo && !legadoOk) {
            const erro = new Error(
              `Revisão incompleta: ${sessaoAtiva.itensConcluidos || 0}/${total} itens decididos`
            );
            erro.statusCode = 400;
            throw erro;
          }
        }
      }

      // Legado: se dados.itens cobre o documento, prevalece
      if (Array.isArray(itensLegado) && itensLegado.length) {
        itensAtualizados = itensLegado;
      }

      const parseAtualizado = {
        ...parseAtual,
        itens: itensAtualizados
      };

      etapa = 'salvar_parse';
      await this._documentosRepository.atualizar(documentoId, {
        parseJson: parseAtualizado,
        processadoEm: new Date().toISOString()
      });

      etapa = 'transicionar';
      await this._transitionService.transicionar(
        documentoId,
        DocumentoFiscalStatus.EM_REVISAO,
        DocumentoFiscalStatus.PRONTA_IMPORTACAO,
        {
          detalhe: 'Central de Revisão MIIP concluída — liberado para importação/compras',
          usuarioId
        }
      );

      etapa = 'sessao';
      if (revisaoService && sessaoAtiva) {
        await revisaoService.marcarSessaoConcluida(sessaoAtiva.id);
      } else if (revisaoService) {
        const ativa = await revisaoService.buscarSessaoAtiva(documentoId);
        if (ativa) await revisaoService.marcarSessaoConcluida(ativa.id);
      }

      etapa = 'historico';
      const atualizado = await this._documentosRepository.buscarPorId(documentoId);

      return {
        sucesso: true,
        documento: paraDocumentoDetalheDTO(atualizado),
        parse: parseAtualizado,
        proximaAcao: 'abrir_compra',
        correlationId
      };
    } catch (err) {
      console.error('[CentralRevisao][concluir]', {
        etapa,
        correlationId,
        documentoId,
        message: err?.message,
        stack: err?.stack
      });
      throw err;
    }
  }

  /**
   * Caso de uso único: concluir revisão (se necessário) + abrir importação em Compras.
   * Não grava a compra — apenas prepara o payload e transiciona para EM_IMPORTACAO.
   *
   * @param {number|string} documentoId
   * @param {Object} [dados]
   * @returns {Promise<Object>}
   */
  async finalizarEntrada(documentoId, dados = {}) {
    const chave = String(documentoId);
    const emAndamento = this._finalizarEntradaEmAndamento.get(chave);
    if (emAndamento) {
      return emAndamento;
    }

    const execucao = this._executarFinalizarEntrada(documentoId, dados)
      .finally(() => {
        this._finalizarEntradaEmAndamento.delete(chave);
      });

    this._finalizarEntradaEmAndamento.set(chave, execucao);
    return execucao;
  }

  /**
   * @private
   * @param {number|string} documentoId
   * @param {Object} [dados]
   * @returns {Promise<Object>}
   */
  async _executarFinalizarEntrada(documentoId, dados = {}) {
    const correlationId = dados.correlationId ?? dados.correlation_id ?? null;
    const usuarioId = dados.usuarioId ?? dados.usuario_id ?? null;
    let etapa = 'buscar';

    try {
      const documento = await this._documentosRepository.buscarPorId(documentoId);
      if (!documento) {
        const erro = new Error('Documento não encontrado');
        erro.statusCode = 404;
        throw erro;
      }

      const statusCanonico = normalizarStatus(documento.status);
      const compraVinculada = Number(documento.compraId || documento.compra_id || 0) || null;

      console.log('[CentralEntradas][finalizarEntrada] start', {
        correlationId,
        documentoId,
        usuarioId,
        statusAnterior: documento.status,
        compraVinculada
      });

      if (
        compraVinculada
        || statusCanonico === DocumentoFiscalStatus.IMPORTADA
        || statusCanonico === DocumentoFiscalStatus.FINALIZADA
      ) {
        const erro = new Error(
          compraVinculada
            ? `Documento já possui compra vinculada (#${compraVinculada}).`
            : `Documento já foi importado (status: ${documento.status}).`
        );
        erro.statusCode = 409;
        erro.codigo = 'DOCUMENTO_JA_IMPORTADO';
        throw erro;
      }

      etapa = 'revisao';
      if (statusCanonico === DocumentoFiscalStatus.EM_REVISAO) {
        await this.concluirRevisao(documentoId, {
          itens: dados.itens,
          usuarioId,
          correlationId,
          permitirParcial: dados.permitirParcial === true
        });
      } else if (
        statusCanonico !== DocumentoFiscalStatus.PRONTA_IMPORTACAO
        && statusCanonico !== DocumentoFiscalStatus.EM_IMPORTACAO
      ) {
        const erro = new Error(
          `Documento não pode finalizar entrada no status atual (${documento.status}).`
        );
        erro.statusCode = 400;
        erro.codigo = 'STATUS_INVALIDO_FINALIZAR_ENTRADA';
        throw erro;
      }

      etapa = 'abrir_compra';
      const docAposRevisao = await this._documentosRepository.buscarPorId(documentoId);
      const statusApos = normalizarStatus(docAposRevisao?.status);
      const retomada = statusApos === DocumentoFiscalStatus.EM_IMPORTACAO;

      const abertura = await this.registrarAberturaCompra(documentoId, { usuarioId });
      const statusFinal = abertura?.documento?.status
        || abertura?.status
        || DocumentoFiscalStatus.EM_IMPORTACAO;

      return {
        sucesso: true,
        documentoId: Number(abertura.documentoId || documentoId),
        chave: abertura.chave || documento.chave || null,
        status: statusFinal,
        proximaAcao: 'ABRIR_COMPRA',
        dadosCompra: abertura.dadosCompra,
        documento: abertura.documento,
        retomada: retomada === true,
        correlationId
      };
    } catch (err) {
      console.error('[CentralEntradas][finalizarEntrada]', {
        etapa,
        correlationId,
        documentoId,
        message: err?.message,
        stack: err?.stack
      });
      throw err;
    }
  }

  /**
   * @param {number|string} documentoId
   * @param {number|string} compraId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async vincularCompra(documentoId, compraId, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const compraIdNum = Number(compraId);
    const compraExistente = Number(documento.compraId || documento.compra_id || 0) || null;
    const statusAtual = documento.status;
    const statusCanonico = normalizarStatus(statusAtual);
    const statusDestino = DocumentoFiscalStatus.GRAVADA;

    // Idempotência: já vinculado à mesma compra
    if (
      compraExistente
      && compraExistente === compraIdNum
      && (statusCanonico === DocumentoFiscalStatus.IMPORTADA
        || statusCanonico === DocumentoFiscalStatus.FINALIZADA)
    ) {
      return {
        sucesso: true,
        documento: paraDocumentoDetalheDTO(documento),
        compraId: compraIdNum,
        idempotente: true
      };
    }

    if (compraExistente && compraExistente !== compraIdNum) {
      const erro = new Error(
        `Documento já vinculado à compra #${compraExistente}. Não é permitido vincular outra compra.`
      );
      erro.statusCode = 409;
      erro.codigo = 'COMPRA_JA_VINCULADA';
      throw erro;
    }

    if (statusAtual !== DocumentoFiscalStatus.EM_COMPRA && statusAtual !== DocumentoFiscalStatus.PRONTA_PARA_COMPRA) {
      const validacao = validarTransicao(statusAtual, statusDestino);
      if (!validacao.valido) {
        const erro = new Error(validacao.erro);
        erro.statusCode = 400;
        throw erro;
      }
    }

    if (statusAtual === DocumentoFiscalStatus.PRONTA_PARA_COMPRA) {
      await this._transitionService.transicionar(documentoId, statusAtual, DocumentoFiscalStatus.EM_COMPRA, {
        detalhe: 'Vínculo com compra gravada',
        usuarioId: opcoes.usuarioId
      });
    }

    await this._documentosRepository.atualizar(documentoId, {
      compraId: compraIdNum,
      processadoEm: new Date().toISOString()
    });

    try {
      await this._transitionService.transicionar(
        documentoId,
        DocumentoFiscalStatus.EM_COMPRA,
        DocumentoFiscalStatus.GRAVADA,
        {
          detalhe: `Compra #${compraIdNum} gravada via saveCompra()`,
          usuarioId: opcoes.usuarioId
        }
      );
    } catch (transicaoErr) {
      // compra_id já persistido — manter rastreabilidade e propagar falha de estado
      console.error('[CentralComprasBridge][vincularCompra] falha na transição após gravar compra_id', {
        documentoId,
        compraId: compraIdNum,
        message: transicaoErr?.message
      });
      const erro = new Error(
        `Compra #${compraIdNum} vinculada ao documento, mas falhou a transição de status: ${transicaoErr.message}`
      );
      erro.statusCode = 500;
      erro.codigo = 'VINCULO_TRANSICAO_FALHOU';
      erro.compraId = compraIdNum;
      erro.causa = transicaoErr;
      throw erro;
    }

    const atualizado = await this._documentosRepository.buscarPorId(documentoId);

    const { emitirCompraGravada } = require('../utils/centralEventosEmitter');
    emitirCompraGravada(atualizado, compraIdNum).catch((emitErr) => {
      console.warn('[CentralComprasBridge][vincularCompra] evento compra_gravada:', emitErr?.message);
    });

    return {
      sucesso: true,
      documento: paraDocumentoDetalheDTO(atualizado),
      compraId: compraIdNum
    };
  }
}

module.exports = CentralComprasBridgeService;
