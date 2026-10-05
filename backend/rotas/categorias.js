const express = require('express');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');
const {
  resolverPadroesCategoriaParaSalvar,
  serializarCategoria
} = require('../services/categorias/categoriaPadroes');
const { normalizarProdutosCategoriaEspecial } = require('../services/categorias/normalizacaoProdutosCategoriaEspecial');

function responderCategoria(res, err, row, statusNaoEncontrado = 404) {
  if (err) return res.status(500).json({ erro: 'Erro ao buscar categoria' });
  if (!row) return res.status(statusNaoEncontrado).json({ erro: 'Categoria não encontrada' });
  res.json(serializarCategoria(row));
}

// LISTAR
router.get('/', (req, res) => {
    const { tipo } = req.query;

    let sql = 'SELECT * FROM categorias WHERE 1=1';
    const params = [];

    if (tipo) {
        sql += ' AND tipo = ?';
        params.push(tipo);
    }

    sql += ' ORDER BY nome';

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ erro: 'Erro ao listar categorias' });
        res.json((rows || []).map(serializarCategoria));
    });
});

// BUSCAR POR ID
router.get('/:id', (req, res) => {
    db.get('SELECT * FROM categorias WHERE id = ?', [req.params.id], (err, row) => {
        responderCategoria(res, err, row);
    });
});

// CRIAR
router.post('/', (req, res) => {
    const { nome, descricao, tipo, ativo } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({ erro: 'Nome é obrigatório' });
    }

    if (tipo && !['produto', 'despesa'].includes(tipo)) {
        return res.status(400).json({ erro: 'Tipo inválido' });
    }

    const padroes = resolverPadroesCategoriaParaSalvar(nome.trim(), req.body, { criar: true });
    const tipoFinal = tipo || 'produto';
    const ativoFinal = ativo === undefined || ativo === null || ativo === ''
      ? 1
      : (Number(ativo) === 0 ? 0 : 1);

    const sql = `INSERT INTO categorias (
      nome, descricao, tipo, ativo, padrao_controla_estoque, padrao_controle_comercial
    ) VALUES (?, ?, ?, ?, ?, ?)`;

    db.run(sql, [
      nome.trim(),
      descricao || '',
      tipoFinal,
      ativoFinal,
      padroes.padrao_controla_estoque,
      padroes.padrao_controle_comercial
    ], function(err) {
        if (err) {
            if (err.message && err.message.includes('UNIQUE')) {
                return res.status(400).json({ erro: 'Categoria já existe' });
            }
            return res.status(500).json({ erro: 'Erro ao criar categoria' });
        }

        db.get('SELECT * FROM categorias WHERE id = ?', [this.lastID], (getErr, row) => {
            if (getErr) return res.status(500).json({ erro: 'Categoria criada, mas não foi possível retornar os dados' });
                gravarAuditoria({
                    usuario_id: req.user?.id || null,
                    usuario_nome: req.user?.nome || req.user?.username || null,
                    modulo: 'categorias',
                    acao: 'criar_categoria',
                    referencia_tipo: 'categoria',
                    referencia_id: this.lastID,
                    detalhes: {
                      nome: nome.trim(),
                      padrao_controla_estoque: padroes.padrao_controla_estoque,
                      padrao_controle_comercial: padroes.padrao_controle_comercial
                    },
                    ip_requisicao: req.ip || null
                }).catch((auditErr) => console.error('Erro ao gravar auditoria de categoria:', auditErr));

                res.json(serializarCategoria(row));
        });
    });
});

