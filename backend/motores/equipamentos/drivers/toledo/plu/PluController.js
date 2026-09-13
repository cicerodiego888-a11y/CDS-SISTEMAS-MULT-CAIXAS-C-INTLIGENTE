/**
 * Sprint 14.7 — PluController
 * RC15.1 — upload-plus por equipamento (reutiliza ToledoPluEngine).
 */

'use strict';

const toledoPluEngine = require('./ToledoPluEngine');
const connectionManager = require('../../../connection/ConnectionManager');
const equipamentosRepository = require('../../../repositories/EquipamentosRepository');
const produtoBalancaSyncLog = require('./ProdutoBalancaSyncLogService');
const modoEnvio = require('../../../mgv6/MGV6ModoEnvio');

function extrairValidationReport(error) {
  if (!error) return null;
  return error.validationReport
    || error.meta?.validationReport
    || null;
}

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  const report = extrairValidationReport(error);
  const errors = report?.errors
    || error.meta?.errors
    || null;
  const payload = {
    success: false,
    sucesso: false,
    error: error.message || mensagemPadrao,
    mensagem: error.message || mensagemPadrao,
    code: error.code || null,
    codigo: error.codigo || error.code || null
  };
  // RC15.5 — nunca só VALIDATION_ERROR: inclui motivos por campo
  if (report) {
    payload.validationReport = report;
    payload.errors = report.errors;
    payload.checklist = error.meta?.checklist || null;
    payload.mensagem = 'Produto não enviado';
    payload.motivos = (report.errors || []).map((e) => e.motivo);
  } else if (Array.isArray(errors) && errors.length) {
    payload.errors = errors;
  }
  // RC15.6 — divergência Diagnóstico × Upload
  if (error.code === 'UPLOAD_USANDO_SESSAO_DIFERENTE' || error.divergencias) {
    payload.divergencias = error.divergencias || error.meta?.divergencias || null;
    payload.diagnostico = error.diagnostico || error.meta?.diagnostico || null;
    payload.uploadSession = error.upload || error.meta?.upload || null;
  }
  return res.status(status).json(payload);
}

/** Garante campos mínimos CDS → balança (departamento padrão Toledo = 1). */
function enriquecerProdutoParaPlu(produto) {
  if (!produto || typeof produto !== 'object') return produto;
  return {
    ...produto,
    departamento: produto.departamento != null
      ? produto.departamento
      : (produto.departamento_id != null ? produto.departamento_id : 1),
    unidade: (produto.unidade != null && String(produto.unidade).trim() !== '')
      ? produto.unidade
      : 'kg'
  };
}

/**
 * RC15.1 — resolve produtos do ERP a partir de códigos PLU / ids.
 * @param {Array<number|string>} plus
 * @returns {Promise<object[]>}
 */
function carregarProdutosPorPlus(plus) {
  return new Promise((resolve, reject) => {
    const lista = (Array.isArray(plus) ? plus : [])
      .map((v) => String(v).trim())
      .filter(Boolean);
    if (!lista.length) {
      resolve([]);
      return;
    }
    let db;
    try {
      db = require('../../../../../database');
    } catch (err) {
      reject(err);
      return;
    }
    const placeholders = lista.map(() => '?').join(',');
    // RC15.2 — apenas produtos pesáveis (produto_fracionado/vendido_por_peso) e ativos
    const sql = `
      SELECT
        p.id,
        p.codigo,
        p.nome,
        p.preco_venda,
        p.unidade,
        COALESCE(p.produto_fracionado, 0) AS produto_fracionado,
        COALESCE(p.ativo, 1) AS ativo,
        (
          SELECT pi.codigo FROM produto_identificadores pi
          WHERE pi.produto_id = p.id
            AND pi.tipo = 'PLU'
            AND COALESCE(pi.ativo, 1) = 1
          ORDER BY COALESCE(pi.principal, 0) DESC, pi.id DESC
          LIMIT 1
        ) AS plu
      FROM produtos p
      WHERE COALESCE(p.ativo, 1) = 1
        AND COALESCE(p.produto_fracionado, 0) = 1
        AND (
          CAST(p.id AS TEXT) IN (${placeholders})
          OR TRIM(CAST(p.codigo AS TEXT)) IN (${placeholders})
          OR EXISTS (
            SELECT 1 FROM produto_identificadores pi2
            WHERE pi2.produto_id = p.id
              AND pi2.tipo = 'PLU'
              AND COALESCE(pi2.ativo, 1) = 1
              AND TRIM(CAST(pi2.codigo AS TEXT)) IN (${placeholders})
          )
        )
      ORDER BY p.nome
    `;
    const params = [...lista, ...lista, ...lista];
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      const listaRows = Array.isArray(rows) ? rows : [];
      resolve(listaRows.map(enriquecerProdutoParaPlu));
    });
  });
}

