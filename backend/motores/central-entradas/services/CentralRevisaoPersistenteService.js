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
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const ConfirmacaoConversaoEntradaNfe = require('../../../services/unidades/ConfirmacaoConversaoEntradaNfe');
const { executarEmTransacao } = require('../../../services/fiscalNaoFiscal/estoqueSaldosPublico');
const { SQL_DECISOES_SESSAO, montarDecisoesProduto } = require('./CentralDecisaoProdutoLinha');
const { revalidarParseMiipPersistido } = require('../../miip/utils/MiipRevalidacaoResultadoPersistido');
const dbPadrao = require('../../../database');
const sqlite3 = require('sqlite3');

const MOTIVO_CORRECAO_MINIMO = 10;
let filaCorrecoes = Promise.resolve();

/**
 * Conexão própria para a transação da correção. Na conexão compartilhada, comandos de outros módulos
 * emitidos durante a transação entrariam nela e seriam desfeitos ou confirmados junto com a correção.
 * Sem arquivo (banco em memória / dublês de teste): null, e a correção usa a conexão recebida.
 */
function abrirConexaoTransacao(base) {
  const arquivo = typeof base?.filename === 'string' ? base.filename : '';
  if (!arquivo || arquivo === ':memory:') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const conexao = new sqlite3.Database(arquivo, sqlite3.OPEN_READWRITE, (err) => {
      if (err) return reject(err);
      conexao.exec('PRAGMA busy_timeout = 30000; PRAGMA foreign_keys = ON;', (pragmaErr) => {
        if (pragmaErr) return conexao.close(() => reject(pragmaErr));
        return resolve(conexao);
      });
    });
  });
}

