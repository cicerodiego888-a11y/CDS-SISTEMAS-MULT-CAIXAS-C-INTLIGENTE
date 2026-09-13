/**
 * CentralRevisaoPersistenteService — Sessão + decisões de revisão MIIP resumíveis.
 *
 * Não substitui a máquina de estados do documento; apenas persiste progresso
 * da revisão item a item para retomar depois.
 *
 * @class CentralRevisaoPersistenteService
 */

'use strict';

const {
  DocumentoFiscalStatus,
  normalizarStatus
} = require('../core/DocumentoFiscalStatus');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralRevisaoSessoesRepository = require('../repositories/CentralRevisaoSessoesRepository');
const CentralRevisaoItensRepository = require('../repositories/CentralRevisaoItensRepository');

const DECISOES = Object.freeze({
  CONFIRMAR: 'CONFIRMAR',
  CADASTRAR: 'CADASTRAR',
  ASSOCIAR: 'ASSOCIAR',
  IGNORAR: 'IGNORAR'
});

const ALIASES_DECISAO = Object.freeze({
  CONFIRMAR: DECISOES.CONFIRMAR,
  CONFIRMADO: DECISOES.CONFIRMAR,
  CADASTRAR: DECISOES.CADASTRAR,
  ASSOCIAR: DECISOES.ASSOCIAR,
  IGNORAR: DECISOES.IGNORAR,
  IGNORADO: DECISOES.IGNORAR
});

/**
 * @param {string} valor
 * @returns {string}
 */
function normalizarDecisao(valor) {
  const raw = String(valor || '').trim().toUpperCase();
  const canonico = ALIASES_DECISAO[raw];
  if (!canonico) {
    const erro = new Error(
      `Decisão inválida: ${valor}. Use CONFIRMAR, CADASTRAR, ASSOCIAR ou IGNORAR`
    );
    erro.statusCode = 400;
    throw erro;
  }
  return canonico;
}

/**
 * @param {string} status
 * @returns {boolean}
 */
function documentoEmRevisao(status) {
  return normalizarStatus(status) === DocumentoFiscalStatus.EM_REVISAO;
}

