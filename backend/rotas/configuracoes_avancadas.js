const express = require('express');
const router = express.Router();
const db = require('../database');
const configService = require('../services/configuracaoService');
const { exigirSuperAdmin } = require('../middleware/auth');
const { aplicarCfopCsosnEmTodosProdutos } = require('../services/fiscal/aplicarPadraoFiscalProdutos');

router.get('/confirmacao-fiscal', (req, res) => {
  try {
    res.json({
      modo_confirmacao_fiscal: configService.getModoConfirmacaoFiscal()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/recursos', (req, res) => {
  try {
    res.json(configService.getRecursos());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/padrao-fiscal', (req, res) => {
  try {
    res.json(configService.getPadraoFiscal());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/padrao-fiscal', exigirSuperAdmin, (req, res) => {
  try {
    const saved = configService.savePadraoFiscal(req.body || {});
    const padrao = configService.getPadraoFiscal(saved);

    aplicarCfopCsosnEmTodosProdutos(db, {
      cfop: padrao.cfop_padrao,
      csosn: padrao.csosn_padrao
    }, (err, aplicacao) => {
      if (err) {
        return res.status(500).json({
          error: err.message,
          padrao_fiscal: padrao
        });
      }

      const qtd = Number(aplicacao.produtos_atualizados || 0);
      const campos = [aplicacao.cfop ? 'CFOP' : null, aplicacao.csosn ? 'CSOSN' : null]
        .filter(Boolean)
        .join(' e ');
      const message = aplicacao.aplicado
        ? `Padrão Fiscal salvo. ${campos} aplicado(s) em ${qtd} produto(s).`
        : 'Padrão Fiscal da Empresa atualizado com sucesso.';

      res.json({
        success: true,
        message,
        padrao_fiscal: padrao,
        produtos_atualizados: qtd
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', exigirSuperAdmin, (req, res) => {
  try {
    const cfg = configService.readConfig();
    res.json(Object.assign({}, cfg, { recursos: configService.getRecursos(cfg).recursos }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', exigirSuperAdmin, (req, res) => {
  try {
    const data = req.body || {};
    const validation = configService.validateConfig(data);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validação falhou',
        details: validation.errors
      });
    }

    const saved = configService.saveConfig(data);

    res.json({
      success: true,
      message: 'Configurações salvas com sucesso.',
      config: saved,
      recursos: configService.getRecursos(saved).recursos
    });
  } catch (err) {
    const status = err.details ? 400 : 500;
    res.status(status).json({
      error: err.message,
      details: err.details || undefined
    });
  }
});

module.exports = router;