async function upload(req, res) {
  try {
    const body = req.body || {};
    const produto = body.produto || body;
    const result = await toledoPluEngine.upload(produto, {
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      persistir: body.persistir !== false,
      timeout: body.timeout
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro no upload de PLU.');
  }
}

async function uploadMany(req, res) {
  const inicio = Date.now();
  try {
    const body = req.body || {};
    const lista = body.produtos || body.lista || body.items || [];
    const equipamentoId = body.equipamentoId != null ? Number(body.equipamentoId) : (body.equipamento_id != null ? Number(body.equipamento_id) : null);
    const operacao = produtoBalancaSyncLog.resolverOperacaoLote(body);
    const usuarioId = produtoBalancaSyncLog.resolverUsuarioId(req);
    const result = await toledoPluEngine.uploadMany(lista, {
      host: body.host || body.ip,
      porta: body.porta != null ? body.porta : body.porta_tcp,
      persistir: body.persistir !== false,
      timeout: body.timeout,
      equipamentoId
    });
    await registrarLogsLote({
      produtos: lista,
      resultados: result.resultados || [],
      equipamentoId,
      operacao,
      usuarioId,
      tempoMsTotal: Date.now() - inicio
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro no upload em lote.');
  }
}

async function history(req, res) {
  try {
    const historico = await toledoPluEngine.history({
      limite: Number(req.query.limite) || 50,
      host: req.query.host,
      porta: req.query.porta != null ? Number(req.query.porta) : undefined,
      plu: req.query.plu,
      produto_id: req.query.produto_id != null ? Number(req.query.produto_id) : undefined
    });
    return res.json({ success: true, historico });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico PLU.');
  }
}

async function status(req, res) {
  try {
    return res.json({ success: true, ...toledoPluEngine.status() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar status PLU.');
  }
}

async function cancel(req, res) {
  try {
    return res.json({ success: true, ...toledoPluEngine.cancel() });
  } catch (error) {
    return responderErro(res, error, 'Erro ao cancelar upload.');
  }
}

async function retry(req, res) {
  try {
    const body = req.body || {};
    const result = await toledoPluEngine.retry(body.syncId || body.id, {
      host: body.host,
      porta: body.porta,
      produto: body.produto
    });
    return res.json(result);
  } catch (error) {
    return responderErro(res, error, 'Erro no retry de PLU.');
  }
}

/**
 * RC15.1 — POST /api/equipamentos/:id/upload-plus
 * Body: { plus: [1001, 1002] }
 * Reutiliza exclusivamente ToledoPluEngine.uploadMany (Mapper → Builder → UploadPluOperation).
 */
async function uploadPlus(req, res) {
  const inicio = Date.now();
  try {
    const equipamentoId = Number(req.params.id);
    if (!Number.isFinite(equipamentoId) || equipamentoId <= 0) {
      const err = new Error('id do equipamento inválido');
      err.statusCode = 400;
      throw err;
    }

    // RC14.15.3 — barreira de modo: MGV6 não abre TCP / handshake
    await modoEnvio.garantirModoTcp(equipamentoId);

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const plus = body.plus || body.plus_ids || body.produto_ids || body.ids || [];
    if (!Array.isArray(plus) || !plus.length) {
      const err = new Error('Informe plus: [codigo1, codigo2, ...]');
      err.statusCode = 400;
      throw err;
    }

    const equipamento = await equipamentosRepository.buscarPorId(equipamentoId);
    if (!equipamento) {
      const err = new Error('Equipamento não encontrado');
      err.statusCode = 404;
      throw err;
    }

    const host = body.host || body.ip || equipamento.ip || equipamento.host;
    const porta = Number(
      body.porta != null ? body.porta
        : (body.porta_tcp != null ? body.porta_tcp : (equipamento.porta_tcp || equipamento.porta || 9000))
    );
    if (!host || !porta) {
      const err = new Error('Equipamento sem IP/porta configurados');
      err.statusCode = 400;
      throw err;
    }

    // Garante sessão via Motor Universal (ConnectionManager)
    if (!connectionManager.isConnected({ equipamentoId, host, porta })) {
      await connectionManager.connect({
        equipamentoId,
        host,
        porta,
        persistir: true
      });
    }

    const produtos = await carregarProdutosPorPlus(plus);
    if (!produtos.length) {
      const err = new Error('Nenhum produto encontrado para os PLUs informados');
      err.statusCode = 404;
      throw err;
    }

    const operacao = produtoBalancaSyncLog.resolverOperacaoLote(body);
    const usuarioId = produtoBalancaSyncLog.resolverUsuarioId(req);

    const result = await toledoPluEngine.uploadMany(produtos, {
      host,
      porta,
      equipamentoId,
      persistir: body.persistir !== false,
      timeout: body.timeout
    });

    await registrarLogsLote({
      produtos,
      resultados: result.resultados || [],
      equipamentoId,
      operacao,
      usuarioId,
      tempoMsTotal: Date.now() - inicio
    });

    return res.json({
      success: result.success === true,
      equipamento_id: equipamentoId,
      host,
      porta,
      total: result.total,
      ok: result.ok,
      erro: result.erro,
      cancelled: result.cancelled,
      resultados: (result.resultados || []).map((r) => {
        const falhou = r.success === false || r.error;
        return {
          success: !falhou,
          plu: r.plu || r.produto?.plu || r.produto?.codigo || null,
          error: falhou ? (r.error || 'VALIDATION_ERROR') : null,
          code: r.code || null,
          mensagem: falhou ? 'Produto não enviado' : 'Produto enviado',
          motivos: r.motivos || (r.validationReport?.errors || []).map((e) => e.motivo),
          errors: r.errors || r.validationReport?.errors || null,
          validationReport: r.validationReport || null
        };
      }),
      engine: 'ToledoPluEngine',
      operation: 'UPLOAD_PLU'
    });
  } catch (error) {
    return responderErro(res, error, 'Erro no envio de produtos para a balança.');
  }
}

/**
 * RC15.3 — carrega produto pelo id no banco (fonte da verdade).
 * @param {number} produtoId
 * @returns {Promise<object|null>}
 */
function carregarProdutoPorId(produtoId) {
  return new Promise((resolve, reject) => {
    const id = Number(produtoId);
    if (!Number.isFinite(id) || id <= 0) {
      resolve(null);
      return;
    }
    let db;
    try {
      db = require('../../../../../database');
    } catch (err) {
      reject(err);
      return;
    }
    const sql = `
      SELECT
        p.id,
        p.codigo,
        p.nome,
        p.preco_venda,
        p.unidade,
        COALESCE(p.produto_fracionado, 0) AS produto_fracionado,
        COALESCE(p.ativo, 1) AS ativo,
        (
          SELECT pi.codigo FROM produto_identificadores pi
          WHERE pi.produto_id = p.id
            AND pi.tipo = 'PLU'
            AND COALESCE(pi.ativo, 1) = 1
          ORDER BY COALESCE(pi.principal, 0) DESC, pi.id DESC
          LIMIT 1
        ) AS plu
      FROM produtos p
      WHERE p.id = ?
      LIMIT 1
    `;
    db.get(sql, [id], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row ? enriquecerProdutoParaPlu(row) : null);
    });
  });
}

/**
 * RC15.3 — POST /api/equipamentos/:id/upload-produto
 * Body: { produtoId: 125 }
 * Localiza produto no banco, valida e chama ToledoPluEngine.uploadOne.
 */
async function uploadProduto(req, res) {
  const inicio = Date.now();
  const usuarioId = produtoBalancaSyncLog.resolverUsuarioId(req);
  let ctxLog = {
    produto_id: null,
    equipamento_id: Number(req.params.id) || null,
    plu: null
  };
  try {
    const equipamentoId = Number(req.params.id);
    if (!Number.isFinite(equipamentoId) || equipamentoId <= 0) {
      const err = new Error('id do equipamento inválido');
      err.statusCode = 400;
      throw err;
    }
    ctxLog.equipamento_id = equipamentoId;

    // RC14.15.3 — barreira de modo antes de qualquer connect/handshake
    await modoEnvio.garantirModoTcp(equipamentoId);

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const produtoId = Number(body.produtoId ?? body.produto_id ?? body.id);
    if (!Number.isFinite(produtoId) || produtoId <= 0) {
      const err = new Error('Informe produtoId');
      err.statusCode = 400;
      throw err;
    }
    ctxLog.produto_id = produtoId;

    const produto = await carregarProdutoPorId(produtoId);
    if (!produto) {
      const err = new Error('Produto não encontrado');
      err.statusCode = 404;
      throw err;
    }

    if (Number(produto.ativo ?? 1) !== 1) {
      const err = new Error('Produto inativo — envio para balança não permitido');
      err.statusCode = 400;
      err.code = 'PRODUTO_INATIVO';
      throw err;
    }

    if (Number(produto.produto_fracionado ?? 0) !== 1) {
      const err = new Error('Produto não pesável — envio para balança não permitido');
      err.statusCode = 400;
      err.code = 'PRODUTO_NAO_PESAVEL';
      throw err;
    }

    const plu = produto.plu != null ? String(produto.plu).trim() : '';
    if (!plu || !/^\d{1,10}$/.test(plu)) {
      const err = new Error('Produto sem PLU válido — envio para balança não permitido');
      err.statusCode = 400;
      err.code = 'PLU_INVALIDO';
      throw err;
    }
    ctxLog.plu = plu;
    ctxLog.produto_id = produto.id;

    const equipamento = await equipamentosRepository.buscarPorId(equipamentoId);
    if (!equipamento) {
      const err = new Error('Equipamento não encontrado');
      err.statusCode = 404;
      throw err;
    }

    const host = equipamento.ip || equipamento.host;
    const porta = Number(equipamento.porta_tcp || equipamento.porta || 9000);
    if (!host || !porta) {
      const err = new Error('Equipamento sem IP/porta configurados');
      err.statusCode = 400;
      throw err;
    }

    // Conecta se necessário; falha se não conectar
    if (!connectionManager.isConnected({ equipamentoId, host, porta })) {
      try {
        await connectionManager.connect({
          equipamentoId,
          host,
          porta,
          persistir: true
        });
      } catch (connErr) {
        const err = new Error('Equipamento desconectado — não foi possível conectar');
        err.statusCode = 503;
        err.code = 'EQUIPAMENTO_DESCONECTADO';
        err.cause = connErr;
        throw err;
      }
    }
    if (!connectionManager.isConnected({ equipamentoId, host, porta })) {
      const err = new Error('Equipamento desconectado');
      err.statusCode = 503;
      err.code = 'EQUIPAMENTO_DESCONECTADO';
      throw err;
    }

    // Nunca usa payload do front — apenas o produto do banco
    const result = await toledoPluEngine.uploadOne(enriquecerProdutoParaPlu({
      id: produto.id,
      codigo: produto.codigo,
      nome: produto.nome,
      preco_venda: produto.preco_venda,
      unidade: produto.unidade,
      departamento: produto.departamento,
      plu,
      ativo: produto.ativo,
      produto_fracionado: 1,
      vendido_por_peso: 1
    }), {
      host,
      porta,
      equipamentoId,
      persistir: true
    });

    const tempoMs = result.duration != null ? result.duration : (Date.now() - inicio);
    const sincronizadoEm = new Date().toISOString();

    await produtoBalancaSyncLog.registrar({
      produto_id: produto.id,
      equipamento_id: equipamentoId,
      plu,
      operacao: produtoBalancaSyncLog.OPERACOES.ENVIAR_PRODUTO,
      resultado: 'SUCESSO',
      mensagem: 'ACK recebido',
      tempo_ms: tempoMs,
      usuario_id: usuarioId
    });

    return res.json({
      success: true,
      sucesso: true,
      mensagem: 'Produto enviado com sucesso.',
      produto_id: produto.id,
      produto: produto.nome,
      plu,
      equipamento_id: equipamentoId,
      equipamento: equipamento.nome || `${host}:${porta}`,
      host,
      porta,
      tempo_ms: tempoMs,
      sincronizado_em: sincronizadoEm,
      resultado: 'ACK recebido',
      status_sync: 'SINCRONIZADO',
      syncId: result.syncId || null,
      engine: 'ToledoPluEngine',
      operation: 'UPLOAD_PLU'
    });
  } catch (error) {
    const report = extrairValidationReport(error);
    const msgLog = report?.errors?.length
      ? report.errors.map((e) => e.motivo).join(' ')
      : (error.message || 'Falha ao enviar produto.');
    await produtoBalancaSyncLog.registrar({
      produto_id: ctxLog.produto_id,
      equipamento_id: ctxLog.equipamento_id,
      plu: ctxLog.plu,
      operacao: produtoBalancaSyncLog.OPERACOES.ENVIAR_PRODUTO,
      resultado: 'ERRO',
      mensagem: msgLog,
      tempo_ms: Date.now() - inicio,
      usuario_id: usuarioId
    });
    return responderErro(res, error, 'Falha ao enviar produto.');
  }
}

/**
 * RC15.4 — registra um log por item do lote (sem alterar o motor).
 */
async function registrarLogsLote({
  produtos = [],
  resultados = [],
  equipamentoId,
  operacao,
  usuarioId,
  tempoMsTotal
} = {}) {
  const n = Math.max(produtos.length, resultados.length);
  const tempoPorItem = n > 0 && tempoMsTotal != null
    ? Math.round(Number(tempoMsTotal) / n)
    : null;
  for (let i = 0; i < n; i += 1) {
    const p = produtos[i] || {};
    const r = resultados[i] || {};
    const ok = r.success !== false && !r.error && !r.cancelled;
    const plu = r.plu || p.plu || p.codigo || null;
    const duration = r.duration != null ? r.duration : tempoPorItem;
    await produtoBalancaSyncLog.registrar({
      produto_id: p.id != null ? p.id : null,
      equipamento_id: equipamentoId,
      plu,
      operacao: operacao || produtoBalancaSyncLog.OPERACOES.ENVIAR_LOTE,
      resultado: ok ? 'SUCESSO' : 'ERRO',
      mensagem: ok
        ? 'ACK recebido'
        : String(r.error || r.mensagem || 'Produto não enviado'),
      tempo_ms: duration,
      usuario_id: usuarioId
    });
  }
}

/**
 * RC15.4 — GET /api/equipamentos/plu/sync-log
 */
async function syncLogHistorico(req, res) {
  try {
    const historico = await produtoBalancaSyncLog.listar({
      produto_id: req.query.produto_id != null ? Number(req.query.produto_id) : undefined,
      equipamento_id: req.query.equipamento_id != null
        ? Number(req.query.equipamento_id)
        : (req.query.equipamentoId != null ? Number(req.query.equipamentoId) : undefined),
      limite: Number(req.query.limite) || 50
    });
    return res.json({ success: true, historico });
  } catch (error) {
    return responderErro(res, error, 'Erro ao listar histórico de sincronização.');
  }
}

/**
 * RC15.3 — GET /api/equipamentos/plu/ultima-sync?produto_id=
 */
async function ultimaSync(req, res) {
  try {
    const produtoId = Number(req.query.produto_id || req.query.produtoId);
    if (!Number.isFinite(produtoId) || produtoId <= 0) {
      const err = new Error('Informe produto_id');
      err.statusCode = 400;
      throw err;
    }
    const repo = toledoPluEngine.repository;
    const row = typeof repo.ultimaConfirmada === 'function'
      ? await repo.ultimaConfirmada(produtoId)
      : null;
    return res.json({
      success: true,
      produto_id: produtoId,
      sincronizado_em: row?.confirmado_em || row?.enviado_em || null,
      status: row ? 'SINCRONIZADO' : 'NUNCA',
      plu: row?.plu || null,
      host: row?.host || null,
      porta: row?.porta != null ? row.porta : null
    });
  } catch (error) {
    return responderErro(res, error, 'Erro ao consultar última sincronização.');
  }
}

module.exports = {
  upload,
  uploadMany,
  uploadPlus,
  uploadProduto,
  ultimaSync,
  syncLogHistorico,
  history,
  status,
  cancel,
  retry,
  carregarProdutosPorPlus,
  carregarProdutoPorId
};