// ATUALIZAR
router.put('/:id', (req, res) => {
    const { nome, descricao, tipo, ativo } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({ erro: 'Nome é obrigatório' });
    }

    if (tipo && !['produto', 'despesa'].includes(tipo)) {
        return res.status(400).json({ erro: 'Tipo inválido' });
    }

    db.get('SELECT * FROM categorias WHERE id = ?', [req.params.id], (errAtual, atual) => {
      if (errAtual) return res.status(500).json({ erro: 'Erro ao atualizar categoria' });
      if (!atual) return res.status(404).json({ erro: 'Categoria não encontrada' });

      const padroes = resolverPadroesCategoriaParaSalvar(nome.trim(), req.body, {
        criar: false,
        atual
      });
      const tipoFinal = tipo || atual.tipo || 'produto';
      const ativoFinal = ativo === undefined || ativo === null || ativo === ''
        ? (atual.ativo === undefined || atual.ativo === null ? 1 : Number(atual.ativo) === 0 ? 0 : 1)
        : (Number(ativo) === 0 ? 0 : 1);

      db.run(
        `UPDATE categorias
         SET nome = ?, descricao = ?, tipo = ?, ativo = ?,
             padrao_controla_estoque = ?, padrao_controle_comercial = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          nome.trim(),
          descricao || '',
          tipoFinal,
          ativoFinal,
          padroes.padrao_controla_estoque,
          padroes.padrao_controle_comercial,
          req.params.id
        ],
        function(err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    return res.status(400).json({ erro: 'Já existe outra categoria com esse nome' });
                }
                return res.status(500).json({ erro: 'Erro ao atualizar categoria' });
            }

                        normalizarProdutosCategoriaEspecial(db, { categoriaId: req.params.id }).then(() => {
                            db.get('SELECT * FROM categorias WHERE id = ?', [req.params.id], (getErr, row) => {
                                if (getErr) return res.status(500).json({ erro: 'Categoria atualizada, mas não foi possível retornar os dados' });
                                gravarAuditoria({
                                        usuario_id: req.user?.id || null,
                                        usuario_nome: req.user?.nome || req.user?.username || null,
                                        modulo: 'categorias',
                                        acao: 'atualizar_categoria',
                                        referencia_tipo: 'categoria',
                                        referencia_id: req.params.id,
                                        detalhes: {
                                            depois: {
                                                nome: nome.trim(),
                                                tipo: tipoFinal,
                                                padrao_controla_estoque: padroes.padrao_controla_estoque,
                                                padrao_controle_comercial: padroes.padrao_controle_comercial
                                            }
                                        },
                                        ip_requisicao: req.ip || null
                                }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de categoria:', auditErr));

                                res.json(serializarCategoria(row));
                            });
                        }).catch((normalizacaoErr) => res.status(500).json({ erro: normalizacaoErr.message }));
        }
      );
    });
});

// EXCLUIR
router.delete('/:id', (req, res) => {
    const categoriaId = req.params.id;

    db.get('SELECT COUNT(*) AS total FROM produtos WHERE categoria_id = ?', [categoriaId], (errProdutos, rowProdutos) => {
        if (errProdutos) return res.status(500).json({ erro: 'Erro ao verificar vínculo com produtos' });

        if ((rowProdutos?.total || 0) > 0) {
            return res.status(400).json({ erro: 'Não é possível excluir: categoria vinculada a produtos' });
        }

        db.get('SELECT COUNT(*) AS total FROM subcategorias WHERE categoria_id = ?', [categoriaId], (errSub, rowSub) => {
            if (errSub) return res.status(500).json({ erro: 'Erro ao verificar vínculo com subcategorias' });

            if ((rowSub?.total || 0) > 0) {
                return res.status(400).json({ erro: 'Não é possível excluir: categoria vinculada a subcategorias' });
            }

            db.get('SELECT COUNT(*) AS total FROM financeiro WHERE categoria = (SELECT nome FROM categorias WHERE id = ?)', [categoriaId], (errFin, rowFin) => {
                if (errFin) return res.status(500).json({ erro: 'Erro ao verificar vínculo com financeiro' });

                if ((rowFin?.total || 0) > 0) {
                    return res.status(400).json({ erro: 'Não é possível excluir: categoria já utilizada no financeiro' });
                }

                db.run(`DELETE FROM categorias WHERE id = ?`, [categoriaId], function(errDelete) {
                    if (errDelete) return res.status(500).json({ erro: 'Erro ao excluir categoria' });
                    gravarAuditoria({
                        usuario_id: req.user?.id || null,
                        usuario_nome: req.user?.nome || req.user?.username || null,
                        modulo: 'categorias',
                        acao: 'excluir_categoria',
                        referencia_tipo: 'categoria',
                        referencia_id: categoriaId,
                        detalhes: {},
                        ip_requisicao: req.ip || null
                    }).catch((auditErr) => console.error('Erro ao gravar auditoria de exclusão de categoria:', auditErr));

                    res.json({ message: 'Categoria excluída com sucesso' });
                });
            });
        });
    });
});

module.exports = router;
