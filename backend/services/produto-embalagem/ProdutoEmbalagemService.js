/**
 * Serviço — Apresentações comerciais (ProdutoApresentacao)
 * Tabela física: produto_embalagens (compatibilidade retroativa)
 * @module services/produto-embalagem/ProdutoEmbalagemService
 */

'use strict';

const {
  normalizarTipoApresentacao,
  tipoParaUnidadeComercial,
  TIPOS_APRESENTACAO
} = require('./tiposApresentacao');
const { inferirTipoConversao, normalizarTipoConversao } = require('../../motores/muc/constants/tiposConversao');
const { criarProdutoApresentacaoDTO } = require('../../motores/muc');

function num(v, casas = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

function normalizarEmbalagemInput(raw = {}, unidadeProduto = 'un') {
  const tipo = normalizarTipoApresentacao(raw.tipo);
  const quantidade = num(raw.quantidade ?? raw.quantidade_por_embalagem, 3);
  return {
    id: raw.id ? Number(raw.id) : null,
    tipo,
    descricao: raw.descricao ? String(raw.descricao).trim() : null,
    quantidade: quantidade > 0 ? quantidade : 1,
    unidade: String(raw.unidade || unidadeProduto || 'un').trim().toLowerCase(),
    gtin: raw.gtin ? String(raw.gtin).trim() : (raw.codigo_barras ? String(raw.codigo_barras).trim() : null),
    codigo_fornecedor: raw.codigo_fornecedor ? String(raw.codigo_fornecedor).trim() : null,
    codigo_interno_fornecedor: raw.codigo_interno_fornecedor ? String(raw.codigo_interno_fornecedor).trim() : null,
    fornecedor_cnpj: raw.fornecedor_cnpj ? String(raw.fornecedor_cnpj).replace(/\D/g, '') : null,
    fornecedor_nome: raw.fornecedor_nome ? String(raw.fornecedor_nome).trim() : null,
    fornecedor_descricao: raw.fornecedor_descricao ? String(raw.fornecedor_descricao).trim() : null,
    valor_compra: num(raw.valor_compra ?? raw.valor_compra_embalagem, 2),
    preco_venda: num(raw.preco_venda ?? raw.valor_embalagem_venda, 2),
    tipo_conversao: normalizarTipoConversao(
      raw.tipo_conversao || raw.tipoConversao
        || inferirTipoConversao(normalizarTipoApresentacao(raw.tipo), raw.unidade || unidadeProduto)
    ),
    principal: Number(raw.principal || 0) === 1 ? 1 : 0,
    compra: raw.compra === undefined || raw.compra === null || Number(raw.compra) === 1 ? 1 : 0,
    venda: raw.venda === undefined || raw.venda === null || Number(raw.venda) === 1 ? 1 : 0,
    estoque: raw.estoque === undefined || raw.estoque === null || Number(raw.estoque) === 1 ? 1 : 0,
    ativa: raw.ativa === undefined || raw.ativa === null || Number(raw.ativa) === 1 ? 1 : 0,
    vigencia_inicio: raw.vigencia_inicio || raw.vigenciaInicio || null,
    vigencia_fim: raw.vigencia_fim || raw.vigenciaFim || null,
    origem: raw.origem || 'CADASTRO',
    observacao: raw.observacao ? String(raw.observacao).trim() : null,
    motivo_alteracao: raw.motivo_alteracao || raw.motivoAlteracao || null
  };
}

function validarListaEmbalagens(embalagens) {
  const lista = Array.isArray(embalagens) ? embalagens : [];
  const erros = [];

  lista.forEach((emb, idx) => {
    const tipo = normalizarTipoApresentacao(emb.tipo);
    if (!TIPOS_APRESENTACAO.includes(tipo)) {
      erros.push(`Apresentação ${idx + 1}: tipo inválido.`);
    }
    if (tipo !== 'UN' && num(emb.quantidade, 3) <= 0) {
      erros.push(`Apresentação ${idx + 1}: informe a quantidade de conversão.`);
    }
  });

  const principais = lista.filter((e) => Number(e.principal) === 1);
  if (lista.length > 0 && principais.length === 0) {
    lista[0].principal = 1;
  } else if (principais.length > 1) {
    let marcado = false;
    lista.forEach((e) => {
      if (Number(e.principal) === 1) {
        if (marcado) e.principal = 0;
        else marcado = true;
      }
    });
  }

  return { ok: erros.length === 0, erros, lista };
}

function normalizarEmbalagemResposta(row) {
  if (!row) return null;
  const parsed = criarProdutoApresentacaoDTO(row);
  return parsed ? {
    ...parsed,
    ...row,
    unidade_comercial: tipoParaUnidadeComercial(row.tipo),
    quantidade_por_embalagem: num(row.quantidade, 3),
    valor_compra_embalagem: num(row.valor_compra, 2),
    valor_embalagem_venda: num(row.preco_venda, 2)
  } : null;
}

class ProdutoEmbalagemService {
  constructor(db) {
    this.db = db;
  }

  listarPorProduto(produtoId, callback) {
    this.db.all(
      `SELECT * FROM produto_embalagens
       WHERE produto_id = ?
       ORDER BY principal DESC, compra DESC, id ASC`,
      [produtoId],
      (err, rows) => {
        if (err) return callback(err);
        callback(null, (rows || []).map(normalizarEmbalagemResposta));
      }
    );
  }

  listarHistorico(embalagemId, callback) {
    this.db.all(
      `SELECT * FROM produto_embalagem_historico
       WHERE embalagem_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [embalagemId],
      callback
    );
  }

  /**
   * @param {object} [opcoes]
   * @param {boolean} [opcoes.usarTransacao=true] — false quando já houver TX externa (ex.: importação)
   */
  sincronizarEmbalagensProduto(produtoId, embalagensRaw, unidadeProduto, usuario, callback, opcoes = {}) {
    const usarTransacao = opcoes.usarTransacao !== false;
    const validacao = validarListaEmbalagens(
      (Array.isArray(embalagensRaw) ? embalagensRaw : []).map((e) =>
        normalizarEmbalagemInput(e, unidadeProduto)
      )
    );

    if (!validacao.ok) {
      return callback(new Error(validacao.erros.join(' ')));
    }

    const lista = validacao.lista;
    const svc = this;

    const abortar = (err) => {
      if (!usarTransacao) return callback(err);
      svc.db.run('ROLLBACK', () => callback(err));
    };

    this.listarPorProduto(produtoId, (listErr, antigas) => {
      if (listErr) return callback(listErr);

      const executarSync = () => {
        svc.registrarAuditoriaPermissoesEmbalagens(antigas || [], lista, usuario);

        svc.db.run(
          `DELETE FROM produto_embalagens WHERE produto_id = ?`,
          [produtoId],
          (delErr) => {
            if (delErr) return abortar(delErr);

            if (lista.length === 0) {
              return svc.finalizarSync(produtoId, [], usuario, callback, { usarTransacao });
            }

            let indice = 0;
            const inseridas = [];

            const inserirProxima = () => {
              if (indice >= lista.length) {
                return svc.finalizarSync(produtoId, inseridas, usuario, callback, { usarTransacao });
              }

              const emb = lista[indice];
              indice += 1;

              svc.db.run(
                `INSERT INTO produto_embalagens (
                  produto_id, tipo, descricao, quantidade, unidade, gtin,
                  codigo_fornecedor, codigo_interno_fornecedor,
                  fornecedor_cnpj, fornecedor_nome, fornecedor_descricao,
                  valor_compra, preco_venda, tipo_conversao,
                  principal, compra, venda, estoque, ativa,
                  vigencia_inicio, vigencia_fim, origem,
                  usuario_criacao, observacao, motivo_alteracao,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  datetime('now', 'localtime'), datetime('now', 'localtime'))`,
                [
                  produtoId,
                  emb.tipo,
                  emb.descricao,
                  emb.quantidade,
                  emb.unidade,
                  emb.gtin,
                  emb.codigo_fornecedor,
                  emb.codigo_interno_fornecedor,
                  emb.fornecedor_cnpj,
                  emb.fornecedor_nome,
                  emb.fornecedor_descricao,
                  emb.valor_compra,
                  emb.preco_venda,
                  emb.tipo_conversao,
                  emb.principal,
                  emb.compra,
                  emb.venda,
                  emb.estoque,
                  emb.ativa,
                  emb.vigencia_inicio || null,
                  emb.vigencia_fim || null,
                  emb.origem || 'CADASTRO',
                  usuario?.id || null,
                  emb.observacao || null,
                  emb.motivo_alteracao || null
                ],
                function onInsert(err) {
                  if (err) return abortar(err);
                  inseridas.push({ ...emb, id: this.lastID });
                  inserirProxima();
                }
              );
            };

            inserirProxima();
          }
        );
      };

      svc.db.serialize(() => {
        if (!usarTransacao) {
          executarSync();
          return;
        }
        svc.db.run('BEGIN TRANSACTION', (beginErr) => {
          if (beginErr) return callback(beginErr);
          executarSync();
        });
      });
    });
  }

  registrarAuditoriaPermissoesEmbalagens(antigas, novas, usuario) {
    const { RepositorioHistorico } = require('../../motores/muc/repositorios/RepositorioHistorico');
    const repo = new RepositorioHistorico(this.db);
    const chave = (emb) => `${String(emb.tipo || '').toUpperCase()}|${Number(emb.quantidade || 0)}`;

    antigas.forEach((ant) => {
      const nova = (novas || []).find((n) => n.id && ant.id && Number(n.id) === Number(ant.id))
        || (novas || []).find((n) => chave(n) === chave(ant));
      if (!nova) return;
      if (Number(ant.compra) !== Number(nova.compra)) {
        repo.registrarAlteracao(ant.id, 'compra', ant.compra, nova.compra, usuario);
        console.log('[AUDIT EMBALAGEM] compra alterada', {
          embalagem_id: ant.id,
          tipo: ant.tipo,
          de: ant.compra,
          para: nova.compra,
          usuario: usuario?.nome || usuario?.username || null
        });
      }
      if (Number(ant.venda) !== Number(nova.venda)) {
        repo.registrarAlteracao(ant.id, 'venda', ant.venda, nova.venda, usuario);
        console.log('[AUDIT EMBALAGEM] venda alterada', {
          embalagem_id: ant.id,
          tipo: ant.tipo,
          de: ant.venda,
          para: nova.venda,
          usuario: usuario?.nome || usuario?.username || null
        });
      }
    });
  }

  /**
   * RC4.31.12.9 — insere UC aprendida na compra com auditoria dedicada.
   */
  adicionarApresentacaoAprendizagemCompra(produtoId, dadosRaw, unidadeProduto, usuario, callback) {
    const emb = normalizarEmbalagemInput({
      ...dadosRaw,
      origem: 'COMPRA_APRENDIZAGEM',
      ativa: 1,
      estoque: dadosRaw?.estoque ?? 1
    }, unidadeProduto);

    if (!String(emb.descricao || '').trim()) {
      return callback(new Error('Informe a descrição da unidade comercial.'));
    }
    if (emb.tipo !== 'UN' && num(emb.quantidade, 3) <= 0) {
      return callback(new Error('Informe a quantidade de conversão.'));
    }
    if (Number(emb.compra) !== 1 && Number(emb.venda) !== 1) {
      return callback(new Error('Selecione ao menos Compras ou Vendas em Utilizar em.'));
    }

    this.listarPorProduto(produtoId, (listErr, existentes) => {
      if (listErr) return callback(listErr);

      const jaTemPrincipal = (existentes || []).some((e) => Number(e.principal) === 1);
      if (!jaTemPrincipal) {
        emb.principal = 1;
      }

      const svc = this;
      this.db.run(
        `INSERT INTO produto_embalagens (
          produto_id, tipo, descricao, quantidade, unidade, gtin,
          codigo_fornecedor, codigo_interno_fornecedor,
          fornecedor_cnpj, fornecedor_nome, fornecedor_descricao,
          valor_compra, preco_venda, tipo_conversao,
          principal, compra, venda, estoque, ativa,
          vigencia_inicio, vigencia_fim, origem,
          usuario_criacao, observacao, motivo_alteracao,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          datetime('now', 'localtime'), datetime('now', 'localtime'))`,
        [
          produtoId,
          emb.tipo,
          emb.descricao,
          emb.quantidade,
          emb.unidade,
          emb.gtin,
          emb.codigo_fornecedor,
          emb.codigo_interno_fornecedor,
          emb.fornecedor_cnpj,
          emb.fornecedor_nome,
          emb.fornecedor_descricao,
          emb.valor_compra,
          emb.preco_venda,
          emb.tipo_conversao,
          emb.principal,
          emb.compra,
          emb.venda,
          emb.estoque,
          emb.ativa,
          emb.vigencia_inicio || null,
          emb.vigencia_fim || null,
          emb.origem || 'COMPRA_APRENDIZAGEM',
          usuario?.id || null,
          emb.observacao || null,
          emb.motivo_alteracao || null
        ],
        function onInsert(err) {
          if (err) return callback(err);

          const embalagemId = this.lastID;
          const inserida = normalizarEmbalagemResposta({ ...emb, id: embalagemId, produto_id: produtoId });
          const metaAuditoria = JSON.stringify({
            produto_id: produtoId,
            descricao: emb.descricao,
            quantidade: emb.quantidade,
            unidade: emb.unidade,
            compra: emb.compra,
            venda: emb.venda,
            origem: 'COMPRA_APRENDIZAGEM',
            fator_conversao: emb.quantidade
          });

          const { RepositorioHistorico } = require('../../motores/muc/repositorios/RepositorioHistorico');
          const repo = new RepositorioHistorico(svc.db);
          repo.registrarAlteracao(
            embalagemId,
            'APRENDIZAGEM_COMPRA',
            null,
            metaAuditoria,
            usuario,
            (histErr) => {
              if (histErr) {
                console.error('[ProdutoEmbalagem] auditoria aprendizagem:', histErr.message);
              }

              svc.listarPorProduto(produtoId, (reloadErr, lista) => {
                if (reloadErr) return callback(reloadErr);
                svc.sincronizarCamposLegadoProduto(produtoId, lista, (syncErr) => {
                  if (syncErr) return callback(syncErr);
                  callback(null, inserida);
                });
              });
            }
          );
        }
      );
    });
  }

  finalizarSync(produtoId, inseridas, usuario, callback, opcoes = {}) {
    const usarTransacao = opcoes.usarTransacao !== false;
    this.sincronizarCamposLegadoProduto(produtoId, inseridas, (syncErr) => {
      if (syncErr) {
        if (usarTransacao) this.db.run('ROLLBACK');
        return callback(syncErr);
      }

      if (!usarTransacao) {
        return callback(null, inseridas.map(normalizarEmbalagemResposta));
      }

      this.db.run('COMMIT', (commitErr) => {
        if (commitErr) {
          this.db.run('ROLLBACK');
          return callback(commitErr);
        }
        callback(null, inseridas.map(normalizarEmbalagemResposta));
      });
    });
  }

  /**
   * Mantém compatibilidade com compras/vendas/estoque que leem campos legados em produtos.
   */
  sincronizarCamposLegadoProduto(produtoId, embalagens, callback) {
    this.db.get(
      'SELECT compra_por_embalagem FROM produtos WHERE id = ?',
      [produtoId],
      (selErr, prodRow) => {
        if (selErr) return callback(selErr);

        const compraPorEmbProduto = Number(prodRow?.compra_por_embalagem || 0) === 1;
        const ativas = (embalagens || []).filter((e) => Number(e.ativa) === 1);
        const principal = ativas.find((e) => Number(e.principal) === 1)
          || ativas.find((e) => Number(e.compra) === 1)
          || ativas[0]
          || null;

        if (!compraPorEmbProduto || !principal || normalizarTipoApresentacao(principal.tipo) === 'UN') {
          return this.db.run(
            `UPDATE produtos SET
               unidade_comercial = 'UN',
               quantidade_por_embalagem = 0,
               valor_compra_embalagem = 0,
               updated_at = datetime('now', 'localtime')
             WHERE id = ?`,
            [produtoId],
            callback
          );
        }

        const uc = tipoParaUnidadeComercial(principal.tipo);
        const qpe = num(principal.quantidade, 3);
        const valorEmb = num(principal.valor_compra, 2);

        this.db.run(
          `UPDATE produtos SET
             unidade_comercial = ?,
             quantidade_por_embalagem = ?,
             valor_compra_embalagem = ?,
             updated_at = datetime('now', 'localtime')
           WHERE id = ?`,
          [uc, qpe, valorEmb, produtoId],
          callback
        );
      }
    );
  }

  /**
   * Resolve apresentação para compra/venda por GTIN ou código fornecedor.
   */
  resolverPorIdentificador(produtoId, { gtin, codigo_fornecedor, fornecedor_cnpj }, callback) {
    const gtinNorm = gtin ? String(gtin).trim() : null;
    const codForn = codigo_fornecedor ? String(codigo_fornecedor).trim() : null;
    const cnpj = fornecedor_cnpj ? String(fornecedor_cnpj).replace(/\D/g, '') : null;

    if (gtinNorm) {
      this.db.get(
        `SELECT * FROM produto_embalagens
         WHERE produto_id = ? AND ativa = 1 AND gtin = ?
         LIMIT 1`,
        [produtoId, gtinNorm],
        (err, row) => {
          if (err) return callback(err);
          if (row) return callback(null, normalizarEmbalagemResposta(row));
          buscarPorCodigoFornecedor.call(this);
        }
      );
      return;
    }

    buscarPorCodigoFornecedor.call(this);

    function buscarPorCodigoFornecedor() {
      if (!codForn) {
        return this.listarPorProduto(produtoId, (listErr, lista) => {
          if (listErr) return callback(listErr);
          const principal = (lista || []).find((e) => Number(e.principal) === 1) || lista[0] || null;
          callback(null, principal);
        });
      }

      const params = [produtoId, codForn];
      let sql = `SELECT * FROM produto_embalagens
                 WHERE produto_id = ? AND ativa = 1 AND codigo_fornecedor = ?`;
      if (cnpj) {
        sql += ' AND (fornecedor_cnpj IS NULL OR fornecedor_cnpj = ? OR fornecedor_cnpj = \'\')';
        params.push(cnpj);
      }
      sql += ' LIMIT 1';

      this.db.get(sql, params, (err, row) => {
        if (err) return callback(err);
        if (row) return callback(null, normalizarEmbalagemResposta(row));
        this.listarPorProduto(produtoId, (listErr, lista) => {
          if (listErr) return callback(listErr);
          const principal = (lista || []).find((e) => Number(e.principal) === 1) || lista[0] || null;
          callback(null, principal);
        });
      });
    }
  }
}

function obterProdutoEmbalagemService(db) {
  return new ProdutoEmbalagemService(db);
}

module.exports = {
  ProdutoEmbalagemService,
  ProdutoApresentacaoService: ProdutoEmbalagemService,
  obterProdutoEmbalagemService,
  obterProdutoApresentacaoService: obterProdutoEmbalagemService,
  normalizarEmbalagemInput,
  normalizarEmbalagemResposta,
  validarListaEmbalagens,
  num
};
