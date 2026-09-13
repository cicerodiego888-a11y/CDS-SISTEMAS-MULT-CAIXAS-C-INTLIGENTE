/**
 * MUC RC2.1 — Motor Universal de Conversão (facade oficial)
 * @module motores/muc
 */
'use strict';

const MotorConversao = require('./core/MotorConversao');
const PipelineMuc = require('./pipeline/PipelineMuc');
const { criarConversaoDTO } = require('./dto/ConversaoDTO');
const { criarResultadoConversaoDTO, resultadoParaJson, resultadoFromJson } = require('./dto/ResultadoConversaoDTO');
const {
  criarProdutoApresentacaoDTO,
  criarProdutoApresentacaoLegadoDTO,
  criarListaProdutoApresentacaoDTO
} = require('./dto/ProdutoApresentacaoDTO');
const { criarRegraConversaoDTO } = require('./dto/RegraConversaoDTO');
const { parseApresentacaoRow, parseApresentacaoLegadoProduto, parseListaApresentacoes } = require('./core/ParserApresentacoes');
const { inferirConversao } = require('./core/MotorInferencia');
const { RepositorioApresentacoes } = require('./repositorios/RepositorioApresentacoes');
const { RepositorioHistorico } = require('./repositorios/RepositorioHistorico');
const { AuditoriaConversao } = require('./auditoria/AuditoriaConversao');
const { MotorAprendizado } = require('./aprendizado/MotorAprendizado');
const { garantirSchemaMuc } = require('./schema/mucSchema');
const BarramentoEventos = require('./eventos/BarramentoEventos');
const MucMetricas = require('./observabilidade/MucMetricas');
const { MotorCacheConversao } = require('./cache/MotorCacheConversao');
const { resolverRegra, CATALOGO_REGRAS } = require('./constants/catalogoRegras');
const VERSAO = require('./version');

/** @deprecated Uso interno — consumidores devem usar obterMuc() */
const EVENTOS_PUBLICOS = Object.freeze([...BarramentoEventos.EVENTOS]);

let _instancia = null;

class MotorUniversalConversao {
  constructor(db) {
    this.db = db;
    this.apresentacoes = new RepositorioApresentacoes(db);
    this.historico = new RepositorioHistorico(db);
    this.auditoria = new AuditoriaConversao(db);
    this.aprendizado = new MotorAprendizado(db);
    this.cache = new MotorCacheConversao();
    this.eventos = BarramentoEventos;
    this.metricas = MucMetricas;
  }

  /** @public API — converter(input, opcoes?) → ResultadoConversaoDTO */
  converter(input, opcoes = {}) {
    if (opcoes.usarCache) {
      return this.cache.executar(input, (inp) => PipelineMuc.executar(inp, opcoes));
    }
    return PipelineMuc.executar(input, opcoes);
  }

  /** @public API — processarItemCompra(item, produto, opcoes?, callback?) → ResultadoConversaoDTO */
  processarItemCompra(item, produto, opcoes = {}, callback) {
    const self = this;
    const produtoId = item.produto_id || produto?.id;
    const apresentacaoId = item.produto_apresentacao_id || item.embalagem_id;

    const executar = (apresentacao) => {
      const resultado = self.converter({
        produtoId,
        apresentacaoId: apresentacao?.id ?? apresentacaoId,
        apresentacao,
        produto,
        item,
        origem: item.origem_conversao || opcoes.origem || 'MANUAL',
        origemDados: 'COMPRA_ITEM'
      }, {
        fornecedorCnpj: opcoes.fornecedorCnpj || item.fornecedor_cnpj,
        gtin: item.codigo_barras,
        codigoFornecedor: item.codigo_fornecedor,
        descricao: item.produto_nome,
        usuarioId: opcoes.usuarioId,
        usuarioNome: opcoes.usuarioNome,
        correlationId: opcoes.correlationId
      });

      self.auditoria.registrar(resultado, {
        gtin: item.codigo_barras,
        fornecedorCnpj: opcoes.fornecedorCnpj || item.fornecedor_cnpj,
        codigoFornecedor: item.codigo_fornecedor,
        descricao: item.produto_nome,
        usuarioId: opcoes.usuarioId,
        usuarioNome: opcoes.usuarioNome
      });

      if (produtoId && opcoes.registrarAprendizado !== false) {
        self.aprender({
          produtoId,
          apresentacaoId: resultado.apresentacaoId,
          fornecedorCnpj: opcoes.fornecedorCnpj || item.fornecedor_cnpj,
          gtin: item.codigo_barras,
          codigoFornecedor: item.codigo_fornecedor,
          tipoApresentacao: resultado.unidadeCompra,
          fatorConversao: resultado.fatorConversao,
          tipoConversao: resultado.tipoConversao,
          confianca: resultado.confianca,
          descricao: item.produto_nome
        });
      }

      if (callback) callback(null, resultado);
      return resultado;
    };

    if (apresentacaoId) {
      return this.apresentacoes.buscarPorId(apresentacaoId, (err, ap) => {
        if (err && callback) return callback(err);
        return executar(ap);
      });
    }

    if (produtoId && (item.codigo_barras || item.codigo_fornecedor)) {
      return this.apresentacoes.resolverPorIdentificador(
        produtoId,
        {
          gtin: item.codigo_barras,
          codigo_fornecedor: item.codigo_fornecedor,
          fornecedor_cnpj: opcoes.fornecedorCnpj || item.fornecedor_cnpj
        },
        (err, ap) => {
          if (err && callback) return callback(err);
          return executar(ap);
        }
      );
    }

    return executar(null);
  }

