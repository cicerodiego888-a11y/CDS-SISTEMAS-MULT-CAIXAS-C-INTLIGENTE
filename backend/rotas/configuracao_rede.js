const express = require('express');
const { gravarAuditoria } = require('../services/auditoria');
const configService = require('../services/configuracaoService');
const { exigirAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', exigirAdmin, (req, res) => {
  const cfg = configService.readConfig();
  const modoRede = configService.getModoRedeElectron(cfg);

  res.json({
    modo: modoRede.modo === 'cliente' ? 'cliente' : 'local',
    ipServidor: cfg.ipServidor || '',
    porta: cfg.porta
  });
});

router.post('/', exigirAdmin, (req, res) => {
  const modo = String(req.body?.modo || 'local').trim().toLowerCase();
  const porta = Number(req.body?.porta);
  const ipServidor = typeof req.body?.ipServidor === 'string' ? req.body.ipServidor.trim() : '';
  const atual = configService.readConfig();

  const payload = {
    tipoImplantacao: atual.tipoImplantacao,
    modoOperacao: modo === 'cliente' ? 'CLIENTE_SERVIDOR' : 'LOCAL',
    ipServidor: modo === 'cliente' ? ipServidor : '',
    porta: Number.isInteger(porta) && porta > 0 ? porta : atual.porta
  };

  const validation = configService.validateConfig(payload);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.errors.join('; ') });
  }

  try {
    const saved = configService.saveConfig(payload);

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'configuracao_rede',
      acao: 'alterar',
      referencia_tipo: 'configuracao_rede',
      referencia_id: null,
      detalhes: configService.getModoRedeElectron(saved),
      ip_requisicao: req.ip || null
    }).catch((err) => {
      console.error('Erro ao registrar auditoria de configuração de rede:', err);
    });

    const modoRede = configService.getModoRedeElectron(saved);
    res.json({
      success: true,
      config: {
        modo: modoRede.modo === 'cliente' ? 'cliente' : 'local',
        ipServidor: saved.ipServidor,
        porta: saved.porta
      }
    });
  } catch (err) {
    console.error('Erro ao salvar configuração de rede:', err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
