/**
 * Sprint 01/02 — Serviço principal Fechamento Fiscal do Dia.
 */

'use strict';

const { arredondarMoeda, toCentavos, somarMoeda } = require('../fiscal/modeloTotais');
const { STATUS, STATUS_ATIVOS, DEFAULTS_DISTRIBUICAO } = require('./constants');
const {
  listarProdutosElegiveisDoDia,
  listarLotesElegiveisDoDia,
  listarMonitoramentoProdutosDoDia,
  obterResumoDia,
  snapshotComercial
} = require('./FechamentoFiscalElegibilidadeService');
const { gerarPreviaDistribuicao } = require('./FechamentoFiscalDistribuicaoService');
const preparacao = require('./FechamentoFiscalPreparacaoService');
const moduloConfig = require('./fechamentoFiscalModuloConfig');

function getDb(dbOverride) {
  if (dbOverride) return dbOverride;
  return require('../../database');
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function agoraLocal() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Sprint 05 — defesa em profundidade: módulo ON também no serviço.
 * deps.moduloOn força o resultado; deps.skipModuloCheck só para testes internos legados.
 */
async function assertModuloAtivo(db, deps = {}) {
  if (deps.skipModuloCheck === true) return true;
  if (deps.moduloOn != null) {
    if (!deps.moduloOn) {
      const err = new Error('Fechamento Fiscal do Dia está desativado.');
      err.statusCode = 403;
      err.code = 'MODULO_OFF';
      throw err;
    }
    return true;
  }
  const ok = await moduloConfig.estaAtivadaAsync(db);
  if (!ok) {
    const err = new Error('Fechamento Fiscal do Dia está desativado.');
    err.statusCode = 403;
    err.code = 'MODULO_OFF';
    throw err;
  }
  return true;
}

function normalizarData(data) {
  const d = String(data || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const err = new Error('Data inválida. Use YYYY-MM-DD.');
    err.statusCode = 400;
    throw err;
  }
  return d;
}

function normalizarCnpj(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

function logTecnico(evento, payload = {}) {
  // eslint-disable-next-line no-console
  console.log(`[FechamentoFiscal] ${evento}`, JSON.stringify(payload));
}

async function resolverCnpjEmpresa(db, cnpjInformado) {
  const digits = normalizarCnpj(cnpjInformado);
  if (digits) return digits;
  try {
    const row = await get(db, `SELECT valor FROM configuracoes WHERE chave = 'cnpj' LIMIT 1`);
    return normalizarCnpj(row?.valor);
  } catch (_) {
    return '';
  }
}

async function buscarAtivoPorDia(db, { data_fechamento, cnpj }) {
  const placeholders = STATUS_ATIVOS.map(() => '?').join(',');
  return get(
    db,
    `SELECT * FROM fechamentos_fiscais
     WHERE data_fechamento = ?
       AND cnpj = ?
       AND status IN (${placeholders})
     ORDER BY id DESC LIMIT 1`,
    [data_fechamento, cnpj, ...STATUS_ATIVOS]
  );
}

async function listarRecebimentos(db, fechamentoId) {
  return all(
    db,
    `SELECT * FROM fechamentos_fiscais_recebimentos
     WHERE fechamento_fiscal_id = ?
     ORDER BY id ASC`,
    [fechamentoId]
  );
}

async function recalcularTotaisRecebimentos(db, fechamentoId) {
  const rows = await listarRecebimentos(db, fechamentoId);
  const valorInformado = somarMoeda(rows.map((r) => r.valor));
  await run(
    db,
    `UPDATE fechamentos_fiscais
     SET valor_informado = ?,
         quantidade_maquinas = ?,
         atualizado_em = ?
     WHERE id = ?`,
    [valorInformado, rows.length, agoraLocal(), fechamentoId]
  );
  return { valorInformado, quantidade: rows.length, recebimentos: rows };
}

async function montarDetalhe(db, row) {
  if (!row) return null;
  const recebimentos = await listarRecebimentos(db, row.id);
  const itens = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_itens WHERE fechamento_fiscal_id = ? ORDER BY ordem, id`,
    [row.id]
  );
  const previaVendas = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id = ? ORDER BY sequencia`,
    [row.id]
  );
  const previaItens = await all(
    db,
    `SELECT * FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id = ? ORDER BY previa_venda_id, ordem, id`,
    [row.id]
  ).catch(() => []);

  const documentos = await preparacao.listarDocumentos(db, row.id).catch(() => []);

  const itensPorVenda = new Map();
  for (const it of previaItens) {
    const list = itensPorVenda.get(it.previa_venda_id) || [];
    list.push(it);
    itensPorVenda.set(it.previa_venda_id, list);
  }

  return {
    ...row,
    valor_informado: arredondarMoeda(row.valor_informado),
    valor_distribuido: arredondarMoeda(row.valor_distribuido),
    diferenca: arredondarMoeda(row.diferenca),
    recebimentos,
    itens,
    previa_vendas: previaVendas.map((v) => ({
      ...v,
      valor: arredondarMoeda(v.valor),
      itens: itensPorVenda.get(v.id) || []
    })),
    documentos,
    transmissao_habilitada: false
  };
}

async function criarRascunho(payload = {}, deps = {}) {
  const db = getDb(deps.db);
  await assertModuloAtivo(db, deps);
  const data = normalizarData(payload.data_fechamento || payload.data);
  const cnpj = await resolverCnpjEmpresa(db, payload.cnpj);

  await run(db, 'BEGIN IMMEDIATE');
  try {
    const existente = await buscarAtivoPorDia(db, { data_fechamento: data, cnpj });
    if (existente) {
      await run(db, 'ROLLBACK');
      const err = new Error('Já existe um fechamento fiscal para esta data.');
      err.statusCode = 409;
      err.code = 'FECHAMENTO_DUPLICADO';
      err.fechamento = await montarDetalhe(db, existente);
      throw err;
    }

    const valorAlvo = Number(payload.valor_alvo != null ? payload.valor_alvo : DEFAULTS_DISTRIBUICAO.valorAlvo);
    const valorMin = Number(payload.valor_min != null ? payload.valor_min : DEFAULTS_DISTRIBUICAO.valorMin);
    const valorMax = Number(payload.valor_max != null ? payload.valor_max : DEFAULTS_DISTRIBUICAO.valorMax);
    const auto = payload.distribuicao_automatica === false || payload.distribuicao_automatica === 0 ? 0 : 1;
    const usuarioId = payload.usuario_id != null ? Number(payload.usuario_id) : null;
    const now = agoraLocal();

    const r = await run(
      db,
      `INSERT INTO fechamentos_fiscais (
        data_fechamento, cnpj, empresa_id, valor_informado, valor_distribuido, diferenca,
        valor_alvo, valor_min, valor_max, distribuicao_automatica, status, usuario_id,
        quantidade_maquinas, data_referencia_comercial, criado_em, atualizado_em
      ) VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        data,
        cnpj,
        payload.empresa_id != null ? Number(payload.empresa_id) : null,
        valorAlvo,
        valorMin,
        valorMax,
        auto,
        STATUS.RASCUNHO,
        usuarioId,
        data,
        now,
        now
      ]
    );
    await run(db, 'COMMIT');
    const row = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [r.lastID]);
    logTecnico('rascunho_criado', { id: r.lastID, data, cnpj, usuario_id: usuarioId });
    return montarDetalhe(db, row);
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

async function listarFechamentos(filtros = {}, deps = {}) {
  const db = getDb(deps.db);
  const params = [];
  const where = [];
  if (filtros.data) {
    where.push('data_fechamento = ?');
    params.push(normalizarData(filtros.data));
  }
  if (filtros.cnpj) {
    where.push('cnpj = ?');
    params.push(normalizarCnpj(filtros.cnpj));
  }
  if (filtros.status) {
    where.push('status = ?');
    params.push(String(filtros.status).toUpperCase());
  }
  const sql = `
    SELECT * FROM fechamentos_fiscais
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY data_fechamento DESC, id DESC
    LIMIT ${Math.min(Number(filtros.limite) || 100, 500)}
  `;
  const rows = await all(db, sql, params);
  return Promise.all(rows.map((r) => montarDetalhe(db, r)));
}

async function obterPorId(id, deps = {}) {
  const db = getDb(deps.db);
  const row = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [Number(id)]);
  if (!row) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    throw err;
  }
  return montarDetalhe(db, row);
}

async function adicionarRecebimento(fechamentoId, payload = {}, deps = {}) {
  const db = getDb(deps.db);
  await assertModuloAtivo(db, deps);
  const ff = await obterPorId(fechamentoId, { db });
  if (![STATUS.RASCUNHO, STATUS.PREVIA].includes(ff.status)) {
    const err = new Error('Recebimentos só podem ser alterados em RASCUNHO ou PREVIA.');
    err.statusCode = 400;
    throw err;
  }
  const operadora = String(payload.operadora || payload.descricao || '').trim();
  if (!operadora) {
    const err = new Error('Informe a máquina/operadora.');
    err.statusCode = 400;
    throw err;
  }
  const valor = arredondarMoeda(payload.valor);
  if (!(valor > 0)) {
    const err = new Error('Valor do recebimento deve ser maior que zero.');
    err.statusCode = 400;
    throw err;
  }
  const cnpjRec = normalizarCnpj(payload.cnpj) || ff.cnpj;

  await run(
    db,
    `INSERT INTO fechamentos_fiscais_recebimentos
      (fechamento_fiscal_id, operadora, descricao, cnpj, valor, observacao, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(fechamentoId),
      operadora,
      payload.descricao != null ? String(payload.descricao) : operadora,
      cnpjRec,
      valor,
      payload.observacao != null ? String(payload.observacao) : null,
      agoraLocal()
    ]
  );

  await recalcularTotaisRecebimentos(db, Number(fechamentoId));
  return obterPorId(fechamentoId, { db });
}

async function removerRecebimento(fechamentoId, recebimentoId, deps = {}) {
  const db = getDb(deps.db);
  await assertModuloAtivo(db, deps);
  const ff = await obterPorId(fechamentoId, { db });
  if (![STATUS.RASCUNHO, STATUS.PREVIA].includes(ff.status)) {
    const err = new Error('Recebimentos só podem ser alterados em RASCUNHO ou PREVIA.');
    err.statusCode = 400;
    throw err;
  }
  const r = await run(
    db,
    `DELETE FROM fechamentos_fiscais_recebimentos
     WHERE id = ? AND fechamento_fiscal_id = ?`,
    [Number(recebimentoId), Number(fechamentoId)]
  );
  if (!r.changes) {
    const err = new Error('Recebimento não encontrado.');
    err.statusCode = 404;
    throw err;
  }
  await recalcularTotaisRecebimentos(db, Number(fechamentoId));
  return obterPorId(fechamentoId, { db });
}

async function persistirPrevia(db, fechamento, previa, produtos, opts) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    await run(db, `DELETE FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id = ?`, [fechamento.id]);
    await run(db, `DELETE FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id = ?`, [fechamento.id]);
    await run(db, `DELETE FROM fechamentos_fiscais_itens WHERE fechamento_fiscal_id = ?`, [fechamento.id]);

    let ordem = 0;
    for (const p of produtos) {
      const usado = (previa.itensUtilizados || []).find((u) => Number(u.produto_id) === Number(p.produto_id));
      await run(
        db,
        `INSERT INTO fechamentos_fiscais_itens
          (fechamento_fiscal_id, produto_id, quantidade_disponivel, valor_vendido_no_dia,
           quantidade_utilizada, valor_utilizado, ordem, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fechamento.id,
          p.produto_id,
          p.quantidade_disponivel,
          p.valor_vendido_no_dia,
          usado ? usado.quantidade_utilizada : 0,
          usado ? usado.valor_utilizado : 0,
          ordem++,
          agoraLocal()
        ]
      );
    }

    for (const v of previa.vendas || []) {
      const ins = await run(
        db,
        `INSERT INTO fechamentos_fiscais_previa_vendas
          (fechamento_fiscal_id, sequencia, valor, quantidade_itens, criado_em)
         VALUES (?, ?, ?, ?, ?)`,
        [fechamento.id, v.sequencia, v.valor, (v.itens || []).length, agoraLocal()]
      );
      let oi = 0;
      for (const it of v.itens || []) {
        await run(
          db,
          `INSERT INTO fechamentos_fiscais_previa_itens
            (previa_venda_id, fechamento_fiscal_id, produto_id, venda_origem_id, venda_item_origem_id,
             quantidade, valor_unitario, valor_total, unidade, ordem, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ins.lastID,
            fechamento.id,
            it.produto_id,
            it.venda_origem_id || null,
            it.venda_item_origem_id || null,
            it.quantidade,
            it.valor_unitario,
            it.valor_total != null ? it.valor_total : it.valor,
            it.unidade || null,
            oi++,
            agoraLocal()
          ]
        );
      }
    }

    await run(
      db,
      `UPDATE fechamentos_fiscais
       SET valor_informado = ?,
           valor_distribuido = ?,
           diferenca = ?,
           valor_alvo = ?,
           valor_min = ?,
           valor_max = ?,
           status = ?,
           atualizado_em = ?
       WHERE id = ?`,
      [
        previa.valor_informado,
        previa.valor_distribuido,
        previa.diferenca,
        opts.valorAlvo,
        opts.valorMin,
        opts.valorMax,
        STATUS.PREVIA,
        agoraLocal(),
        fechamento.id
      ]
    );

    await run(db, 'COMMIT');
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

/**
 * Prévia READ-ONLY sobre tabelas comerciais.
 * Regenerar substitui a prévia anterior (idempotente / sem acumular).
 */
async function gerarPrevia(params = {}, deps = {}) {
  const db = getDb(deps.db);
  await assertModuloAtivo(db, deps);
  const data = normalizarData(params.data || params.data_fechamento);
  const excluirFechamentoId = params.fechamento_id || params.id || null;
  const resumo = await obterResumoDia(db, data, { excluirFechamentoId });
  const lotes = resumo.lotes || [];
  const produtos = resumo.produtos || [];

  let valorInformado = params.valor_informado != null
    ? arredondarMoeda(params.valor_informado)
    : null;

  let fechamento = null;
  if (params.fechamento_id || params.id) {
    fechamento = await obterPorId(params.fechamento_id || params.id, { db });
    if (fechamento.data_fechamento !== data && params.data) {
      // data explícita prevalece; fecha sobre o dia informado
    } else if (!params.data) {
      // usa data do fechamento
    }
    if (valorInformado == null) {
      valorInformado = arredondarMoeda(fechamento.valor_informado);
    }
  }

  if (valorInformado == null) valorInformado = 0;

  const opts = {
    valorAlvo: Number(
      params.valor_alvo != null
        ? params.valor_alvo
        : (fechamento?.valor_alvo ?? DEFAULTS_DISTRIBUICAO.valorAlvo)
    ),
    valorMin: Number(
      params.valor_min != null
        ? params.valor_min
        : (fechamento?.valor_min ?? DEFAULTS_DISTRIBUICAO.valorMin)
    ),
    valorMax: Number(
      params.valor_max != null
        ? params.valor_max
        : (fechamento?.valor_max ?? DEFAULTS_DISTRIBUICAO.valorMax)
    )
  };

  const snapshotAntes = deps.capturarSnapshot !== false
    ? await snapshotComercial(db)
    : null;

  const previa = gerarPreviaDistribuicao(lotes.length ? lotes : produtos, valorInformado, opts);

  logTecnico('previa_gerada', {
    fechamento_id: fechamento?.id || null,
    data,
    valor_alvo: opts.valorAlvo,
    valor_informado: previa.valor_informado,
    valor_distribuido: previa.valor_distribuido,
    diferenca: previa.diferenca,
    quantidade_vendas: previa.quantidade_vendas,
    produtos_elegiveis: previa.metricas?.produtos_elegiveis,
    tempo_ms: previa.metricas?.tempo_ms,
    codigo: previa.codigo
  });

  const devePersistir = Boolean(fechamento) && params.persistir !== false;
  if (devePersistir) {
    if ([STATUS.PRONTO_EMISSAO, STATUS.EMITINDO, STATUS.AUTORIZADO, STATUS.VALIDANDO].includes(fechamento.status)) {
      const err = new Error('Não é possível regenerar a prévia após a preparação fiscal. Cancele o fechamento ou corrija pendências em um novo ciclo.');
      err.statusCode = 400;
      err.code = 'PREVIA_BLOQUEADA';
      throw err;
    }
    // valor zero: limpa prévia anterior sem criar vendas
    if (!(valorInformado > 0)) {
      await run(db, 'BEGIN IMMEDIATE');
      try {
        await run(db, `DELETE FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id = ?`, [fechamento.id]);
        await run(db, `DELETE FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id = ?`, [fechamento.id]);
        await run(
          db,
          `UPDATE fechamentos_fiscais
           SET valor_informado = 0, valor_distribuido = 0, diferenca = 0, status = ?, atualizado_em = ?
           WHERE id = ?`,
          [STATUS.RASCUNHO, agoraLocal(), fechamento.id]
        );
        await run(db, 'COMMIT');
      } catch (err) {
        try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
      }
    } else {
      await persistirPrevia(db, fechamento, previa, produtos, opts);
    }
    fechamento = await obterPorId(fechamento.id, { db });
  }

  const snapshotDepois = deps.capturarSnapshot !== false
    ? await snapshotComercial(db)
    : null;

  return {
    data,
    resumo,
    previa,
    fechamento,
    indicadores: {
      produtos_elegiveis: resumo.itens_fiscais_elegiveis,
      linhas_elegiveis: resumo.linhas_elegiveis,
      quantidade_utilizada: (previa.itensUtilizados || []).reduce((s, i) => s + Number(i.quantidade_utilizada || 0), 0),
      valor_elegivel: previa.valor_elegivel != null ? previa.valor_elegivel : resumo.capacidade_elegivel,
      valor_distribuido: previa.valor_distribuido,
      diferenca: previa.diferenca,
      quantidade_vendas: previa.quantidade_vendas
    },
    protecao: {
      snapshot_antes: snapshotAntes,
      snapshot_depois: snapshotDepois,
      comercial_inalterado: snapshotAntes && snapshotDepois
        ? JSON.stringify(snapshotAntes) === JSON.stringify(snapshotDepois)
        : true
    }
  };
}

async function cancelarFechamento(id, deps = {}) {
  const db = getDb(deps.db);
  await assertModuloAtivo(db, deps);
  const ff = await obterPorId(id, { db });
  if ([STATUS.CONCLUIDO, STATUS.PROCESSANDO, STATUS.EMITINDO, STATUS.AUTORIZADO].includes(ff.status)) {
    const err = new Error('Não é possível cancelar fechamento concluído/processando/autorizado nesta sprint.');
    err.statusCode = 400;
    err.code = 'CANCELAMENTO_BLOQUEADO';
    throw err;
  }
  await run(
    db,
    `UPDATE fechamentos_fiscais SET status = ?, atualizado_em = ? WHERE id = ?`,
    [STATUS.CANCELADO, agoraLocal(), Number(id)]
  );
  logTecnico('fechamento_cancelado', { id: Number(id), status_anterior: ff.status, usuario_id: deps.usuario_id || null });
  return obterPorId(id, { db });
}

async function validarFiscal(id, opts = {}, deps = {}) {
  await assertModuloAtivo(getDb(deps.db), deps);
  return preparacao.validarSomente(id, opts, deps);
}

async function prepararEmissaoFiscal(id, opts = {}, deps = {}) {
  await assertModuloAtivo(getDb(deps.db), deps);
  return preparacao.prepararEmissao(id, opts, deps);
}

async function listarDocumentosFiscais(id, deps = {}) {
  return preparacao.obterDocumentosPreparados(id, deps);
}

async function transmitirFechamentoFiscal(id, opts = {}, deps = {}) {
  const transmissao = require('./FechamentoFiscalTransmissaoService');
  return transmissao.transmitirFechamento(id, opts, deps);
}

async function recuperarFechamentoFiscal(id, opts = {}, deps = {}) {
  const transmissao = require('./FechamentoFiscalTransmissaoService');
  return transmissao.recuperarFechamento(id, opts, deps);
}

module.exports = {
  STATUS,
  STATUS_ATIVOS,
  criarRascunho,
  listarFechamentos,
  obterPorId,
  adicionarRecebimento,
  removerRecebimento,
  gerarPrevia,
  cancelarFechamento,
  validarFiscal,
  prepararEmissaoFiscal,
  listarDocumentosFiscais,
  transmitirFechamentoFiscal,
  recuperarFechamentoFiscal,
  listarProdutosElegiveisDoDia,
  listarLotesElegiveisDoDia,
  listarMonitoramentoProdutosDoDia,
  obterResumoDia,
  snapshotComercial,
  gerarPreviaDistribuicao,
  toCentavos,
  arredondarMoeda,
  somarMoeda,
  assertModuloAtivo
};
