/**
 * F12 POLICY API ROUTES
 *
 * Fonte oficial: controle + escopo.
 * politica / politicaLegada apenas para compatibilidade.
 */

const express = require('express');
const router = express.Router();
const { verificarToken, exigirAdmin } = require('../middleware/auth');
const { gravarAuditoria } = require('../services/auditoria');
const F12PolicyService = require('../services/F12PolicyService');
const {
  isAdmin,
  resolverPodeAlterarF12,
  autorizarDefinirEstadoCaixa,
  autorizarDefinirEstadoGlobal
} = require('../lib/f12ModeloControle');

function auditarF12(req, acao, detalhes = {}) {
  gravarAuditoria({
    usuario_id: req.user?.id || null,
    usuario_nome: req.user?.username || req.user?.nome || null,
    modulo: 'f12_policy',
    acao,
    referencia_tipo: 'f12_policy',
    referencia_id: null,
    detalhes: {
      ...detalhes,
      ip: req.ip || null,
      caixa_id: detalhes.caixa_id
    },
    ip_requisicao: req.ip || null
  }).catch((auditErr) => {
    console.error('Erro ao gravar auditoria F12:', auditErr);
  });
}

function responderErroModelo(res, err, status = 500) {
  const codigo = err && err.status ? err.status : status;
  if (codigo >= 500) {
    console.error('Erro F12:', err);
  }
  return res.status(codigo).json({ error: (err && err.message) || 'Erro F12' });
}

function labelsControle(controle, escopo) {
  if (controle === 'OPERADOR') {
    return 'Operador do Caixa';
  }
  if (escopo === 'TODOS') {
    return 'Somente Administrador — todos os caixas';
  }
  return 'Somente Administrador — por caixa';
}

// ============================================
// GET /api/f12/contexto/:caixaId
// ============================================
router.get('/contexto/:caixaId', verificarToken, (req, res) => {
  const caixaId = Number(req.params.caixaId);
  if (!caixaId) {
    return res.status(400).json({ error: 'caixaId inválido' });
  }

  F12PolicyService.resolverContextoF12(caixaId, req.user, (err, contexto) => {
    if (err) return responderErroModelo(res, err);
    res.json({
      ativo: contexto.ativo,
      podeAlterar: contexto.podeAlterar,
      controle: contexto.controle,
      escopo: contexto.escopo,
      caixaId: contexto.caixaId,
      politicaLegada: contexto.politicaLegada
    });
  });
});

// ============================================
// GET /api/f12/politica  (compatibilidade)
// ============================================
router.get('/politica', verificarToken, (req, res) => {
  F12PolicyService.obterModeloControle((err, modelo) => {
    if (err) return responderErroModelo(res, err);

    const politica = require('../lib/f12ModeloControle')
      .mapearModeloParaPoliticaLegada(modelo.controle, modelo.escopo);

    res.json({
      controle: modelo.controle,
      escopo: modelo.escopo,
      politica,
      politicaLegada: politica,
      label: labelsControle(modelo.controle, modelo.escopo)
    });
  });
});

// ============================================
// GET /api/f12/estado/:caixaId  (compatibilidade)
// ============================================
router.get('/estado/:caixaId', verificarToken, (req, res) => {
  const caixaId = Number(req.params.caixaId);
  if (!caixaId) {
    return res.status(400).json({ error: 'caixaId inválido' });
  }

  F12PolicyService.resolverContextoF12(caixaId, req.user, (err, contexto) => {
    if (err) return responderErroModelo(res, err);
    res.json({
      caixaId,
      ativo: contexto.ativo,
      podeAlterar: contexto.podeAlterar,
      controle: contexto.controle,
      escopo: contexto.escopo,
      politica: contexto.politicaLegada,
      politicaLegada: contexto.politicaLegada,
      label: labelsControle(contexto.controle, contexto.escopo)
    });
  });
});

// ============================================
// GET /api/f12/estado-global
// ============================================
router.get('/estado-global', verificarToken, (req, res) => {
  F12PolicyService.obterEstadoGlobal((err, ativo) => {
    if (err) return responderErroModelo(res, err);
    res.json({ ativo });
  });
});

// ============================================
// PUT /api/f12/estado-global
// ============================================
router.put('/estado-global', verificarToken, exigirAdmin, (req, res) => {
  const { ativo } = req.body;

  if (typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'ativo deve ser boolean' });
  }

  F12PolicyService.obterModeloControle((modeloErr, modelo) => {
    if (modeloErr) return responderErroModelo(res, modeloErr);

    const auth = autorizarDefinirEstadoGlobal(req.user, modelo);
    if (!auth.ok) {
      return responderErroModelo(res, auth.erro, auth.erro.status || 403);
    }

    F12PolicyService.definirEstadoGlobal(ativo, (defErr) => {
      if (defErr) return responderErroModelo(res, defErr);

      auditarF12(req, 'alterar_estado_global', {
        novo_estado: ativo,
        controle: modelo.controle,
        escopo: modelo.escopo
      });

      res.json({
        success: true,
        ativo,
        mensagem: ativo
          ? 'Modo fiscal ativado para todos os caixas.'
          : 'Modo completo ativado para todos os caixas.'
      });
    });
  });
});

// ============================================
// GET /api/f12/caixas
// ============================================
router.get('/caixas', verificarToken, (req, res) => {
  F12PolicyService.listarCaixasComEstado((err, caixas) => {
    if (err) return responderErroModelo(res, err);
    res.json({
      data: (caixas || []).map((c) => ({
        id: c.id,
        nome: c.nome,
        descricao: c.descricao,
        f12_ativo: c.f12_ativo === 1 || c.f12_ativo === '1',
        ativo: c.ativo === 1 || c.ativo === '1'
      }))
    });
  });
});

