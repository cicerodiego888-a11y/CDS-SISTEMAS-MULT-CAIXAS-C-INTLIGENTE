'use strict';

/**
 * GET /api/consulta-cnpj/:cnpj
 * Autofill cadastral — não persiste fornecedor.
 */

const express = require('express');
const router = express.Router();
const ConsultaCnpjService = require('../services/cadastro/ConsultaCnpjService');
const { isErroConsultaCnpj, MENSAGEM_PADRAO } = require('../services/cadastro/cnpjConsultaErros');

const consultaCnpjService = new ConsultaCnpjService();

router.get('/:cnpj', async (req, res) => {
  try {
    const resultado = await consultaCnpjService.consultar(req.params.cnpj);
    return res.json({
      success: true,
      data: resultado.data,
      fromCache: Boolean(resultado.fromCache)
    });
  } catch (err) {
    const status = err.statusCode || 500;
    const codigo = err.code || err.codigo || 'ERRO_PROVIDER';
    const mensagem = isErroConsultaCnpj(err)
      ? (err.message || MENSAGEM_PADRAO[codigo])
      : (MENSAGEM_PADRAO.INDISPONIVEL || 'Não foi possível consultar o CNPJ agora.');

    console.warn('[consulta-cnpj]', codigo, status);

    return res.status(status).json({
      success: false,
      error: mensagem,
      code: codigo
    });
  }
});

module.exports = router;
