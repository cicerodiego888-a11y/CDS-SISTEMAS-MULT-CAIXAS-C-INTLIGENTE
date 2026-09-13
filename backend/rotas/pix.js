const express = require('express');
const router = express.Router();
const pixService = require('../services/pix/pixService');

router.get('/provedores', (req, res) => {
  res.json({
    success: true,
    provedores: pixService.providerCatalog
  });
});

router.get('/config', async (req, res) => {
  try {
    const config = await pixService.buscarConfigPix();
    res.json({
      success: true,
      config
    });
  } catch (err) {
    console.error('Erro ao buscar config Pix:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/config', async (req, res) => {
  try {
    await pixService.salvarConfigPix(req.body);
    res.json({
      success: true,
      message: 'Configuração Pix salva com sucesso.'
    });
  } catch (err) {
    console.error('Erro ao salvar config Pix:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/criar-cobranca', async (req, res) => {
  try {
    const valor = Number(req.body.valor || 0);

    if (valor <= 0) {
      return res.status(400).json({ success: false, error: 'Valor inválido.' });
    }

    const cobranca = await pixService.criarCobranca({
      valor,
      descricao: req.body.descricao || 'Venda PDV',
      vendaId: req.body.venda_id || null
    });

    res.json({
      success: true,
      cobranca
    });
  } catch (err) {
    console.error('Erro ao criar cobrança Pix:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/status/:txid', async (req, res) => {
  try {
    const status = await pixService.consultarStatus(req.params.txid);
    res.json({
      success: true,
      status
    });
  } catch (err) {
    console.error('Erro ao consultar status Pix:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/testar-conexao', async (req, res) => {
  try {
    await pixService.salvarConfigPix(req.body);
    res.json({
      success: true,
      message: 'Configuração salva. O teste real acontece ao gerar uma cobrança Pix.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;