// ============================================
// PUT /api/f12/caixas/:caixaId/estado
// ============================================
router.put('/caixas/:caixaId/estado', verificarToken, (req, res) => {
  const caixaId = Number(req.params.caixaId);
  const { ativo } = req.body;

  if (!caixaId) {
    return res.status(400).json({ error: 'caixaId inválido' });
  }
  if (typeof ativo !== 'boolean') {
    return res.status(400).json({ error: 'ativo deve ser boolean' });
  }

  F12PolicyService.obterModeloControle((modeloErr, modelo) => {
    if (modeloErr) return responderErroModelo(res, modeloErr);

    const auth = autorizarDefinirEstadoCaixa(req.user, modelo, caixaId);
    if (!auth.ok) {
      return responderErroModelo(res, auth.erro, auth.erro.status || 403);
    }

    F12PolicyService.definirEstadoCaixa(caixaId, ativo, (defErr) => {
      if (defErr) return responderErroModelo(res, defErr);

      auditarF12(req, 'alterar_estado_caixa', {
        caixa_id: caixaId,
        novo_estado: ativo,
        controle: modelo.controle,
        escopo: modelo.escopo
      });

      res.json({
        success: true,
        caixaId,
        ativo,
        mensagem: ativo
          ? `Caixa ${caixaId} definido para modo fiscal.`
          : `Caixa ${caixaId} definido para modo completo.`
      });
    });
  });
});

// ============================================
// PUT /api/f12/caixas/:caixaId/alternar
// ============================================
router.put('/caixas/:caixaId/alternar', verificarToken, (req, res) => {
  const caixaId = Number(req.params.caixaId);
  if (!caixaId) {
    return res.status(400).json({ error: 'caixaId inválido' });
  }

  F12PolicyService.executarToggleF12(caixaId, req.user, (altErr, resultado) => {
    if (altErr) return responderErroModelo(res, altErr);

    auditarF12(req, 'alternar_estado_caixa', {
      caixa_id: caixaId,
      novo_estado: resultado.novoEstado,
      origem: resultado.origem
    });

    res.json({
      success: true,
      caixaId,
      novoEstado: resultado.novoEstado,
      mensagem: resultado.novoEstado ? 'Modo fiscal ativado.' : 'Modo completo ativado.'
    });
  });
});

// ============================================
// PUT /api/f12/controle
// ============================================
router.put('/controle', verificarToken, exigirAdmin, (req, res) => {
  const { controle, escopo } = req.body || {};

  F12PolicyService.definirModeloControle(controle, escopo, (defErr) => {
    if (defErr) {
      return res.status(400).json({ error: defErr.message });
    }

    F12PolicyService.obterModeloControle((getErr, modelo) => {
      if (getErr) return responderErroModelo(res, getErr);

      auditarF12(req, 'alterar_controle', {
        controle: modelo.controle,
        escopo: modelo.escopo
      });

      res.json({
        success: true,
        controle: modelo.controle,
        escopo: modelo.escopo,
        mensagem: `Controle definido: ${labelsControle(modelo.controle, modelo.escopo)}`
      });
    });
  });
});

// ============================================
// PUT /api/f12/politica  (compatibilidade)
// ============================================
router.put('/politica', verificarToken, exigirAdmin, (req, res) => {
  const { politica, controle, escopo } = req.body || {};

  const finalizar = (defErr) => {
    if (defErr) {
      return res.status(400).json({ error: defErr.message || 'Controle inválido' });
    }

    F12PolicyService.obterModeloControle((getErr, modelo) => {
      if (getErr) return responderErroModelo(res, getErr);
      const politicaLegada = require('../lib/f12ModeloControle')
        .mapearModeloParaPoliticaLegada(modelo.controle, modelo.escopo);

      auditarF12(req, 'alterar_controle', {
        controle: modelo.controle,
        escopo: modelo.escopo,
        politicaLegada
      });

      res.json({
        success: true,
        controle: modelo.controle,
        escopo: modelo.escopo,
        politica: politicaLegada,
        politicaLegada,
        label: labelsControle(modelo.controle, modelo.escopo),
        mensagem: `Controle definido: ${labelsControle(modelo.controle, modelo.escopo)}`
      });
    });
  };

  if (controle) {
    return F12PolicyService.definirModeloControle(controle, escopo, finalizar);
  }

  if (!politica || !['POR_CAIXA', 'GLOBAL', 'MODO_ADMIN'].includes(String(politica).toUpperCase())) {
    return res.status(400).json({
      error: 'Controle inválido. Use OPERADOR / ADMINISTRADOR ou, em compatibilidade, POR_CAIXA, GLOBAL ou MODO_ADMIN.'
    });
  }

  F12PolicyService.definirPolitica(politica, finalizar);
});

// ============================================
// GET /api/f12/info
// ============================================
router.get('/info', verificarToken, (req, res) => {
  F12PolicyService.obterModeloControle((modeloErr, modelo) => {
    if (modeloErr) return responderErroModelo(res, modeloErr);

    const politicaLegada = require('../lib/f12ModeloControle')
      .mapearModeloParaPoliticaLegada(modelo.controle, modelo.escopo);

    res.json({
      controle: modelo.controle,
      escopo: modelo.escopo,
      label: labelsControle(modelo.controle, modelo.escopo),
      estadoGlobal: modelo.globalAtivo,
      podeAlterar: resolverPodeAlterarF12({
        controle: modelo.controle,
        user: req.user
      }),
      podeOperadorAlterar: F12PolicyService.podeOperadorAlterarF12(politicaLegada, req.user),
      isAdmin: isAdmin(req.user),
      politica: politicaLegada,
      politicaLegada
    });
  });
});

module.exports = router;