function fecharConexao(conexao) {
  return conexao ? new Promise((resolve) => conexao.close(() => resolve())) : Promise.resolve();
}

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
    /** @private */
    this._historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository(repoDeps);
    /** @private */
    this._db = deps.db ?? null;
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
    const parse = revalidarParseMiipPersistido(documento?.parseJson || {});
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
    const origemDecisao = String(dados.origemDecisao || dados.origem_decisao || itemPatch.origem_decisao || '').toLowerCase();
    const existenteDecisao = await this._itensRepository.buscarPorSessaoEIndice(sessao.id, indice);
    if (
      existenteDecisao
      && existenteDecisao.status === 'CONCLUIDO'
      && existenteDecisao.produtoDestinoId
      && origemDecisao === 'automatica'
    ) {
      return {
        sucesso: true,
        sessao,
        item: existenteDecisao,
        preservado: true,
        salvo: true
      };
    }
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
        miip_revisao_status: decisao,
        associacao: dados.associacao && typeof dados.associacao === 'object'
          ? dados.associacao
          : {
            linha_xml: indice,
            codigo_barras: itemPatch.codigo_barras ?? itemAtualParse.codigo_barras ?? itemAtualParse.gtin ?? null,
            cProd: itemPatch.codigo_fornecedor ?? itemAtualParse.cProd ?? itemAtualParse.codigo_fornecedor ?? null,
            codigo_interno: itemPatch.codigo_interno ?? null,
            descricao_xml: produtoOrigem,
            produto_id: produtoId != null ? Number(produtoId) : null,
            criterio: dados.criterio ?? itemPatch.criterio ?? null,
            origem_decisao: origemDecisao || 'manual',
            estado: decisao
          }
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

  /**
   * Avalia conversões de todas as linhas (MUC/MUM). Não recalcula no frontend.
   * @param {number|string} documentoId
   * @returns {Promise<Object>}
   */
  async avaliarConversoes(documentoId) {
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }
    const itens = this._obterItensParse(documento);
    const produtoMap = await this._carregarProdutosItens(itens);
    const confirmacoes = itens.map((item, index) => ({
      item_key: ConfirmacaoConversaoEntradaNfe.extrairChaveConversaoItem(item, index),
      indice: index,
      documento_id: Number(documentoId),
      chave_acesso: documento.chave || null,
      confirmacao: item?.conversao?.confirmacao ?? item?.conversao_decisao ?? null,
      selo_conversao: item?.conversao?.selo_conversao ?? null
    }));
    const pendencias = ConfirmacaoConversaoEntradaNfe.validarPendenciasConversaoEntrada(itens, {
      produtoMap,
      confirmacoes,
      documentoId: Number(documentoId),
      chaveAcesso: documento.chave || null,
      origemCompra: 'CENTRAL_NFE'
    });
    const indicesPendentes = new Set(pendencias.map((p) => Number(p.indice)));
    const linhas = itens.map((item, index) => {
      const avaliacao = ConfirmacaoConversaoEntradaNfe.avaliarLinha(
        item,
        produtoMap.get(Number(item?.produto_id || item?.produtoId || 0)) || {},
        index,
        { documentoId: Number(documentoId), chaveAcesso: documento.chave || null }
      );
      const linha = avaliacao.pendencia
        ? { ...avaliacao.pendencia }
        : {
          item_key: ConfirmacaoConversaoEntradaNfe.extrairChaveConversaoItem(item, index),
          indice: index,
          requer_confirmacao: false,
          estado_decisao: item?.conversao?.estado || 'NAO_APLICA'
        };
      // avaliarLinha não conhece a decisão gravada; a tela mostraria "Pendente" após o SIM.
      if (avaliacao.pendencia && item?.conversao?.estado && !indicesPendentes.has(index)) {
        linha.estado_decisao = item.conversao.estado;
      }
      return {
        ...linha,
        produto_associado: item?.produto_id || null,
        descricao_xml: item?.produto_nome || item?.descricao || item?.xProd || null,
        conversao_persistida: item?.conversao || null,
        resultado_backend: avaliacao.resultado || null
      };
    });
    return {
      sucesso: true,
      documentoId: Number(documentoId),
      chave: documento.chave || null,
      linhas,
      pendencias,
      bloqueia_efetivacao: pendencias.length > 0
    };
  }

  /**
   * Persiste SIM/NÃO de conversão na linha, após revalidar no backend.
   */
  async salvarDecisaoConversao(documentoId, itemIndex, dados = {}) {
    const indice = Number(itemIndex);
    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) {
      const erro = new Error('Documento não encontrado');
      erro.statusCode = 404;
      throw erro;
    }
    const notaErrada = ConfirmacaoConversaoEntradaNfe.validarIdentidadeNota(dados, {
      documentoId: Number(documentoId),
      chaveAcesso: documento.chave
    });
    if (notaErrada) {
      const erro = new Error(notaErrada.message);
      erro.statusCode = 422;
      erro.code = notaErrada.codigo;
      throw erro;
    }

    const parseAtual = documento.parseJson || {};
    const itens = Array.isArray(parseAtual.itens) ? parseAtual.itens.slice() : [];
    if (!Number.isInteger(indice) || indice < 0 || indice >= itens.length) {
      const erro = new Error(`Índice ${indice} fora do intervalo`);
      erro.statusCode = 400;
      throw erro;
    }

    const item = { ...itens[indice] };
    const xmlOriginal = ConfirmacaoConversaoEntradaNfe.snapshotXmlLinha(item, indice);
    const produtoMap = await this._carregarProdutosItens([item]);
    const produto = produtoMap.get(Number(item.produto_id || item.produtoId || 0)) || null;
    const avaliacao = ConfirmacaoConversaoEntradaNfe.avaliarLinha(item, produto || {}, indice, {
      documentoId: Number(documentoId),
      chaveAcesso: documento.chave
    });

    const estado = ConfirmacaoConversaoEntradaNfe.estadoDecisao(dados.decisao ?? dados.confirmacao);
    let resultadoValidado = {
      estado,
      ok: !avaliacao.requer,
      aprendizado_permanente: false,
      unidade_produto_inalterada: true
    };

    if (avaliacao.requer && estado === 'SIM') {
      const aplicado = ConfirmacaoConversaoEntradaNfe.aplicarSim(item, produto, avaliacao.resultado, indice, {
        documentoId: Number(documentoId)
      });
      resultadoValidado = {
        ...resultadoValidado,
        ok: aplicado.ok,
        quantidade_estoque: aplicado.quantidadeEstoque || null,
        origem: aplicado.origem || null,
        codigo: aplicado.pendencia?.codigo || null,
        justificativa: aplicado.pendencia?.justificativa || null
      };
    } else if (avaliacao.requer && estado === 'NAO') {
      const recusa = ConfirmacaoConversaoEntradaNfe.aplicarNao(item, produto, avaliacao.resultado, indice, {
        documentoId: Number(documentoId)
      });
      resultadoValidado = {
        ...resultadoValidado,
        ok: recusa.ok,
        quantidade_estoque: recusa.quantidadeEstoque || null,
        codigo: recusa.ok ? null : 'CONVERSAO_RECUSADA_SEM_QUANTIDADE_SEGURA',
        justificativa: recusa.ok
          ? null
          : 'Conversão recusada. Corrija associação ou unidade e reavalie.'
      };
    }

    const registro = ConfirmacaoConversaoEntradaNfe.montarRegistroConversaoPersistente(
      item,
      produto,
      dados.decisao ?? dados.confirmacao,
      resultadoValidado,
      indice,
      documentoId
    );
    registro.selo_conversao = avaliacao.requer && estado !== 'PENDENTE'
      ? avaliacao.pendencia?.selo_conversao || null
      : null;

    itens[indice] = {
      ...item,
      ...xmlOriginal,
      quantidade_comercial: xmlOriginal.qCom,
      unidade_comercial: xmlOriginal.uCom,
      quantidade_tributavel: xmlOriginal.qTrib,
      unidade_tributavel: xmlOriginal.uTrib,
      conversao: registro,
      conversao_decisao: registro.estado,
      confirmacao_conversao: registro.confirmacao
    };

    await this._documentosRepository.atualizar(documentoId, {
      parseJson: {
        ...parseAtual,
        itens
      }
    });

    return {
      sucesso: true,
      documentoId: Number(documentoId),
      indice,
      conversao: registro,
      resultado_backend: resultadoValidado,
      confirmada: resultadoValidado.ok === true && estado === 'SIM'
    };
  }

  /**
   * Correção explícita do produto de uma linha já decidida (após a revisão, antes da compra).
   * Exige o produto que está sendo substituído, motivo e usuário; a conversão da linha
   * volta a pedir confirmação. Mapeamentos fornecedor + código não são alterados.
   *
   * @param {number|string} documentoId
   * @param {number|string} itemIndex
   * @param {{ produtoId, produtoAnteriorId, motivo, usuarioId, chaveAcesso? }} dados
   */
  async corrigirProdutoLinha(documentoId, itemIndex, dados = {}) {
    const resultado = await this.corrigirProdutosLinhas(documentoId, {
      ...dados,
      linhas: [{
        indice: itemIndex,
        produtoId: dados.produtoId ?? dados.produto_id,
        produtoAnteriorId: dados.produtoAnteriorId ?? dados.produto_anterior_id
      }]
    });
    const [linha] = resultado.linhas;
    return { sucesso: true, documentoId: resultado.documentoId, ...linha };
  }

  /**
   * Correção de uma ou mais linhas da mesma NF-e: linha do documento (produto, histórico da linha,
   * confirmação de conversão anterior removida), decisão da sessão de revisão e histórico da Central
   * são gravados numa única transação — tudo ou nada.
   *
   * @param {number|string} documentoId
   * @param {{ linhas: Array<{ indice, produtoId, produtoAnteriorId }>, motivo, usuarioId, chaveAcesso? }} dados
   */
  corrigirProdutosLinhas(documentoId, dados = {}) {
    // Uma correção por vez: evita duas correções disputando a mesma NF-e e o bloqueio de escrita do SQLite.
    const execucao = filaCorrecoes.then(() => this._corrigirProdutosLinhas(documentoId, dados));
    filaCorrecoes = execucao.catch(() => {});
    return execucao;
  }

  /** @private */
  async _corrigirProdutosLinhas(documentoId, dados = {}) {
    const falhar = (statusCode, code, mensagem) => {
      const erro = new Error(mensagem);
      erro.statusCode = statusCode;
      erro.code = code;
      throw erro;
    };
    const idPositivo = (valor) => {
      const n = Number(valor);
      return Number.isInteger(n) && n > 0 ? n : null;
    };

    const usuarioId = idPositivo(dados.usuarioId ?? dados.usuario_id);
    const motivo = String(dados.motivo || '').trim();
    const pedidas = (Array.isArray(dados.linhas) ? dados.linhas : []).map((linha) => {
      const informado = linha?.indice ?? linha?.item_index ?? linha?.itemIndex;
      return {
        informado,
        indice: informado === undefined || informado === null || String(informado).trim() === '' ? NaN : Number(informado),
        produtoNovoId: idPositivo(linha?.produtoId ?? linha?.produto_id),
        produtoAnteriorId: idPositivo(linha?.produtoAnteriorId ?? linha?.produto_anterior_id)
      };
    });

    if (!usuarioId) falhar(401, 'USUARIO_OBRIGATORIO', 'Correção de produto exige usuário identificado.');
    if (!pedidas.length) falhar(400, 'LINHAS_OBRIGATORIAS', 'Informe a linha a corrigir.');
    pedidas.forEach((p) => {
      if (!p.produtoNovoId) falhar(400, 'PRODUTO_OBRIGATORIO', 'Informe o produto correto.');
      if (!p.produtoAnteriorId) falhar(400, 'PRODUTO_ANTERIOR_OBRIGATORIO', 'Informe o produto que está sendo substituído.');
    });
    if (motivo.length < MOTIVO_CORRECAO_MINIMO) {
      falhar(422, 'MOTIVO_OBRIGATORIO', `Explique o motivo da troca (mínimo ${MOTIVO_CORRECAO_MINIMO} caracteres).`);
    }
    if (new Set(pedidas.map((p) => p.indice)).size !== pedidas.length) {
      falhar(400, 'LINHA_REPETIDA', 'A mesma linha foi informada mais de uma vez.');
    }

    const documento = await this._documentosRepository.buscarPorId(documentoId);
    if (!documento) falhar(404, 'DOCUMENTO_CENTRAL_NAO_ENCONTRADO', 'Documento não encontrado');
    const chaveInformada = String(dados.chaveAcesso ?? dados.chave_acesso ?? '').replace(/\D/g, '');
    if (chaveInformada && chaveInformada !== String(documento.chave || '').replace(/\D/g, '')) {
      falhar(422, 'DOCUMENTO_CENTRAL_DIVERGENTE', 'A chave de acesso não corresponde ao documento da Central.');
    }
    const status = normalizarStatus(documento.status);
    if (
      documento.compraId || documento.compra_id
      || status === DocumentoFiscalStatus.IMPORTADA
      || status === DocumentoFiscalStatus.FINALIZADA
    ) {
      falhar(409, 'DOCUMENTO_JA_IMPORTADO', 'Esta NF-e já foi lançada em compras; o produto não pode mais ser trocado aqui.');
    }
    if (status === DocumentoFiscalStatus.EM_REVISAO) {
      falhar(409, 'DOCUMENTO_EM_REVISAO', 'A NF-e ainda está em revisão: escolha o produto na própria revisão.');
    }
    if (status !== DocumentoFiscalStatus.PRONTA_IMPORTACAO && status !== DocumentoFiscalStatus.EM_IMPORTACAO) {
      falhar(409, 'STATUS_NAO_PERMITE_CORRECAO', `O produto não pode ser corrigido no status atual (${documento.status}).`);
    }

    const db = this._db || dbPadrao;
    const consultar = (sql, params) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
    const docId = Number(documento.id);
    // Texto bruto do parse: base da gravação condicional (só grava se ninguém mudou a NF-e no meio).
    const [bruto] = await consultar('SELECT parse_json, status FROM central_entradas_documentos WHERE id = ?', [docId]);
    const parseTexto = bruto?.parse_json ?? null;
    let parseAtual = {};
    try {
      parseAtual = parseTexto ? JSON.parse(parseTexto) : {};
    } catch {
      parseAtual = {};
    }
    const itens = Array.isArray(parseAtual.itens) ? parseAtual.itens.slice() : [];
    pedidas.forEach((p) => {
      if (!Number.isInteger(p.indice) || p.indice < 0 || p.indice >= itens.length) {
        falhar(400, 'LINHA_CENTRAL_INEXISTENTE', `Linha ${p.informado} não existe nesta NF-e.`);
      }
    });

    const decisoes = montarDecisoesProduto(itens, await consultar(SQL_DECISOES_SESSAO, [docId]));
    pedidas.forEach((p) => {
      const atual = decisoes.get(p.indice);
      if (!atual) {
        falhar(409, 'LINHA_SEM_PRODUTO_DECIDIDO', 'Esta linha não tem produto decidido na Central; escolha o produto na compra.');
      }
      if (atual.produtoId !== p.produtoAnteriorId) {
        falhar(
          409,
          'DECISAO_ALTERADA',
          `A linha está associada ao produto #${atual.produtoId}, não ao #${p.produtoAnteriorId}. Atualize a tela e tente novamente.`
        );
      }
    });

    const alteradas = pedidas.filter((p) => p.produtoNovoId !== decisoes.get(p.indice).produtoId);
    const produtos = await this._carregarProdutosItens(alteradas.map((p) => ({ produto_id: p.produtoNovoId })));
    alteradas.forEach((p) => {
      const produto = produtos.get(p.produtoNovoId);
      if (!produto) falhar(422, 'PRODUTO_INEXISTENTE', `Produto #${p.produtoNovoId} não encontrado.`);
      if (produto.ativo !== undefined && produto.ativo !== null && Number(produto.ativo) !== 1) {
        falhar(422, 'PRODUTO_INATIVO', `Produto #${p.produtoNovoId} está desativado.`);
      }
    });

    const [sessao] = await consultar(
      `SELECT id FROM central_entradas_revisao_sessoes
       WHERE documento_id = ? AND status <> 'CANCELADA' ORDER BY id DESC LIMIT 1`,
      [docId]
    );
    const em = new Date().toISOString();
    const correcoes = [];
    for (const p of alteradas) {
      const registro = {
        produto_anterior_id: p.produtoAnteriorId,
        produto_id: p.produtoNovoId,
        motivo: motivo.slice(0, 500),
        usuario_id: usuarioId,
        em
      };
      const existente = sessao ? await this._itensRepository.buscarPorSessaoEIndice(sessao.id, p.indice) : null;
      const dadosAnteriores = existente?.dadosJson && typeof existente.dadosJson === 'object' ? existente.dadosJson : {};
      const linha = {
        ...(itens[p.indice] || {}),
        produto_id: p.produtoNovoId,
        correcoes_produto: [...(itens[p.indice]?.correcoes_produto || []), registro]
      };
      // A confirmação de conversão valia para o produto anterior.
      delete linha.conversao;
      delete linha.conversao_decisao;
      delete linha.confirmacao_conversao;
      itens[p.indice] = linha;
      correcoes.push({ p, registro, existente, dadosAnteriores });
    }

    if (correcoes.length) {
      const novoParseTexto = JSON.stringify({ ...parseAtual, itens });
      let conexao = null;
      try {
        conexao = await abrirConexaoTransacao(db);
        const itensRepository = conexao ? new CentralRevisaoItensRepository({ db: conexao }) : this._itensRepository;
        const historicoRepository = conexao ? new CentralHistoricoRepository({ db: conexao }) : this._historicoRepository;
        await executarEmTransacao(async (tx) => {
          const atualizado = await new Promise((resolve, reject) => {
            tx.run(
              `UPDATE central_entradas_documentos SET parse_json = ?, updated_at = datetime('now')
               WHERE id = ? AND compra_id IS NULL AND status IS ? AND parse_json IS ?`,
              [novoParseTexto, docId, bruto?.status ?? null, parseTexto],
              function aoAtualizar(err) { return err ? reject(err) : resolve(this.changes); }
            );
          });
          if (atualizado !== 1) {
            falhar(409, 'DECISAO_ALTERADA', 'A NF-e foi alterada enquanto a troca era gravada. Atualize a tela e tente novamente.');
          }
          for (const { p, registro, existente, dadosAnteriores } of correcoes) {
            if (sessao) {
              await itensRepository.upsert({
                sessaoId: sessao.id,
                documentoId: docId,
                itemIndex: p.indice,
                produtoOrigem: existente?.produtoOrigem ?? itens[p.indice]?.produto_nome ?? null,
                produtoDestinoId: p.produtoNovoId,
                decisao: existente?.decisao || DECISOES.ASSOCIAR,
                status: 'CONCLUIDO',
                usuarioId,
                dadosJson: {
                  ...dadosAnteriores,
                  produto_id: p.produtoNovoId,
                  correcoes_produto: [...(dadosAnteriores.correcoes_produto || []), registro]
                }
              });
            }
            await historicoRepository.inserir({
              documentoId: docId,
              statusAnterior: documento.status,
              statusNovo: documento.status,
              usuarioId,
              detalhe: `Produto da linha ${itens[p.indice]?.nItem ?? p.indice + 1} corrigido: `
                + `#${registro.produto_anterior_id} → #${registro.produto_id}. Motivo: ${registro.motivo}`
            });
          }
        }, { db: conexao || db });
      } catch (err) {
        await fecharConexao(conexao);
        conexao = null;
        if (err.code === 'DECISAO_ALTERADA') throw err;
        // Erro no COMMIT não prova que nada ficou gravado: confere no banco antes de responder.
        const [persistido] = await consultar('SELECT parse_json FROM central_entradas_documentos WHERE id = ?', [docId])
          .catch(() => [null]);
        const gravada = persistido?.parse_json === novoParseTexto;
        console.error('[CentralRevisao][corrigir-produto] transação desfeita', {
          documentoId: docId,
          erro: err.message,
          estado: persistido ? (gravada ? 'GRAVADA' : 'INALTERADA') : 'INDETERMINADO'
        });
        if (!persistido || gravada) {
          falhar(500, 'CORRECAO_ESTADO_INDETERMINADO', 'Não foi possível confirmar se a troca foi gravada. Atualize a tela e confira a NF-e antes de repetir.');
        }
        falhar(500, 'CORRECAO_NAO_GRAVADA', 'A troca do produto não foi gravada e nada foi alterado. Tente novamente.');
      } finally {
        await fecharConexao(conexao);
      }
    }

    const linhas = pedidas.map((p) => {
      const correcao = correcoes.find((c) => c.p === p);
      if (!correcao) return { indice: p.indice, alterado: false, produto_id: p.produtoNovoId };
      const avaliacao = ConfirmacaoConversaoEntradaNfe.avaliarLinha(itens[p.indice], produtos.get(p.produtoNovoId), p.indice, {
        documentoId: docId,
        chaveAcesso: documento.chave || null
      });
      return {
        indice: p.indice,
        alterado: true,
        produto_anterior_id: correcao.registro.produto_anterior_id,
        produto_id: p.produtoNovoId,
        requer_nova_confirmacao_conversao: Boolean(avaliacao.requer),
        correcao: correcao.registro
      };
    });
    if (correcoes.length) {
      console.info('[CentralRevisao][corrigir-produto]', {
        documentoId: docId,
        linhas: correcoes.map((c) => ({ indice: c.p.indice, de: c.registro.produto_anterior_id, para: c.registro.produto_id })),
        usuarioId
      });
    }
    return { sucesso: true, documentoId: docId, linhas };
  }

  /**
   * @private
   */
  _carregarProdutosItens(itens) {
    const db = this._db || dbPadrao;
    const ids = [...new Set((itens || [])
      .map((item) => Number(item?.produto_id || item?.produtoId || 0))
      .filter((id) => id > 0))];
    if (!ids.length) return Promise.resolve(new Map());
    return new Promise((resolve, reject) => {
      const ph = ids.map(() => '?').join(',');
      db.all(`SELECT * FROM produtos WHERE id IN (${ph})`, ids, (err, rows) => {
        if (err) return reject(err);
        const mapa = new Map();
        (rows || []).forEach((row) => mapa.set(Number(row.id), row));
        resolve(mapa);
      });
    });
  }
}

CentralRevisaoPersistenteService.DECISOES = DECISOES;
CentralRevisaoPersistenteService.normalizarDecisao = normalizarDecisao;

module.exports = CentralRevisaoPersistenteService;
