/**
 * Rotas — Vendas para Entrega (Sprint 2.1)
 * Montadas em /api/vendas
 *
 * Importante: NÃO usar router.use(exigirModulo...) no root —
 * este router compartilha o mount /api/vendas com vendas.js.
 * O gate do módulo deve valer só para paths de entrega.
 */

const express = require('express');
const router = express.Router();
const configService = require('../services/configuracaoService');
const EntregaController = require('../controllers/EntregaController');
const { responderModuloNaoLicenciado } = require('../middleware/errosLicenciamento');

function exigirModuloVendasEntrega(req, res, next) {
  try {
    if (!configService.recursoHabilitado('vendasEntrega')) {
      return responderModuloNaoLicenciado(res, 'vendasEntrega');
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Erro ao verificar módulo.' });
  }
}

// Gate só em /entregas/* — não intercepta POST /api/vendas, pre-calcular, etc.
router.use('/entregas', exigirModuloVendasEntrega);

// Consultas operacionais (antes de :id)
router.get('/entregas/dashboard', EntregaController.dashboard);
router.get('/entregas/alertas', EntregaController.alertas);
router.get('/entregas/reservas-produto/:produtoId', EntregaController.reservasProduto);
router.get('/entregas/por-entregador', EntregaController.porEntregador);
router.get('/entregas/aguardando-prestacao', EntregaController.aguardandoPrestacao);
router.get('/entregas/resumo', EntregaController.resumo);
router.get('/entregas/resumo-status', EntregaController.resumoPorStatus);
router.get('/entregas/reservas', EntregaController.totaisReservados);
router.get('/entregas/pendentes', EntregaController.listarPendentes);

router.get('/entregas', EntregaController.listar);
router.get('/entregas/:id/timeline', EntregaController.timeline);
router.get('/entregas/:id', EntregaController.buscarPorId);
router.post('/entregas/:id/iniciar', EntregaController.iniciarEntrega);

router.post('/:id/prestacao', exigirModuloVendasEntrega, EntregaController.prestacao);
router.put('/:id/entrega', exigirModuloVendasEntrega, EntregaController.atualizarEntrega);
router.delete('/:id/entrega', exigirModuloVendasEntrega, EntregaController.cancelarEntrega);

module.exports = router;