class CentralRevisaoPersistenteService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    const repoDeps = { db: deps.db ?? null };

    /** @private */
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository(repoDeps);
    /** @private */
    this._sessoesRepository = deps.sessoesRepository
      ?? new CentralRevisaoSessoesRepository(repoDeps);
    /** @private */
    this._itensRepository = deps.itensRepository
      ?? new CentralRevisaoItensRepository(repoDeps);
  }

  /**
   * @private
   * @param {Object} sessao
   * @param {Object[]} itens
   * @returns {{ total: number, concluidos: number, pendentes: number, itemAtual: number, primeiroPendente: number|null }}
   */
  _montarProgresso(sessao, itens = []) {
    const total = Number(sessao?.totalItens || 0);
    const indices = new Set(
      (itens || [])
        .filter((i) => i && (i.status === 'CONCLUIDO' || i.decisao))
        .map((i) => Number(i.itemIndex))
    );
    const concluidos = indices.size;
    let primeiroPendente = null;
    for (let i = 0; i < total; i += 1) {
      if (!indices.has(i)) {
        primeiroPendente = i;
        break;
      }
    }
    const itemAtual = primeiroPendente == null
      ? Math.max(0, total - 1)
      : primeiroPendente;

    return {
      total,
      concluidos,
      pendentes: Math.max(0, total - concluidos),
      itemAtual,
      primeiroPendente
    };
  }

  /**
   * @private
   * @param {Object} documento
   * @returns {Object[]}
   */
  _obterItensParse(documento) {
    const parse = documento?.parseJson || {};
    return Array.isArray(parse.itens) ? parse.itens : [];
  }

  /**
   * @private
   * @param {Object} sessao
   * @param {Object[]} itens
   * @param {Object} [extras]
   * @returns {Object}
   */
  _montarRespostaSessao(sessao, itens, extras = {}) {
    const progresso = this._montarProgresso(sessao, itens);
    return {
      sucesso: true,
      sessao: {
        ...sessao,
        itemAtual: progresso.itemAtual,
        itensConcluidos: progresso.concluidos
      },
      itens,
      progresso,
      ...extras
    };
  }

  /**
   * @param {number|string} documentoId
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async obterOuCriarSessao(documentoId, opcoes = {}) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    if (!documentoEmRevisao(documento.status)) {
      const erro = new Error(
        `Sessão de revisão só pode ser criada em EM_REVISAO (atual: ${documento.status})`
      );
      erro.statusCode = 400;
      throw erro;
    }

    const usuarioId = opcoes.usuarioId ?? opcoes.usuario_id ?? null;
    const correlationId = opcoes.correlationId ?? opcoes.correlation_id ?? null;
    const forcarNova = opcoes.forcarNova === true || opcoes.reiniciar === true;

    let ativa = await this._sessoesRepository.buscarAtivaPorDocumento(documentoId);

    if (forcarNova && ativa) {
      await this._sessoesRepository.atualizar(ativa.id, { status: 'CANCELADA' });
      ativa = null;
    }

    if (ativa) {
      const itens = await this._itensRepository.buscarPorSessao(ativa.id);
      const progresso = this._montarProgresso(ativa, itens);
      if (
        progresso.concluidos !== Number(ativa.itensConcluidos || 0)
        || progresso.itemAtual !== Number(ativa.itemAtual || 0)
      ) {
        ativa = await this._sessoesRepository.atualizar(ativa.id, {
          itensConcluidos: progresso.concluidos,
          itemAtual: progresso.itemAtual
        });
      }
      return this._montarRespostaSessao(ativa, itens, {
        recuperada: true,
        dadosImportacao: this._hintsDadosImportacao(documento, itens)
      });
    }

    const itensParse = this._obterItensParse(documento);
    const totalItens = itensParse.length;
    const sessao = await this._sessoesRepository.criar({
      documentoId: Number(documentoId),
      usuarioId,
      status: 'EM_ANDAMENTO',
      totalItens,
      itensConcluidos: 0,
      itemAtual: 0,
      correlationId
    });

    return this._montarRespostaSessao(sessao, [], {
      recuperada: false,
      dadosImportacao: this._hintsDadosImportacao(documento, [])
    });
  }

  /**
   * @private
   * @param {Object} documento
   * @param {Object[]} itensDecididos
   * @returns {Object}
   */
  _hintsDadosImportacao(documento, itensDecididos = []) {
    const parse = documento?.parseJson || {};
    const itensParse = Array.isArray(parse.itens) ? parse.itens : [];
    return {
      possuiParse: Boolean(documento?.parseJson),
      totalItensParse: itensParse.length,
      decisoesSalvas: (itensDecididos || []).length,
      chave: documento?.chave || null,
      /** Snapshot atual do parse (já mesclado com decisões salvas). */
      itensParse,
      decisoes: (itensDecididos || []).map((d) => ({
        itemIndex: Number(d.itemIndex),
        decisao: d.decisao,
        produtoDestinoId: d.produtoDestinoId ?? null,
        status: d.status
      }))
    };
  }

  /**
   * @param {number|string} documentoId
   * @param {number} itemIndex
   * @param {Object} dados
   * @returns {Promise<Object>}
   */
  async salvarDecisao(documentoId, itemIndex, dados = {}) {
    const indice = Number(itemIndex);
    if (!Number.isInteger(indice) || indice < 0) {
      const erro = new Error('Índice do item inválido');
      erro.statusCode = 400;
      throw erro;
    }

    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    if (!documentoEmRevisao(documento.status)) {
      const erro = new Error(
        `Decisão só pode ser salva em EM_REVISAO (atual: ${documento.status})`
      );
      erro.statusCode = 400;
      throw erro;
    }

    let sessao = await this._sessoesRepository.buscarAtivaPorDocumento(documentoId);
    if (!sessao) {
      const criada = await this.obterOuCriarSessao(documentoId, {
        usuarioId: dados.usuarioId ?? dados.usuario_id,
        correlationId: dados.correlationId ?? dados.correlation_id
      });
      sessao = criada.sessao;
    }

    if (indice >= Number(sessao.totalItens || 0)) {
      const erro = new Error(
        `Índice ${indice} fora do intervalo (total: ${sessao.totalItens})`
      );
      erro.statusCode = 400;
      throw erro;
    }

    const decisao = normalizarDecisao(dados.decisao);
    const produtoId = dados.produtoId ?? dados.produto_id ?? null;
    const itemPatch = dados.item && typeof dados.item === 'object' ? dados.item : {};
    const itensParse = this._obterItensParse(documento);
    const itemAtualParse = itensParse[indice] || {};
    const produtoOrigem = itemAtualParse.produto_nome
      || itemAtualParse.descricao
      || itemAtualParse.xProd
      || null;

    const itemSalvo = await this._itensRepository.upsert({
      sessaoId: sessao.id,
      documentoId: Number(documentoId),
      itemIndex: indice,
      produtoOrigem,
      produtoDestinoId: produtoId != null ? Number(produtoId) : null,
      decisao,
      status: 'CONCLUIDO',
      usuarioId: dados.usuarioId ?? dados.usuario_id ?? null,
      dadosJson: {
        ...itemPatch,
        decisao,
        produto_id: produtoId != null ? Number(produtoId) : (itemPatch.produto_id ?? null),
        miip_revisao_status: decisao
      }
    });

    const parseAtual = documento.parseJson || {};
    const itensAtualizados = Array.isArray(parseAtual.itens)
      ? parseAtual.itens.slice()
      : [];
    while (itensAtualizados.length <= indice) {
      itensAtualizados.push({});
    }

    itensAtualizados[indice] = {
      ...itensAtualizados[indice],
      ...itemPatch,
      produto_id: produtoId != null
        ? Number(produtoId)
        : (itensAtualizados[indice].produto_id ?? null),
      miip_revisao_status: decisao,
      miip_revisao_decisao: decisao
    };

    await this._documentosRepository.atualizar(documentoId, {
      parseJson: {
        ...parseAtual,
        itens: itensAtualizados
      }
    });

    const itens = await this._itensRepository.buscarPorSessao(sessao.id);
    const progresso = this._montarProgresso(sessao, itens);
    const sessaoAtualizada = await this._sessoesRepository.atualizar(sessao.id, {
      itensConcluidos: progresso.concluidos,
      itemAtual: progresso.itemAtual,
      correlationId: dados.correlationId ?? dados.correlation_id ?? sessao.correlationId
    });

    return {
      sucesso: true,
      sessao: sessaoAtualizada,
      item: itemSalvo,
      progresso,
      salvo: true
    };
  }

  /**
   * @param {number|string} documentoId
   * @returns {Promise<Object>}
   */
  async obterSessao(documentoId) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    let sessao = await this._sessoesRepository.buscarAtivaPorDocumento(documentoId);
    if (!sessao) {
      sessao = await this._sessoesRepository.buscarUltimaPorDocumento(documentoId);
    }

    if (!sessao) {
      return {
        sucesso: true,
        sessao: null,
        itens: [],
        progresso: {
          total: this._obterItensParse(documento).length,
          concluidos: 0,
          pendentes: this._obterItensParse(documento).length,
          itemAtual: 0,
          primeiroPendente: 0
        }
      };
    }

    const itens = await this._itensRepository.buscarPorSessao(sessao.id);
    return this._montarRespostaSessao(sessao, itens, {
      dadosImportacao: this._hintsDadosImportacao(documento, itens)
    });
  }

  /**
   * @param {Object[]} documentos
   * @returns {Promise<Object[]>}
   */
  async enriquecerDocumentosComProgresso(documentos = []) {
    if (!Array.isArray(documentos) || !documentos.length) return documentos;

    const emRevisao = documentos.filter((doc) => documentoEmRevisao(doc?.status));
    if (!emRevisao.length) return documentos;

    const ids = emRevisao.map((doc) => doc.id).filter(Boolean);
    const sessoes = await this._sessoesRepository.listarPorDocumentos(ids);

    /** @type {Map<number, Object>} */
    const ativaPorDoc = new Map();
    for (const sessao of sessoes) {
      const docId = Number(sessao.documentoId);
      const atual = ativaPorDoc.get(docId);
      if (!atual) {
        ativaPorDoc.set(docId, sessao);
      } else if (sessao.status === 'EM_ANDAMENTO' && atual.status !== 'EM_ANDAMENTO') {
        ativaPorDoc.set(docId, sessao);
      }
    }

    return documentos.map((doc) => {
      if (!documentoEmRevisao(doc?.status)) return doc;
      const sessao = ativaPorDoc.get(Number(doc.id));
      if (!sessao) {
        return {
          ...doc,
          revisaoProgresso: null
        };
      }

      const total = Number(sessao.totalItens || 0);
      const concluidos = Number(sessao.itensConcluidos || 0);
      const percentual = total > 0 ? Math.round((concluidos / total) * 100) : 0;

      return {
        ...doc,
        revisaoProgresso: {
          sessaoId: sessao.id,
          total,
          concluidos,
          status: sessao.status,
          percentual
        }
      };
    });
  }

  /**
   * Aplica decisões da sessão ativa sobre o array de itens (merge).
   * @param {number|string} documentoId
   * @param {Object[]} [itensBase]
   * @returns {Promise<{ sessao: Object|null, itens: Object[], decisoes: Object[], completo: boolean }>}
   */
  async mesclarDecisoesNaSessao(documentoId, itensBase = null) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }

    const sessao = await this._sessoesRepository.buscarAtivaPorDocumento(documentoId);
    const base = Array.isArray(itensBase)
      ? itensBase.slice()
      : this._obterItensParse(documento).slice();

    if (!sessao) {
      return {
        sessao: null,
        itens: base,
        decisoes: [],
        completo: true
      };
    }

    const decisoes = await this._itensRepository.buscarPorSessao(sessao.id);
    const itens = base.slice();

    for (const dec of decisoes) {
      const idx = Number(dec.itemIndex);
      if (!Number.isInteger(idx) || idx < 0) continue;
      while (itens.length <= idx) itens.push({});
      const patch = dec.dadosJson && typeof dec.dadosJson === 'object'
        ? dec.dadosJson
        : {};
      itens[idx] = {
        ...itens[idx],
        ...patch,
        produto_id: dec.produtoDestinoId ?? patch.produto_id ?? itens[idx].produto_id ?? null,
        miip_revisao_status: dec.decisao,
        miip_revisao_decisao: dec.decisao
      };
    }

    const progresso = this._montarProgresso(sessao, decisoes);
    return {
      sessao,
      itens,
      decisoes,
      completo: progresso.pendentes === 0
    };
  }

  /**
   * @param {number|string} sessaoId
   * @returns {Promise<Object|null>}
   */
  async marcarSessaoConcluida(sessaoId) {
    if (!sessaoId) return null;
    const concluidos = await this._itensRepository.contarConcluidos(sessaoId);
    return this._sessoesRepository.marcarConcluida(sessaoId, {
      itensConcluidos: concluidos
    });
  }

  /**
   * @param {number|string} documentoId
   * @returns {Promise<Object|null>}
   */
  async buscarSessaoAtiva(documentoId) {
    return this._sessoesRepository.buscarAtivaPorDocumento(documentoId);
  }
}

CentralRevisaoPersistenteService.DECISOES = DECISOES;
CentralRevisaoPersistenteService.normalizarDecisao = normalizarDecisao;

module.exports = CentralRevisaoPersistenteService;
