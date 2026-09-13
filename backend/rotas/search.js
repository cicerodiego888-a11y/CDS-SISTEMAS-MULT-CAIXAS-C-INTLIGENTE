'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database');
const {
  obterSearchService,
  obterSearchSDK,
  obterKnowledge,
  EVENTOS
} = require('../motores/mib');

function obterKg() {
  return obterKnowledge(db);
}

function ctxFromReq(req, body = {}) {
  const user = req.user || {};
  return {
    entity: body.entity || req.query.entity || 'produto',
    query: body.query ?? body.q ?? req.query.q ?? '',
    limite: body.limite || req.query.limite || 20,
    modoFiscal: body.modo_fiscal ?? body.modoFiscal,
    operador_id: user.id || req.operadorId || body.operador_id || null,
    filial_id: user.filial_id || body.filial_id || null,
    caixa_id: req.caixaId || body.caixa_id || null,
    origem: body.origem || req.headers['x-cds-origem'] || 'api',
    permissoes: user.permissoes,
    perfil: user.perfil,
    role: user.role,
    user
  };
}

function obterSvc() {
  return obterSearchService(db);
}

/** POST /api/search — endpoint único Enterprise */
router.post('/', async (req, res) => {
  try {
    const params = ctxFromReq(req, req.body || {});
    if (!String(params.query || '').trim()) {
      return res.json({ entity: params.entity, itens: [], meta: { estrategia: 'vazio' } });
    }
    const resultado = await obterSvc().search(params);
    return res.json(resultado);
  } catch (err) {
    const status = err.code === 'SEARCH_FORBIDDEN' ? 403
      : err.code === 'SEARCH_ENTITY_UNKNOWN' ? 400
        : 500;
    return res.status(status).json({ error: err.message, code: err.code || 'SEARCH_ERROR' });
  }
});

/** GET /api/search?entity=&q= — atalho compatível */
router.get('/', async (req, res) => {
  try {
    const params = ctxFromReq(req, {
      entity: req.query.entity,
      query: req.query.q || req.query.query,
      limite: req.query.limite
    });
    if (!String(params.query || '').trim()) {
      return res.json({ entity: params.entity, itens: [], meta: { estrategia: 'vazio' } });
    }
    return res.json(await obterSvc().search(params));
  } catch (err) {
    const status = err.code === 'SEARCH_FORBIDDEN' ? 403
      : err.code === 'SEARCH_ENTITY_UNKNOWN' ? 400
        : 500;
    return res.status(status).json({ error: err.message, code: err.code });
  }
});

router.get('/providers', async (req, res) => {
  try {
    const svc = obterSvc();
    if (!svc._pronto) await svc.iniciar();
    return res.json(svc.listarProviders());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/statistics', async (req, res) => {
  try {
    const svc = obterSvc();
    if (!svc._pronto) await svc.iniciar();
    return res.json(svc.statistics());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/enterprise', async (req, res) => {
  try {
    const svc = obterSvc();
    if (!svc._pronto) await svc.iniciar();
    return res.json(await svc.enterpriseDashboard());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/learn', async (req, res) => {
  try {
    const sdk = obterSearchSDK(db);
    const aprendizado = await sdk.learn({
      ...(req.body || {}),
      operador_id: req.user?.id || req.body?.operador_id
    });
    return res.json({ ok: true, aprendizado });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/rebuild', async (req, res) => {
  try {
    const sdk = obterSearchSDK(db);
    return res.json(await sdk.rebuild());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/benchmark', async (req, res) => {
  try {
    const sdk = obterSearchSDK(db);
    const entities = req.body?.entities;
    return res.json(await sdk.benchmark(entities));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/events', (req, res) => {
  return res.json({
    eventos: Object.values(EVENTOS).filter(
      (e) => String(e).startsWith('Search') || String(e).startsWith('Knowledge') || String(e).startsWith('Recommendation')
    )
  });
});

// ─── MIB-RC4.0 Knowledge Graph APIs ───────────────────────────────────────────

router.get('/recommendations', async (req, res) => {
  try {
    const produtoId = Number(req.query.produto_id || req.query.id);
    if (!produtoId) return res.status(400).json({ error: 'produto_id obrigatório' });
    const data = await obterKg().recommendations(produtoId, Number(req.query.limite) || 8);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/recommend', async (req, res) => {
  try {
    const produtoId = Number(req.body?.produto_id || req.body?.id);
    if (!produtoId) return res.status(400).json({ error: 'produto_id obrigatório' });
    const data = await obterKg().recommendations(produtoId, Number(req.body?.limite) || 8);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/similar', async (req, res) => {
  try {
    const produtoId = Number(req.query.produto_id || req.query.id);
    if (!produtoId) return res.status(400).json({ error: 'produto_id obrigatório' });
    return res.json(await obterKg().similar(produtoId, Number(req.query.limite) || 10));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/duplicates', async (req, res) => {
  try {
    return res.json(await obterKg().detectDuplicates());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/graph', async (req, res) => {
  try {
    return res.json(await obterKg().graphView(Number(req.query.limite) || 100));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/graph/rebuild', async (req, res) => {
  try {
    const kg = obterKg();
    const result = await kg.rebuild({ leve: Boolean(req.body?.leve), dias: req.body?.dias });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/knowledge', async (req, res) => {
  try {
    return res.json(await obterKg().dashboard());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/cadastro/sugerir', async (req, res) => {
  try {
    return res.json(await obterKg().sugerirCadastro(req.body || {}));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/miip/enrich', async (req, res) => {
  try {
    const { consultarGrafoMiip } = require('../motores/mib');
    return res.json(await consultarGrafoMiip(db, req.body || {}, { origem: 'miip' }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
