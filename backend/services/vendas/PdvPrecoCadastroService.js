'use strict';

const pdvEditarPrecoUnitarioConfig = require('../estoque/pdvEditarPrecoUnitarioConfig');

function erroComStatus(mensagem, status = 400) {
  const erro = new Error(mensagem);
  erro.status = status;
  return erro;
}

function usuarioPodeEditarProdutos(req) {
  const usuario = req?.user || {};
  const perfil = String(usuario.perfil || '').trim().toUpperCase();
  return usuario.role === 'admin'
    || usuario.role === 'supervisor'
    || perfil === 'ADMIN'
    || perfil === 'SUPER_ADMIN';
}

function prepararAtualizacoesPrecoCatalogo(db, req, callback) {
  const itens = Array.isArray(req?.body?.itens) ? req.body.itens : [];
  const solicitacoes = itens.filter((item) => item?.atualizar_preco_cadastro === true);
  if (solicitacoes.length === 0) return callback(null, []);

  pdvEditarPrecoUnitarioConfig.estaAtivada(db, (configErr, permitido) => {
    if (configErr) return callback(configErr);
    if (!permitido) {
      return callback(erroComStatus(
        'A edição de preço unitário no PDV não está autorizada.',
        403
      ));
    }

    const autorizar = (autorizado) => {
      if (!autorizado) {
        return callback(erroComStatus(
          'Você não possui permissão para atualizar o preço cadastrado do produto.',
          403
        ));
      }

      const destinos = new Set();
      const atualizacoes = [];
      for (const item of solicitacoes) {
        const produtoId = Number(item.produto_id);
        const preco = Number(item.preco_unitario);
        const tipoPreco = String(item.tipo_preco || 'varejo').trim().toLowerCase();
        const tipoVenda = String(item.tipo_venda || '').trim().toUpperCase();

        if (!Number.isInteger(produtoId) || produtoId <= 0 || !Number.isFinite(preco) || preco <= 0) {
          return callback(erroComStatus('Produto ou preço inválido para atualização cadastral.'));
        }

        if (tipoPreco === 'atacado') {
          const faixaId = Number(item.faixa_atacado_id);
          const quantidade = Number(item.quantidade);
          if (!Number.isInteger(faixaId) || faixaId <= 0 || !Number.isFinite(quantidade) || quantidade <= 0) {
            return callback(erroComStatus(
              'A faixa de atacado aplicada não foi identificada; o preço cadastral não foi alterado.'
            ));
          }
          const chave = `atacado:${produtoId}:${faixaId}`;
          if (destinos.has(chave)) {
            return callback(erroComStatus('Há mais de uma alteração para a mesma faixa de atacado.'));
          }
          destinos.add(chave);
          atualizacoes.push({
            produtoId,
            preco,
            tipoPreco,
            faixaId,
            quantidade
          });
          continue;
        }

        if (tipoPreco !== 'varejo') {
          return callback(erroComStatus(
            'Não existe tabela de preço cadastrada compatível com este contexto de venda.'
          ));
        }

        const campo = tipoVenda === 'UNIDADE' ? 'preco_unidade' : 'preco_venda';
        const chave = `varejo:${produtoId}:${campo}`;
        if (destinos.has(chave)) {
          return callback(erroComStatus('Há mais de uma alteração para o mesmo preço varejista.'));
        }
        destinos.add(chave);
        atualizacoes.push({ produtoId, preco, tipoPreco, campo });
      }

      callback(null, atualizacoes);
    };

    if (usuarioPodeEditarProdutos(req)) return autorizar(true);

    const usuarioId = Number(req?.user?.id || req?.user?.usuario_id || 0);
    if (!Number.isInteger(usuarioId) || usuarioId <= 0) return autorizar(false);
    db.get(
      `SELECT 1 AS permitido
       FROM usuario_permissoes
       WHERE usuario_id = ? AND permissao = 'produtos' AND permitido = 1`,
      [usuarioId],
      (permissaoErr, row) => {
        if (permissaoErr) return callback(permissaoErr);
        autorizar(Boolean(row));
      }
    );
  });
}

