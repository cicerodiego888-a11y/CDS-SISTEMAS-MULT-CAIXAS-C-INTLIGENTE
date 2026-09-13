/**
 * RC8.5.2 — API do Motor Inteligente de Embalagens (MIE)
 */
'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const Mie = require('../services/embalagens');

router.post('/analisar', async (req, res) => {
  try {
    const body = req.body || {};
    const sugestao = await Mie.analisarItemXml(body.item || body, {
      db,
      fornecedorCnpj: body.fornecedor_cnpj || body.fornecedorCnpj
    });
    res.json(sugestao);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/aprendizado', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await Mie.registrarAprendizado(db, {
      fornecedor_cnpj: body.fornecedor_cnpj || body.fornecedorCnpj,
      unidade_comercial: body.unidade_comercial || body.unidade,
      quantidade_por_embalagem: body.quantidade_por_embalagem,
      padrao_chave: body.padrao_chave || body.unidade_comercial || body.unidade,
      xProd: body.xProd || body.produto_nome,
      produto_nome: body.produto_nome
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