  /** @public API — simular({ quantidadeCompra, quantidadePorApresentacao, valorTotal }) → ResultadoConversaoDTO */
  simular(input) {
    return MotorConversao.simularConversao(input);
  }

  /** @public API — buscarApresentacao(criterio, callback) → ProdutoApresentacaoDTO|null */
  buscarApresentacao(criterio = {}, callback) {
    const done = typeof callback === 'function' ? callback : () => {};

    if (criterio.apresentacaoId) {
      return this.apresentacoes.buscarPorId(criterio.apresentacaoId, done);
    }

    if (criterio.produtoId) {
      if (criterio.gtin || criterio.codigoFornecedor || criterio.codigo_fornecedor) {
        return this.apresentacoes.resolverPorIdentificador(
          criterio.produtoId,
          {
            gtin: criterio.gtin,
            codigo_fornecedor: criterio.codigoFornecedor || criterio.codigo_fornecedor,
            fornecedor_cnpj: criterio.fornecedorCnpj || criterio.fornecedor_cnpj
          },
          done
        );
      }
      return this.apresentacoes.listarPorProduto(criterio.produtoId, (err, lista) => {
        if (err) return done(err);
        const principal = (lista || []).find((a) => a.principal) || lista?.[0] || null;
        done(null, principal);
      });
    }

    return done(null, null);
  }

  /** @public API — aprender(dados, callback?) */
  aprender(dados = {}, callback) {
    const done = typeof callback === 'function' ? callback : () => {};
    return this.aprendizado.registrar(dados, (err) => {
      if (!err) {
        BarramentoEventos.registrar('MUC_APRESENTACAO_APRENDIDA', {
          produtoId: dados.produtoId,
          apresentacaoId: dados.apresentacaoId
        });
      }
      done(err);
    });
  }

  /** @public API — exportarMetricas(formato?) → string */
  exportarMetricas(formato = 'json') {
    return formato === 'markdown' ? MucMetricas.exportarMarkdown() : MucMetricas.exportarJson();
  }

  /** @public API — obterVersao() → Readonly<Object> */
  obterVersao() {
    return Object.freeze({ ...VERSAO });
  }

  // --- Métodos legados (compat RC1/RC2 — não documentados como API pública RC2.1) ---

  converterComAuditoria(input, contexto = {}, callback) {
    const resultado = this.converter(input, contexto);
    this.auditoria.registrar(resultado, contexto, (audErr) => {
      if (audErr) console.warn('[MUC] auditoria:', audErr.message);
      BarramentoEventos.registrar('MUC_CONVERSAO_CONFIRMADA', {
        produtoId: resultado.produtoId,
        correlationId: resultado.correlationId
      }, resultado.correlationId);
      if (callback) callback(audErr, resultado);
    });
    return resultado;
  }

  validarDistribuicao(input) { return MotorConversao.validarDistribuicao(input); }
  resolverQuantidadesEstoque(input) { return MotorConversao.resolverQuantidadesEstoque(input); }
  resolverPrecosAposCompra(input) { return MotorConversao.resolverPrecosAposCompra(input); }
  calcularSubtotal(input) { return MotorConversao.calcularSubtotal(input); }
  simularConversao(input) { return this.simular(input); }
  calcularFormacaoPrecoCadastro(input) { return MotorConversao.calcularFormacaoPrecoCadastro(input); }
}

function obterMuc(db) {
  if (!_instancia || _instancia.db !== db) {
    _instancia = new MotorUniversalConversao(db);
  }
  return _instancia;
}

module.exports = {
  obterMuc,
  VERSAO,
  EVENTOS_PUBLICOS,
  criarConversaoDTO,
  criarResultadoConversaoDTO,
  criarProdutoApresentacaoDTO,
  criarProdutoApresentacaoLegadoDTO,
  criarListaProdutoApresentacaoDTO,
  criarRegraConversaoDTO,
  resultadoParaJson,
  resultadoFromJson,
  // @internal — exposto apenas para testes de certificação RC1/RC2 e bootstrap
  MotorUniversalConversao,
  PipelineMuc,
  MotorConversao,
  parseApresentacaoRow,
  parseApresentacaoLegadoProduto,
  parseListaApresentacoes,
  inferirConversao,
  RepositorioApresentacoes,
  RepositorioHistorico,
  AuditoriaConversao,
  MotorAprendizado,
  garantirSchemaMuc,
  BarramentoEventos,
  MucMetricas,
  MotorCacheConversao,
  resolverRegra,
  CATALOGO_REGRAS,
  ProdutoApresentacao: {
    parse: parseApresentacaoRow,
    parseLegado: parseApresentacaoLegadoProduto
  }
};