function aplicarAtualizacoesPrecoCatalogo(db, atualizacoes, vendaId, operadorId, operadorNome, callback) {
  const lista = Array.isArray(atualizacoes) ? atualizacoes : [];
  let indice = 0;

  const aplicarProxima = () => {
    if (indice >= lista.length) return callback(null);
    const atualizacao = lista[indice++];

    const salvarAtualizacao = (tabela, campo, identificador, valorAnterior) => {
      if (Number(valorAnterior) === Number(atualizacao.preco)) return aplicarProxima();

      db.run(
        `UPDATE ${tabela}
         SET ${campo} = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`,
        [atualizacao.preco, identificador],
        function (updateErr) {
          if (updateErr) return callback(updateErr);
          if (this.changes !== 1) {
            return callback(new Error('O preço cadastrado deixou de existir durante a finalização da venda.'));
          }

          const detalhes = {
            produto_id: atualizacao.produtoId,
            venda_id: Number(vendaId),
            tabela_comercial: atualizacao.tipoPreco.toUpperCase(),
            campo_preco: campo,
            preco_anterior: Number(valorAnterior),
            preco_novo: Number(atualizacao.preco),
            faixa_atacado_id: atualizacao.faixaId || null,
            operador_id: operadorId || null,
            operador_nome: operadorNome || null
          };
          db.run(
            `INSERT INTO auditoria (
              usuario_id, usuario_nome, modulo, acao, referencia_tipo, referencia_id, detalhes
            ) VALUES (?, ?, 'PDV', 'ALTERACAO_PRECO_CADASTRO', 'produto', ?, ?)`,
            [
              operadorId || null,
              operadorNome || null,
              atualizacao.produtoId,
              JSON.stringify(detalhes)
            ],
            (auditErr) => {
              if (auditErr) return callback(auditErr);
              aplicarProxima();
            }
          );
        }
      );
    };

    if (atualizacao.tipoPreco === 'varejo') {
      db.get(
        `SELECT id, ${atualizacao.campo} AS preco FROM produtos WHERE id = ?`,
        [atualizacao.produtoId],
        (selectErr, produto) => {
          if (selectErr) return callback(selectErr);
          if (!produto) return callback(new Error(`Produto ${atualizacao.produtoId} não encontrado para atualizar o preço.`));
          salvarAtualizacao('produtos', atualizacao.campo, produto.id, produto.preco);
        }
      );
      return;
    }

    db.all(
      `SELECT id, quantidade_minima, preco_atacado
       FROM produto_atacado
       WHERE produto_id = ?
       ORDER BY quantidade_minima DESC, id DESC`,
      [atualizacao.produtoId],
      (faixasErr, faixas) => {
        if (faixasErr) return callback(faixasErr);
        const aplicavel = (faixas || []).find(
          (faixa) => Number(faixa.quantidade_minima) <= atualizacao.quantidade
        );
        if (!aplicavel || Number(aplicavel.id) !== atualizacao.faixaId) {
          return callback(new Error(
            'A faixa de atacado informada não corresponde à faixa aplicada nesta venda.'
          ));
        }
        salvarAtualizacao('produto_atacado', 'preco_atacado', aplicavel.id, aplicavel.preco_atacado);
      }
    );
  };

  aplicarProxima();
}

function gravarPrecoCadastroImediato(db, req, callback) {
  prepararAtualizacoesPrecoCatalogo(db, req, (preparoErr, atualizacoes) => {
    if (preparoErr) return callback(preparoErr);
    if (!atualizacoes.length) {
      return callback(erroComStatus('Nenhuma alteração cadastral foi solicitada.'));
    }

    const usuario = req?.user || {};
    const operadorId = Number(usuario.id || usuario.usuario_id || 0) || null;
    const operadorNome = usuario.nome || usuario.username || null;

    db.run('BEGIN IMMEDIATE', (beginErr) => {
      if (beginErr) return callback(beginErr);
      aplicarAtualizacoesPrecoCatalogo(
        db,
        atualizacoes,
        null,
        operadorId,
        operadorNome,
        (aplicarErr) => {
          if (aplicarErr) {
            return db.run('ROLLBACK', () => callback(aplicarErr));
          }
          db.run('COMMIT', (commitErr) => {
            if (!commitErr) return callback(null, atualizacoes[0]);
            db.run('ROLLBACK', () => callback(commitErr));
          });
        }
      );
    });
  });
}

function finalizarTransacaoVendaPdv(db, atualizacoes, vendaId, operadorId, operadorNome, callback) {
  aplicarAtualizacoesPrecoCatalogo(
    db,
    atualizacoes,
    vendaId,
    operadorId,
    operadorNome,
    (precoErr) => {
      if (precoErr) {
        return db.run('ROLLBACK', (rollbackErr) => callback(rollbackErr || precoErr));
      }

      db.run('COMMIT', (commitErr) => {
        if (!commitErr) return callback(null);
        db.run('ROLLBACK', (rollbackErr) => callback(rollbackErr || commitErr));
      });
    }
  );
}

module.exports = {
  prepararAtualizacoesPrecoCatalogo,
  aplicarAtualizacoesPrecoCatalogo,
  gravarPrecoCadastroImediato,
  finalizarTransacaoVendaPdv,
  usuarioPodeEditarProdutos
};
