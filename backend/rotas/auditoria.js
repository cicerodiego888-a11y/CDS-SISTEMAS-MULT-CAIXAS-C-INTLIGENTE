const express = require('express');
const router = express.Router();
const { verificarPermissaoEspecifica } = require('../middleware/auth');
const { obterAuditoria, obterAuditoriaPaginada } = require('../services/auditoria');

// Rota simples (compatibilidade) — exige permissão 'auditoria'
router.get('/', verificarPermissaoEspecifica('auditoria'), async (req, res) => {
  try {
    const { modulo, acao, usuario_nome, inicio, fim, limite } = req.query;
    const logs = await obterAuditoria({
      modulo,
      acao,
      usuario_nome,
      inicio,
      fim,
      limite: Number(limite) || 100
    });

    res.json(logs);
  } catch (err) {
    console.error('Erro ao buscar auditoria:', err);
    res.status(500).json({ error: err.message });
  }
});

// Rota paginada e filtrada
router.get('/list', verificarPermissaoEspecifica('auditoria'), async (req, res) => {
  try {
    const { modulo, acao, usuario_nome, inicio, fim, page, pageSize } = req.query;
    const pagina = Number(page) || 1;
    const tamanho = Math.min(500, Math.max(1, Number(pageSize) || 50));

    const result = await obterAuditoriaPaginada({
      modulo,
      acao,
      usuario_nome,
      inicio,
      fim,
      page: pagina,
      pageSize: tamanho
    });

    res.json(result);
  } catch (err) {
    console.error('Erro ao buscar auditoria paginada:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
