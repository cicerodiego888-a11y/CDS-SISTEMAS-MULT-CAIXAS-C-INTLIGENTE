const express = require('express');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');

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
        res.json(rows);
    });
});

// BUSCAR POR ID
router.get('/:id', (req, res) => {
    db.get('SELECT * FROM categorias WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ erro: 'Erro ao buscar categoria' });
        if (!row) return res.status(404).json({ erro: 'Categoria não encontrada' });
        res.json(row);
    });
});

// CRIAR
router.post('/', (req, res) => {
    const { nome, descricao, tipo } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({ erro: 'Nome é obrigatório' });
    }

    if (tipo && !['produto', 'despesa'].includes(tipo)) {
        return res.status(400).json({ erro: 'Tipo inválido' });
    }

    const sql = `INSERT INTO categorias (nome, descricao, tipo) VALUES (?, ?, ?)`;

    db.run(sql, [nome.trim(), descricao || '', tipo || 'produto'], function(err) {
        if (err) {
            if (err.message && err.message.includes('UNIQUE')) {
                return res.status(400).json({ erro: 'Categoria já existe' });
            }
            return res.status(500).json({ erro: 'Erro ao criar categoria' });
        }

        db.get('SELECT * FROM categorias WHERE id = ?', [this.lastID], (getErr, row) => {
            if (getErr) return res.status(500).json({ erro: 'Categoria criada, mas não foi possível retornar os dados' });
                // auditoria de criação de categoria
                gravarAuditoria({
                    usuario_id: req.user?.id || null,
                    usuario_nome: req.user?.nome || req.user?.username || null,
                    modulo: 'categorias',
                    acao: 'criar_categoria',
                    referencia_tipo: 'categoria',
                    referencia_id: this.lastID,
                    detalhes: { nome: nome.trim() },
                    ip_requisicao: req.ip || null
                }).catch((auditErr) => console.error('Erro ao gravar auditoria de categoria:', auditErr));

                res.json(row);
        });
    });
});

// ATUALIZAR
router.put('/:id', (req, res) => {
    const { nome, descricao, tipo } = req.body;

    if (!nome || !nome.trim()) {
        return res.status(400).json({ erro: 'Nome é obrigatório' });
    }

    if (tipo && !['produto', 'despesa'].includes(tipo)) {
        return res.status(400).json({ erro: 'Tipo inválido' });
    }

    db.run(
        `UPDATE categorias SET nome = ?, descricao = ?, tipo = ? WHERE id = ?`,
        [nome.trim(), descricao || '', tipo || 'produto', req.params.id],
        function(err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE')) {
                    return res.status(400).json({ erro: 'Já existe outra categoria com esse nome' });
                }
                return res.status(500).json({ erro: 'Erro ao atualizar categoria' });
            }

            db.get('SELECT * FROM categorias WHERE id = ?', [req.params.id], (getErr, row) => {
                if (getErr) return res.status(500).json({ erro: 'Categoria atualizada, mas não foi possível retornar os dados' });
                // auditoria de atualização
                gravarAuditoria({
                    usuario_id: req.user?.id || null,
                    usuario_nome: req.user?.nome || req.user?.username || null,
                    modulo: 'categorias',
                    acao: 'atualizar_categoria',
                    referencia_tipo: 'categoria',
                    referencia_id: req.params.id,
                    detalhes: { antes: null, depois: { nome: nome.trim(), tipo: tipo || 'produto' } },
                    ip_requisicao: req.ip || null
                }).catch((auditErr) => console.error('Erro ao gravar auditoria de atualização de categoria:', auditErr));

                res.json(row);
            });
        }
    );
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
                    // auditoria de exclusão
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
