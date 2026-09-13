const express = require('express');
const router = express.Router();
const { exigirAdmin } = require('../middleware/auth');
const db = require('../database');

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function(err) { if (err) return reject(err); resolve(this); }));
}

// Listar alertas (admin)
router.get('/', exigirAdmin, async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, tipo, descricao, dados, resolvido, criado_em, resolvido_em FROM auditoria_alertas ORDER BY criado_em DESC');
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar alertas:', err);
    res.status(500).json({ error: err.message });
  }
});

// Marcar alerta como resolvido
router.patch('/:id/resolve', exigirAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    await dbRun(`UPDATE auditoria_alertas SET resolvido = 1, resolvido_em = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
    res.json({ sucesso: true, id });
  } catch (err) {
    console.error('Erro ao resolver alerta:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
