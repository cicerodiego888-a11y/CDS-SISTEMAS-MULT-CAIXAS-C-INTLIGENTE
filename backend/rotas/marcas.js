const express = require('express');
const router = express.Router();
const db = require('../database');
const { gravarAuditoria } = require('../services/auditoria');
const {
  listarMarcasAtivas,
  filtrarMarcasPorTermo,
  findOrCreateMarca,
  normalizarNomeCadastroSimples
} = require('../services/MarcaService');

function auditarMarca(req, acao, marcaId, detalhes = {}) {
  gravarAuditoria({
    usuario_id: req.user?.id || null,
    usuario_nome: req.user?.nome || req.user?.username || null,
    modulo: 'marcas',
    acao,
    referencia_tipo: 'marca',
    referencia_id: marcaId || null,
    detalhes,
    ip_requisicao: req.ip || null
  }).catch((auditErr) => console.error('Erro ao gravar auditoria de marca:', auditErr));
}

// LISTAR — por padrão apenas ativas (soft-delete). ?q= filtra por nome.
router.get('/', async (req, res) => {
  try {
    const incluirInativas = String(req.query.todos || req.query.incluir_inativas || '') === '1';
    const termo = String(req.query.q || req.query.busca || '').trim();

    if (!incluirInativas) {
      const ativas = await listarMarcasAtivas(db);
      return res.json(filtrarMarcasPorTermo(ativas, termo));
    }

    db.all(`SELECT * FROM marcas ORDER BY nome COLLATE NOCASE`, [], (err, rows) => {
      if (err) {
        return res.status(500).json({ erro: 'Erro ao listar marcas', error: err.message });
      }
      return res.json(filtrarMarcasPorTermo(rows || [], termo));
    });
  } catch (err) {
    return res.status(500).json({ erro: 'Erro ao listar marcas', error: err.message });
  }
});

// Smart Select — encontra ou cria sem duplicidade (case/espaços normalizados)
router.post('/find-or-create', async (req, res) => {
  try {
    const resultado = await findOrCreateMarca(db, req.body?.nome, {
      auditar: (acao, marcaId, detalhes) => auditarMarca(req, acao, marcaId, detalhes)
    });
    const status = resultado.criado ? 201 : 200;
    return res.status(status).json({
      ...resultado.marca,
      criado: resultado.criado,
      reativado: resultado.reativado
    });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ erro: err.message || 'Erro ao processar marca' });
  }
});

router.get('/:id', (req, res) => {
  db.get('SELECT * FROM marcas WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      return res.status(500).json({ erro: 'Erro ao buscar marca', error: err.message });
    }
    if (!row) {
      return res.status(404).json({ erro: 'Marca não encontrada' });
    }
    res.json(row);
  });
});

router.post('/', (req, res) => {
  const nome = normalizarNomeCadastroSimples(req.body?.nome);
  if (!nome) {
    return res.status(400).json({ erro: 'Nome é obrigatório' });
  }

  findOrCreateMarca(db, nome, {
    auditar: (acao, marcaId, detalhes) => auditarMarca(req, acao, marcaId, detalhes)
  })
    .then((resultado) => {
      if (!resultado.criado && !resultado.reativado) {
        return res.status(400).json({ erro: 'Marca já existe' });
      }
      const status = resultado.criado ? 201 : 200;
      return res.status(status).json(resultado.marca);
    })
    .catch((err) => {
      const status = err.status || 500;
      return res.status(status).json({ erro: err.message || 'Erro ao criar marca' });
    });
});

router.put('/:id', (req, res) => {
  const nome = normalizarNomeCadastroSimples(req.body?.nome);
  if (!nome) {
    return res.status(400).json({ erro: 'Nome é obrigatório' });
  }

  const ativo = req.body?.ativo !== undefined ? (req.body.ativo ? 1 : 0) : 1;

  db.run(
    `UPDATE marcas
     SET nome = ?, ativo = ?, updated_at = datetime('now', 'localtime')
     WHERE id = ?`,
    [nome, ativo, req.params.id],
    function (err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(400).json({ erro: 'Já existe outra marca com esse nome' });
        }
        return res.status(500).json({ erro: 'Erro ao atualizar marca', error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Marca não encontrada' });
      }

      db.get('SELECT * FROM marcas WHERE id = ?', [req.params.id], (getErr, row) => {
        if (getErr) {
          return res.status(500).json({ erro: 'Marca atualizada, mas não foi possível retornar os dados' });
        }
        auditarMarca(req, 'atualizar_marca', req.params.id, { nome, ativo });
        res.json(row);
      });
    }
  );
});

// DELETE = inativação lógica (produtos com marca_id permanecem intactos)
router.delete('/:id', (req, res) => {
  db.run(
    `UPDATE marcas SET ativo = 0, updated_at = datetime('now', 'localtime') WHERE id = ?`,
    [req.params.id],
    function (err) {
      if (err) {
        return res.status(500).json({ erro: 'Erro ao inativar marca', error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ erro: 'Marca não encontrada' });
      }
      auditarMarca(req, 'inativar_marca', req.params.id, {});
      res.json({ success: true, message: 'Marca inativada com sucesso' });
    }
  );
});

module.exports = router;
