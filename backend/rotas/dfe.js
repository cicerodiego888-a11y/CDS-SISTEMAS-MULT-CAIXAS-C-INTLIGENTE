/**
 * Rotas DF-e legadas — @deprecated RC1 Limpeza Arquitetural.
 *
 * A Central Inteligente de Entradas (/api/central-entradas/*) é a única porta
 * oficial de entrada de documentos fiscais. Estas rotas retornam HTTP 410.
 *
 * @module rotas/dfe
 * @deprecated Utilize /api/central-entradas
 */

const express = require('express');

const router = express.Router();

const SUBSTITUICOES = Object.freeze({
  'GET /consultar-notas': 'GET /api/central-entradas/documentos',
  'GET /distribuir-documentos': 'POST /api/central-entradas/sincronizar',
  'GET /consultar-chave': 'GET /api/central-entradas/buscar-chave?chave={chave}',
  'POST /importar-nota': 'POST /api/central-entradas/:id/processar → revisão → abrir-compra → saveCompra()'
});

/**
 * @param {import('express').Response} res
 * @param {string} rotaLegada
 */
function responderDepreciado(res, rotaLegada) {
  return res.status(410).json({
    sucesso: false,
    deprecated: true,
    mensagem: 'Rota DF-e descontinuada. Documentos fiscais entram exclusivamente pela Central Inteligente de Entradas.',
    rotaLegada,
    substituicao: SUBSTITUICOES[rotaLegada] || '/api/central-entradas',
    documentacao: 'backend/motores/central-entradas/README.md'
  });
}

router.get('/consultar-notas', (req, res) => {
  responderDepreciado(res, 'GET /consultar-notas');
});

router.get('/distribuir-documentos', (req, res) => {
  responderDepreciado(res, 'GET /distribuir-documentos');
});

router.get('/consultar-chave', (req, res) => {
  responderDepreciado(res, 'GET /consultar-chave');
});

router.post('/importar-nota', (req, res) => {
  responderDepreciado(res, 'POST /importar-nota');
});

module.exports = router;
