/**
 * RC3.6.E — API de auditoria DistDFe (somente suporte / read-only).
 */
'use strict';

const express = require('express');
const router = express.Router();
const { DfeAuditoriaService, DfeAuditoriaResultado } = require('../services/fiscal/DfeAuditoriaService');

const service = new DfeAuditoriaService();

function filtrosFromQuery(query = {}) {
  return {
    correlationId: query.correlation_id || query.correlationId || null,
    nsu: query.nsu || null,
    chave: query.chave || null,
    resultado: query.resultado || null,
    schema: query.schema || null,
    tipo: query.tipo || null,
    cnpj: query.cnpj || null,
    dataInicio: query.data_inicio || query.dataInicio || null,
    dataFim: query.data_fim || query.dataFim || null,
    limite: query.limite != null ? Number(query.limite) : 100,
    offset: query.offset != null ? Number(query.offset) : 0
  };
}

router.get('/resultados', (_req, res) => {
  res.json({ resultados: Object.values(DfeAuditoriaResultado) });
});

router.get('/', async (req, res) => {
  try {
    const resultado = await service.listar(filtrosFromQuery(req.query));
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/export/arquivo', async (req, res) => {
  try {
    const formato = String(req.query.format || req.query.formato || 'json').toLowerCase();
    const exp = await service.exportar(filtrosFromQuery(req.query), formato);
    const nome = `dfe-auditoria-${Date.now()}.${formato === 'csv' ? 'csv' : 'json'}`;
    res.setHeader('Content-Type', exp.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(exp.body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await service.buscarPorId(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'Registro não encontrado' });
    return res.json(item);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
