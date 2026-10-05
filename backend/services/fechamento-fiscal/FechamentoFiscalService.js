/**
 * Sprint 01/02 — Serviço principal Fechamento Fiscal do Dia.
 */

'use strict';

const { arredondarMoeda, toCentavos, somarMoeda } = require('../fiscal/modeloTotais');
const { STATUS, STATUS_ATIVOS, DEFAULTS_DISTRIBUICAO } = require('./constants');
const PerformanceMonitor = require('../../observabilidade/performance/PerformanceMonitor');
const { gerarPreviaDistribuicaoNoWorker } = require('./FechamentoFiscalDistribuicaoWorker');
const {
  listarProdutosElegiveisDoDia,
  listarLotesElegiveisDoDia,
  listarMonitoramentoProdutosDoDia,
  obterResumoDia,
  obterContextoResumoDia,
  snapshotComercial,
  agregarProdutosDosLotes
} = require('./FechamentoFiscalElegibilidadeService');
const {
  gerarPreviaDistribuicao,
  agruparUnidades,
  selecionarUnidadesCompactas,
  empacotarVendaUnicaAgrupada,
  consolidarPorProduto
} = require('./FechamentoFiscalDistribuicaoService');
const complementacao = require('./FechamentoFiscalComplementacaoService');
const preparacao = require('./FechamentoFiscalPreparacaoService');
const moduloConfig = require('./fechamentoFiscalModuloConfig');
const previewsEmAndamento = new Map();
const dbIdentidades = new WeakMap();
let proximaIdentidadeDb = 0;

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

function resolverDataFechamento(params = {}, fechamento = null) {
  const candidatas = [
    params.data,
    params.data_fechamento,
    fechamento?.data,
    fechamento?.data_fechamento,
    fechamento?.data_referencia_comercial
  ];
  const valida = candidatas.find((valor) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(valor || '').trim().slice(0, 10))
  );
  if (valida != null) return String(valida).trim().slice(0, 10);
  const informada = candidatas.find((valor) => String(valor || '').trim() !== '');
  return informada != null ? String(informada).trim() : null;
}

function normalizarCnpj(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

function logTecnico(evento, payload = {}) {
  // eslint-disable-next-line no-console
  console.log(`[FechamentoFiscal] ${evento}`, JSON.stringify(payload));
}

function iniciarMetrica(nome, detalhes = {}) {
  return PerformanceMonitor.start(`fiscal:preview:${nome}`, detalhes);
}

function finalizarMetrica(id, detalhes = {}) {
  if (id) PerformanceMonitor.end(id, detalhes);
}

async function medirEtapa(nome, executar, detalhes = {}) {
  const inicio = performance.now();
  const id = iniciarMetrica(nome, detalhes);
  try {
    return await executar();
  } finally {
    finalizarMetrica(id, { elapsed_ms: Number((performance.now() - inicio).toFixed(3)) });
  }
}

function normalizarListaComprovantes(comprovantes = []) {
  const lista = Array.isArray(comprovantes) ? comprovantes : [];
  const valores = [];

  for (const item of lista) {
    const valor = item && typeof item === 'object'
      ? (item.valor ?? item.valor_comprovante ?? item.total ?? item.amount ?? null)
      : item;
    const normalizado = normalizarValorMonetarioComprovante(valor);
    if (normalizado !== null) valores.push({ valor: normalizado, ordem: valores.length + 1 });
  }

  return valores;
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

async function listarVendasElegiveisRecebimento(dbOverride, fechamentoId, dataInformada = null) {
  const db = getDb(dbOverride);
  const idFechamento = Number(fechamentoId);
  const fechamento = Number.isInteger(idFechamento) && idFechamento > 0
    ? await get(
      db,
      `SELECT id, data_fechamento FROM fechamentos_fiscais WHERE id = ?`,
      [idFechamento]
    )
    : null;
  if (!fechamento && !dataInformada) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    err.code = 'FECHAMENTO_NAO_ENCONTRADO';
    throw err;
  }

  const data = normalizarData(dataInformada || fechamento?.data_fechamento);
  const lotes = await listarLotesElegiveisDoDia(db, data, {
    excluirFechamentoId: fechamento ? idFechamento : null
  });
  const vendaIds = [...new Set(lotes.map((lote) => Number(lote.venda_id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!vendaIds.length) {
    return {
      vendas: [],
      resumo: { quantidade_vendas: 0, total_vendas: 0, quantidade_comprovantes: 0, total_comprovantes: 0, diferenca: 0 }
    };
  }

  const dataHoraExpr = 'v.data_venda';
  const placeholders = vendaIds.map(() => '?').join(', ');
  const rows = await all(
    db,
    `SELECT
       v.id AS venda_id,
       v.codigo AS codigo,
       ${dataHoraExpr} AS data_hora,
       COALESCE(v.total, 0) AS valor_venda,
       r.valor_comprovante,
       r.diferenca,
       r.id AS recebimento_venda_id
     FROM vendas v
     LEFT JOIN fechamentos_fiscais_recebimentos_vendas r
       ON r.fechamento_fiscal_id = ? AND r.venda_id = v.id
     WHERE date(${dataHoraExpr}) = date(?)
       AND v.id IN (${placeholders})
     ORDER BY ${dataHoraExpr} ASC, v.id ASC`,
    [idFechamento || null, data, ...vendaIds]
  );

  const vendas = rows.map((row) => ({
    venda_id: Number(row.venda_id),
    codigo: row.codigo == null ? null : String(row.codigo),
    data_hora: row.data_hora,
    valor_venda: toCentavos(row.valor_venda || 0) / 100,
    valor_comprovante: row.valor_comprovante == null ? null : toCentavos(row.valor_comprovante) / 100,
    diferenca: row.diferenca == null ? null : toCentavos(row.diferenca) / 100,
    valor_original: toCentavos(row.valor_venda || 0) / 100,
    recebimento_venda_id: row.recebimento_venda_id != null ? Number(row.recebimento_venda_id) : null
  }));

  const totalVendasCentavos = vendas.reduce((soma, item) => soma + toCentavos(item.valor_venda), 0);
  const comprovantes = vendas.filter((item) => item.valor_comprovante != null);
  const totalComprovantesCentavos = comprovantes.reduce((soma, item) => soma + toCentavos(item.valor_comprovante), 0);
  const totalVendasComComprovanteCentavos = comprovantes.reduce((soma, item) => soma + toCentavos(item.valor_venda), 0);
  const diferencaTotalCentavos = totalComprovantesCentavos - totalVendasComComprovanteCentavos;

  return {
    vendas,
    resumo: {
      quantidade_vendas: vendas.length,
      total_vendas: totalVendasCentavos / 100,
      quantidade_comprovantes: comprovantes.length,
      total_comprovantes: totalComprovantesCentavos / 100,
      diferenca: diferencaTotalCentavos / 100
    }
  };
}

async function listarComprovantesRecebimento(dbOverride, fechamentoId) {
  const db = getDb(dbOverride);
  const fechamento = await get(
    db,
    `SELECT id, data_fechamento, status, valor_informado FROM fechamentos_fiscais WHERE id = ?`,
    [Number(fechamentoId)]
  );
  if (!fechamento) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    err.code = 'FECHAMENTO_NAO_ENCONTRADO';
    throw err;
  }

  const rows = await all(
    db,
    `SELECT id, valor, ordem, criado_em, atualizado_em
     FROM fechamentos_fiscais_recebimentos_comprovantes
     WHERE fechamento_fiscal_id = ?
     ORDER BY ordem ASC, id ASC`,
    [Number(fechamentoId)]
  );

  const comprovantes = rows.map((row) => ({
    id: Number(row.id),
    valor: toCentavos(row.valor || 0) / 100,
    ordem: Number(row.ordem || 0),
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em
  }));
  const total = comprovantes.reduce((soma, item) => soma + toCentavos(item.valor), 0) / 100;

  return {
    comprovantes,
    total,
    quantidade: comprovantes.length,
    valor_informado: fechamento.valor_informado != null ? arredondarMoeda(fechamento.valor_informado) : total
  };
}

function normalizarValorMonetarioComprovante(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0) return null;
    return arredondarMoeda(valor);
  }
  const texto = String(valor).trim();
  if (!texto) return null;

  let normalizado = texto.replace(/\s+/g, '');
  if (normalizado.includes(',')) {
    const parteDecimal = normalizado.split(',');
    if (parteDecimal.length > 2) return null;
    const inteira = parteDecimal[0].replace(/\./g, '');
    const decimal = parteDecimal[1].slice(0, 2);
    if (!/^\d+$/.test(inteira) || !/^\d{1,2}$/.test(decimal)) return null;
    normalizado = `${inteira}.${decimal}`;
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalizado)) {
    normalizado = normalizado.replace(/\./g, '');
  } else if (!/^\d+(?:\.\d+)?$/.test(normalizado)) {
    return null;
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero) || numero < 0) return null;
  return arredondarMoeda(numero);
}

async function salvarComprovantesRecebimento(dbOverride, fechamentoId, comprovantes = []) {
  const db = getDb(dbOverride);
  const fechamento = await get(
    db,
    `SELECT id, data_fechamento, status, valor_informado FROM fechamentos_fiscais WHERE id = ?`,
    [Number(fechamentoId)]
  );
  if (!fechamento) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    err.code = 'FECHAMENTO_NAO_ENCONTRADO';
    throw err;
  }
  if (![STATUS.RASCUNHO, STATUS.PREVIA].includes(fechamento.status)) {
    const err = new Error('Comprovantes só podem ser alterados em RASCUNHO ou PREVIA.');
    err.statusCode = 400;
    err.code = 'FECHAMENTO_BLOQUEADO';
    throw err;
  }

  const lista = Array.isArray(comprovantes) ? comprovantes : [];
  const valores = [];
  for (let idx = 0; idx < lista.length; idx += 1) {
    const item = lista[idx];
    const valor = normalizarValorMonetarioComprovante(item?.valor ?? item ?? null);
    if (valor === null && (item !== null && item !== undefined && String(item).trim() !== '')) {
      const err = new Error('Valor do comprovante inválido.');
      err.statusCode = 400;
      err.code = 'VALOR_COMPROVANTE_INVALIDO';
      throw err;
    }
    if (valor !== null) valores.push({ valor, ordem: idx });
  }

  await run(db, 'BEGIN IMMEDIATE');
  try {
    await run(
      db,
      `DELETE FROM fechamentos_fiscais_recebimentos_comprovantes WHERE fechamento_fiscal_id = ?`,
      [Number(fechamentoId)]
    );
    for (const item of valores) {
      await run(
        db,
        `INSERT INTO fechamentos_fiscais_recebimentos_comprovantes
          (fechamento_fiscal_id, valor, ordem, criado_em, atualizado_em)
         VALUES (?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`,
        [Number(fechamentoId), item.valor, item.ordem]
      );
    }
    const totalCentavos = valores.reduce((soma, item) => soma + toCentavos(item.valor), 0);
    await run(
      db,
      `UPDATE fechamentos_fiscais
       SET valor_informado = ?, quantidade_maquinas = ?, atualizado_em = ?
       WHERE id = ?`,
      [totalCentavos / 100, valores.length, agoraLocal(), Number(fechamentoId)]
    );
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }

  const resultado = await listarComprovantesRecebimento(db, fechamentoId);
  return {
    ...resultado,
    total: resultado.total,
    valor_informado: arredondarMoeda(resultado.valor_informado)
  };
}

async function salvarRecebimentosVendas(dbOverride, fechamentoId, recebimentos = []) {
  const db = getDb(dbOverride);
  const fechamento = await get(
    db,
    `SELECT id, data_fechamento, status FROM fechamentos_fiscais WHERE id = ?`,
    [Number(fechamentoId)]
  );
  if (!fechamento) {
    const err = new Error('Fechamento fiscal não encontrado.');
    err.statusCode = 404;
    err.code = 'FECHAMENTO_NAO_ENCONTRADO';
    throw err;
  }

  const lista = Array.isArray(recebimentos) ? recebimentos : [];
  if (!lista.length) {
    return listarVendasElegiveisRecebimento(db, fechamentoId, fechamento.data_fechamento);
  }
  if (![STATUS.RASCUNHO, STATUS.PREVIA].includes(fechamento.status)) {
    const err = new Error('Comprovantes só podem ser alterados em RASCUNHO ou PREVIA.');
    err.statusCode = 400;
    err.code = 'FECHAMENTO_BLOQUEADO';
    throw err;
  }

  const vendasElegiveis = await listarVendasElegiveisRecebimento(db, fechamentoId, fechamento.data_fechamento);
  const elegiveisPorId = new Map(vendasElegiveis.vendas.map((venda) => [venda.venda_id, venda]));
  const idsRecebimento = new Set();
  const operacoes = [];

  for (const item of lista) {
    const vendaId = Number(item?.venda_id);
    if (!Number.isInteger(vendaId) || vendaId <= 0) {
      const err = new Error('Venda inválida para recebimento por venda.');
      err.statusCode = 400;
      err.code = 'VENDA_INVALIDA';
      throw err;
    }
    if (idsRecebimento.has(vendaId)) {
      const err = new Error(`Venda #${vendaId} foi informada mais de uma vez.`);
      err.statusCode = 400;
      err.code = 'VENDA_DUPLICADA';
      throw err;
    }
    idsRecebimento.add(vendaId);

    const venda = elegiveisPorId.get(vendaId);
    if (!venda) {
      const err = new Error(`Venda #${vendaId} não é elegível para este fechamento.`);
      err.statusCode = 400;
      err.code = 'VENDA_NAO_ELEGIVEL';
      throw err;
    }

    const bruto = item?.valor_comprovante;
    if (bruto === null) {
      operacoes.push({ vendaId, limpar: true });
      continue;
    }
    if ((typeof bruto !== 'number' && typeof bruto !== 'string') || String(bruto).trim() === '') {
      const err = new Error(`Valor do comprovante da venda #${vendaId} é inválido.`);
      err.statusCode = 400;
      err.code = 'VALOR_COMPROVANTE_INVALIDO';
      throw err;
    }
    let valorComprovanteTexto = String(bruto).trim();
    if (typeof bruto === 'string') {
      const ptBr = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
      const decimalPonto = /^\d+(?:\.\d{1,2})?$/;
      if (valorComprovanteTexto.includes(',')) {
        if (!ptBr.test(valorComprovanteTexto)) valorComprovanteTexto = '';
        else valorComprovanteTexto = valorComprovanteTexto.replace(/\./g, '').replace(',', '.');
      } else if (/^\d{1,3}(?:\.\d{3})+$/.test(valorComprovanteTexto)) {
        valorComprovanteTexto = valorComprovanteTexto.replace(/\./g, '');
      } else if (!decimalPonto.test(valorComprovanteTexto)) {
        valorComprovanteTexto = '';
      }
    }
    if (!valorComprovanteTexto) {
      const err = new Error(`Valor do comprovante da venda #${vendaId} é inválido.`);
      err.statusCode = 400;
      err.code = 'VALOR_COMPROVANTE_INVALIDO';
      throw err;
    }
    const valorComprovante = Number(valorComprovanteTexto);
    if (!Number.isFinite(valorComprovante) || valorComprovante < 0) {
      const err = new Error(`Valor do comprovante da venda #${vendaId} é inválido.`);
      err.statusCode = 400;
      err.code = 'VALOR_COMPROVANTE_INVALIDO';
      throw err;
    }
    const valorComprovanteCentavos = toCentavos(valorComprovante);
    if (Math.abs((valorComprovante * 100) - valorComprovanteCentavos) > 0.000001) {
      const err = new Error(`Valor do comprovante da venda #${vendaId} deve ter no máximo duas casas decimais.`);
      err.statusCode = 400;
      err.code = 'VALOR_COMPROVANTE_INVALIDO';
      throw err;
    }
    const valorVendaCentavos = toCentavos(venda.valor_venda);
    if (!Number.isSafeInteger(valorComprovanteCentavos) || !Number.isSafeInteger(valorVendaCentavos)) {
      const err = new Error(`Valor do comprovante da venda #${vendaId} está fora do limite monetário suportado.`);
      err.statusCode = 400;
      err.code = 'VALOR_COMPROVANTE_INVALIDO';
      throw err;
    }
    operacoes.push({
      vendaId,
      limpar: false,
      valorVendaCentavos,
      valorComprovanteCentavos,
      diferencaCentavos: valorComprovanteCentavos - valorVendaCentavos
    });
  }

  await run(db, 'BEGIN IMMEDIATE');
  try {
    for (const operacao of operacoes) {
      if (operacao.limpar) {
        await run(
          db,
          `DELETE FROM fechamentos_fiscais_recebimentos_vendas
           WHERE fechamento_fiscal_id = ? AND venda_id = ?`,
          [Number(fechamentoId), operacao.vendaId]
        );
        continue;
      }
      await run(
        db,
        `INSERT INTO fechamentos_fiscais_recebimentos_vendas (
          fechamento_fiscal_id, venda_id, valor_venda, valor_comprovante, diferenca, criado_em, atualizado_em
        ) VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
        ON CONFLICT(fechamento_fiscal_id, venda_id)
        DO UPDATE SET valor_venda = excluded.valor_venda,
                      valor_comprovante = excluded.valor_comprovante,
                      diferenca = excluded.diferenca,
                      atualizado_em = datetime('now','localtime')`,
        [
          Number(fechamentoId),
          operacao.vendaId,
          operacao.valorVendaCentavos / 100,
          operacao.valorComprovanteCentavos / 100,
          operacao.diferencaCentavos / 100
        ]
      );
    }
    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }

  return listarVendasElegiveisRecebimento(db, fechamentoId, fechamento.data_fechamento);
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

async function atualizarComplementacaoDoFechamento(db, fechamentoId, contextoDia = null) {
  const row = await get(db, `SELECT * FROM fechamentos_fiscais WHERE id = ?`, [Number(fechamentoId)]);
  if (!row) return null;
  return complementacao.gerarComplementacaoFiscal(row, {
    db,
    persistir: true,
    contextoDia,
    produtosFiscaisDisponiveis: contextoDia?.produtosFiscais || null
  }).catch(() => null);
}

async function montarDetalhe(db, row, opts = {}) {
  if (!row) return null;

  let saldoSync = null;
  if (opts.sincronizarSaldo !== false) {
    try {
      const saldoSvc = require('./FechamentoFiscalSaldoService');
      saldoSync = await saldoSvc.sincronizarSaldoAoAbrir(db, row.id, {
        log: opts.logRecuperacao !== false
      });
      if (saldoSync && saldoSync.status) row = { ...row, status: saldoSync.status };
      if (saldoSync) {
        row = {
          ...row,
          valor_principal: saldoSync.valor_principal,
          valor_emitido_autorizado: saldoSync.valor_emitido_autorizado,
          valor_pendente_emissao: saldoSync.valor_pendente_emissao
        };
      }
    } catch (_) { /* fechamento sem docs / schema — segue com row */ }
  }

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
    `SELECT fpi.*, p.nome AS produto_nome
     FROM fechamentos_fiscais_previa_itens fpi
     LEFT JOIN produtos p ON p.id = fpi.produto_id
     WHERE fpi.fechamento_fiscal_id = ?
     ORDER BY fpi.previa_venda_id, fpi.ordem, fpi.id`,
    [row.id]
  ).catch(() => []);

  const documentos = await preparacao.listarDocumentos(db, row.id).catch(() => []);

  const itensPorVenda = new Map();
  for (const it of previaItens) {
    const list = itensPorVenda.get(it.previa_venda_id) || [];
    list.push({ ...it, nome: it.produto_nome || `Produto ${it.produto_id}` });
    itensPorVenda.set(it.previa_venda_id, list);
  }

  const vendasPreviaDetalhadas = previaVendas.map((v) => ({
    ...v,
    valor: arredondarMoeda(v.valor),
    desconto: arredondarMoeda(v.desconto || 0),
    valor_final: arredondarMoeda(
      Number(v.valor_final || 0) > 0 || Number(v.valor || 0) === 0 ? v.valor_final : v.valor
    ),
    itens: itensPorVenda.get(v.id) || []
  }));
  const descontoPrevia = somarMoeda(vendasPreviaDetalhadas.map((v) => v.desconto));
  const valorFinalPrevia = vendasPreviaDetalhadas.length
    ? somarMoeda(vendasPreviaDetalhadas.map((v) => v.valor_final))
    : arredondarMoeda(row.valor_informado || 0);

  return {
    ...row,
    valor_informado: arredondarMoeda(row.valor_informado),
    valor_distribuido: arredondarMoeda(row.valor_distribuido),
    desconto: descontoPrevia,
    valor_final: valorFinalPrevia,
    diferenca: arredondarMoeda(row.diferenca),
    valor_principal: arredondarMoeda(row.valor_principal != null ? row.valor_principal : row.valor_informado),
    valor_emitido_autorizado: arredondarMoeda(row.valor_emitido_autorizado || 0),
    valor_pendente_emissao: arredondarMoeda(
      row.valor_pendente_emissao != null
        ? row.valor_pendente_emissao
        : Math.max(
          0,
          arredondarMoeda(row.valor_principal != null ? row.valor_principal : row.valor_informado)
            - arredondarMoeda(row.valor_emitido_autorizado || 0)
        )
    ),
    recebimentos,
    itens,
    previa_vendas: vendasPreviaDetalhadas,
    documentos,
    complementacao: await complementacao.lerComplementacao(db, row.id),
    transmissao_habilitada: false,
    saldo: saldoSync || {
      valor_principal: arredondarMoeda(row.valor_principal != null ? row.valor_principal : row.valor_informado),
      valor_emitido_autorizado: arredondarMoeda(row.valor_emitido_autorizado || 0),
      valor_pendente_emissao: arredondarMoeda(
        row.valor_pendente_emissao != null
          ? row.valor_pendente_emissao
          : Math.max(
            0,
            arredondarMoeda(row.valor_principal != null ? row.valor_principal : row.valor_informado)
              - arredondarMoeda(row.valor_emitido_autorizado || 0)
          )
      ),
      mensagens: saldoSync && saldoSync.mensagens
    },
    mensagens_saldo: (saldoSync && saldoSync.mensagens) || undefined
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
  // Listagem (polling): sincroniza saldo/status sem spam de log RECUPERACAO
  return Promise.all(rows.map((r) => montarDetalhe(db, r, { logRecuperacao: false })));
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
  await atualizarComplementacaoDoFechamento(db, fechamentoId);
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
  await atualizarComplementacaoDoFechamento(db, fechamentoId);
  return obterPorId(fechamentoId, { db });
}

/**
 * Substitui a lista inteira de máquinas em uma transação.
 * Lista vazia remove todas e zera valor_informado / quantidade_maquinas.
 */
async function substituirRecebimentos(fechamentoId, lista = [], deps = {}) {
  const db = getDb(deps.db);
  await assertModuloAtivo(db, deps);
  const ff = await obterPorId(fechamentoId, { db });
  if (![STATUS.RASCUNHO, STATUS.PREVIA].includes(ff.status)) {
    const err = new Error('Recebimentos só podem ser alterados em RASCUNHO ou PREVIA.');
    err.statusCode = 400;
    throw err;
  }

  const itens = Array.isArray(lista) ? lista : [];
  const id = Number(fechamentoId);

  await run(db, 'BEGIN IMMEDIATE');
  try {
    await run(db, `DELETE FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id = ?`, [id]);
    for (const payload of itens) {
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
          id,
          operadora,
          payload.descricao != null ? String(payload.descricao) : operadora,
          cnpjRec,
          valor,
          payload.observacao != null ? String(payload.observacao) : null,
          agoraLocal()
        ]
      );
    }
    await recalcularTotaisRecebimentos(db, id);
    await run(db, 'COMMIT');
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
  await atualizarComplementacaoDoFechamento(db, id);
  return obterPorId(id, { db });
}

async function persistirPrevia(db, fechamento, previa, produtos, opts, metricasPersistencia = null) {
  await run(db, 'BEGIN IMMEDIATE');
  try {
    const estadoAtual = await get(
      db,
      `SELECT status FROM fechamentos_fiscais WHERE id = ?`,
      [Number(fechamento.id)]
    );
    if (!estadoAtual || String(estadoAtual.status || '').toUpperCase() === STATUS.CANCELADO) {
      const err = new Error('O fechamento foi cancelado antes de persistir a prévia.');
      err.statusCode = 409;
      err.code = 'FECHAMENTO_CANCELADO';
      throw err;
    }

    await run(db, `DELETE FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id = ?`, [fechamento.id]);
    if (metricasPersistencia) metricasPersistencia.deletes += 1;
    await run(db, `DELETE FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id = ?`, [fechamento.id]);
    if (metricasPersistencia) metricasPersistencia.deletes += 1;
    await run(db, `DELETE FROM fechamentos_fiscais_itens WHERE fechamento_fiscal_id = ?`, [fechamento.id]);
    if (metricasPersistencia) metricasPersistencia.deletes += 1;

    const itensUtilizadosPorProduto = new Map();
    for (const item of previa.itensUtilizados || []) {
      const produtoId = Number(item.produto_id);
      if (!itensUtilizadosPorProduto.has(produtoId)) {
        itensUtilizadosPorProduto.set(produtoId, item);
      }
    }
    let ordem = 0;
    for (const p of produtos) {
      const usado = itensUtilizadosPorProduto.get(Number(p.produto_id));
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
      if (metricasPersistencia) metricasPersistencia.inserts += 1;
    }

    for (const v of previa.vendas || []) {
      const ins = await run(
        db,
        `INSERT INTO fechamentos_fiscais_previa_vendas
          (fechamento_fiscal_id, sequencia, valor, desconto, valor_final, quantidade_itens, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          fechamento.id,
          v.sequencia,
          v.valor,
          v.desconto || 0,
          v.valor_final != null ? v.valor_final : v.valor,
          (v.itens || []).length,
          agoraLocal()
        ]
      );
      if (metricasPersistencia) metricasPersistencia.inserts += 1;
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
        if (metricasPersistencia) metricasPersistencia.inserts += 1;
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
        // valor_principal imutável: não reduzir valor_informado original após autorizações
        (Number(fechamento.valor_principal) > 0 || Number(fechamento.valor_emitido_autorizado) > 0)
          ? arredondarMoeda(fechamento.valor_principal || fechamento.valor_informado)
          : previa.valor_informado,
        previa.valor_distribuido,
        previa.diferenca,
        opts.valorAlvo,
        opts.valorMin,
        opts.valorMax,
        (Number(fechamento.valor_emitido_autorizado) > 0
          ? STATUS.AUTORIZACAO_PARCIAL
          : STATUS.PREVIA),
        agoraLocal(),
        fechamento.id
      ]
    );
    if (metricasPersistencia) metricasPersistencia.updates += 1;

    await run(db, 'COMMIT');
  } catch (err) {
    try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  }
}

function gerarPreviaPorComprovante(comprovantes, lotes, opts = {}) {
  const inicio = performance.now();
  const metricasExecucao = opts.metricasExecucao || {};
  const gruposOriginais = agruparUnidades(lotes);
  metricasExecucao.grupos = gruposOriginais.length;
  let gruposDisponiveis = gruposOriginais.map((grupo) => ({ ...grupo }));
  const usoPorProduto = new Map();
  const vendas = [];

  for (let index = 0; index < comprovantes.length; index += 1) {
    const comprovante = comprovantes[index];
    const valorAlvoCents = toCentavos(comprovante.valor);
    const { selecionadasAgrupadas, somaCents } = selecionarUnidadesCompactas(
      gruposDisponiveis,
      valorAlvoCents,
      { usoPorProduto, metricasExecucao }
    );
    if (!selecionadasAgrupadas.length || somaCents < valorAlvoCents) continue;

    const [venda] = empacotarVendaUnicaAgrupada(selecionadasAgrupadas, {
      sequencia: index + 1,
      valorAlvo: valorAlvoCents / 100
    });
    if (!venda) continue;

    venda.sequencia = index + 1;
    venda.rotulo = `Venda Fiscal ${String(index + 1).padStart(3, '0')}`;
    venda.ordem = comprovante.ordem || index + 1;
    vendas.push(venda);
    for (const item of venda.itens || []) {
      const produtoId = Number(item.produto_id);
      usoPorProduto.set(
        produtoId,
        (usoPorProduto.get(produtoId) || 0) + Number(item.quantidade || 0)
      );
    }

    const utilizadas = new Map(selecionadasAgrupadas.map((grupo) => [
      `${grupo.produto_id}|${grupo.venda_item_id}|${grupo.key}|${grupo.valor_cents}|${grupo.unit_cents}`,
      Number(grupo.quantidade_selecionada || 0)
    ]));
    gruposDisponiveis = gruposDisponiveis.map((grupo) => {
      const chave = `${grupo.produto_id}|${grupo.venda_item_id}|${grupo.key}|${grupo.valor_cents}|${grupo.unit_cents}`;
      return {
        ...grupo,
        quantidade_unidades: Math.max(
          0,
          Number(grupo.quantidade_unidades || 0) - Number(utilizadas.get(chave) || 0)
        )
      };
    }).filter((grupo) => grupo.quantidade_unidades > 0);
  }

  const totalInformadoCents = comprovantes.reduce((total, item) => total + toCentavos(item.valor), 0);
  const totalDistribuidoCents = vendas.reduce((total, venda) => total + toCentavos(venda.valor), 0);
  const totalFinalCents = vendas.reduce((total, venda) => total + toCentavos(venda.valor_final), 0);
  const totalDescontoCents = vendas.reduce((total, venda) => total + toCentavos(venda.desconto), 0);
  const porProduto = consolidarPorProduto(vendas, lotes);
  const perfeita = vendas.length === comprovantes.length && totalFinalCents === totalInformadoCents;
  const capacidadeCents = gruposOriginais.reduce(
    (total, grupo) => total + grupo.quantidade_unidades * grupo.valor_cents,
    0
  );

  return {
    vendas,
    itensUtilizados: porProduto.map((produto) => ({
      produto_id: produto.produto_id,
      nome: produto.nome,
      quantidade_utilizada: produto.quantidade_utilizada,
      valor_utilizado: produto.valor_utilizado
    })),
    porProduto,
    valor_informado: arredondarMoeda(totalInformadoCents / 100),
    valor_distribuido: arredondarMoeda(totalDistribuidoCents / 100),
    desconto: arredondarMoeda(totalDescontoCents / 100),
    valor_final: arredondarMoeda(totalFinalCents / 100),
    diferenca: arredondarMoeda((totalInformadoCents - totalFinalCents) / 100),
    valor_elegivel: arredondarMoeda(capacidadeCents / 100),
    quantidade_vendas: vendas.length,
    perfeita,
    incompleta: !perfeita,
    mensagem: perfeita
      ? 'Por comprovante: cada comprovante gera uma venda fiscal individual com itens fiscais elegíveis.'
      : capacidadeCents > 0
        ? `Não foi possível compor integralmente os comprovantes com o estoque fiscal elegível. Diferença: R$ ${((totalInformadoCents - totalDistribuidoCents) / 100).toFixed(2)}`
        : 'Não há itens fiscais elegíveis para compor os comprovantes informados.',
    codigo: perfeita ? 'OK' : (capacidadeCents > 0 ? 'DISTRIBUICAO_INCOMPLETA' : 'SEM_ELEGIVEIS'),
    metricas: {
      produtos_elegiveis: new Set(lotes.map((lote) => lote.produto_id)).size,
      linhas_elegiveis: lotes.length,
      unidades_selecionadas: gruposOriginais.reduce(
        (total, grupo) => total + grupo.quantidade_unidades,
        0
      ) - gruposDisponiveis.reduce((total, grupo) => total + grupo.quantidade_unidades, 0),
      grupos: gruposOriginais.length,
      estados_avaliados: metricasExecucao.estadosAvaliados || 0,
      transicoes_avaliadas: metricasExecucao.transicoesAvaliadas || 0,
      max_estados: metricasExecucao.maxEstados || 0,
      tempo_ms: Number((performance.now() - inicio).toFixed(3)),
      modo: 'por_comprovante'
    }
  };
}

/**
 * Prévia READ-ONLY sobre tabelas comerciais.
 * Regenerar substitui a prévia anterior (idempotente / sem acumular).
 */
async function gerarPreviaInterna(params = {}, deps = {}) {
  const inicioTotal = performance.now();
  const db = getDb(deps.db);
  await assertModuloAtivo(db, deps);

  let fechamento = null;
  if (params.fechamento_id || params.id) {
    fechamento = await obterPorId(params.fechamento_id || params.id, { db });
    if (String(fechamento.status || '').toUpperCase() === STATUS.CANCELADO) {
      const err = new Error('Este fechamento foi cancelado. Crie um novo rascunho para gerar outra prévia.');
      err.statusCode = 409;
      err.code = 'FECHAMENTO_CANCELADO';
      throw err;
    }
  }

  const dataResolvida = resolverDataFechamento(params, fechamento);
  const data = normalizarData(dataResolvida);
  const excluirFechamentoId = params.fechamento_id || params.id || null;
  const resumo = await medirEtapa(
    'T2-summary',
    () => obterResumoDia(db, data, { excluirFechamentoId }),
    { fechamento_id: fechamento?.id || null }
  );
  const contextoDia = obterContextoResumoDia(resumo);
  const lotesMonitor = resumo.lotes || [];

  let valorInformado = params.valor_informado != null
    ? arredondarMoeda(params.valor_informado)
    : null;

  if (fechamento && valorInformado == null) {
    valorInformado = arredondarMoeda(fechamento.valor_informado);
  }

  if (valorInformado == null) valorInformado = 0;

  // Proteção de saldo: após NFC-e autorizada, nova prévia usa somente o pendente
  if (fechamento && [STATUS.AUTORIZACAO_PARCIAL, STATUS.PENDENTE_RECUPERACAO, STATUS.REJEITADO, STATUS.ERRO].includes(fechamento.status)) {
    const saldoSvc = require('./FechamentoFiscalSaldoService');
    const saldo = await saldoSvc.recalcularSaldoFechamento(db, fechamento.id);
    if (saldo.concluido) {
      const err = new Error('Fechamento já concluído (saldo pendente zero). Não é possível regenerar prévia.');
      err.statusCode = 409;
      err.code = 'FECHAMENTO_JA_CONCLUIDO';
      err.saldo = saldo;
      throw err;
    }
    if (toCentavos(saldo.valor_emitido_autorizado) > 0) {
      if (params.valor_informado != null) {
        saldoSvc.assertValorTentativaPermitido(saldo, params.valor_informado);
      }
      valorInformado = arredondarMoeda(saldo.valor_pendente_emissao);
      logTecnico('previa_base_pendente', {
        fechamento_id: fechamento.id,
        principal: saldo.valor_principal,
        autorizado: saldo.valor_emitido_autorizado,
        pendente: valorInformado
      });
    }
  }

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

  const devePersistir = Boolean(fechamento) && params.persistir !== false;

  let comprovantesPersistidos = [];
  const temComprovantesExplitos = Array.isArray(params.comprovantes) && params.comprovantes.length > 0;
  if (temComprovantesExplitos) {
    comprovantesPersistidos = normalizarListaComprovantes(params.comprovantes);
  } else if (fechamento && Number.isInteger(Number(fechamento.id)) && Number(fechamento.id) > 0) {
    const linhas = await all(
      db,
      `SELECT valor, ordem FROM fechamentos_fiscais_recebimentos_comprovantes
       WHERE fechamento_fiscal_id = ?
       ORDER BY ordem ASC, id ASC`,
      [Number(fechamento.id)]
    );
    comprovantesPersistidos = linhas
      .map((linha) => ({ valor: normalizarValorMonetarioComprovante(linha.valor), ordem: Number(linha.ordem || 0) || 0 }))
      .filter((item) => item.valor !== null);
  }

  if (comprovantesPersistidos.length) {
    const produtosComp = await complementacao.obterProdutosFiscaisDisponiveisParaComplementacao(
      db,
      contextoDia?.produtosFiscais || null
    );
    const lotes = complementacao.mesclarLotesMonitoramentoComComplementacao(
      lotesMonitor,
      produtosComp,
      { valorAlvoCents: toCentavos(valorInformado) }
    );
    const produtos = lotes.length ? agregarProdutosDosLotes(lotes) : (resumo.produtos || []);
    const metricasExecucao = {};
    const poolMetric = {
      produtos_candidatos: new Set(lotes.map((lote) => Number(lote.produto_id))).size,
      lotes: lotes.length
    };
    PerformanceMonitor.record('fiscal:preview:T4-pool', {
      produtos_candidatos: poolMetric.produtos_candidatos
    });
    PerformanceMonitor.record('fiscal:preview:T5-lotes', { lotes: poolMetric.lotes });
    const previa = await medirEtapa('T7-distribution', () => gerarPreviaDistribuicaoNoWorker({
      tipo: 'comprovantes',
      comprovantes: comprovantesPersistidos,
      lotes,
      opcoes: { ...opts, metricasExecucao }
    }), poolMetric);
    PerformanceMonitor.record('fiscal:preview:T6-groups', { grupos: previa.metricas.grupos });
    PerformanceMonitor.record('fiscal:preview:T8-search', {
      estados_avaliados: previa.metricas.estados_avaliados,
      transicoes_avaliadas: previa.metricas.transicoes_avaliadas,
      max_estados: previa.metricas.max_estados
    });

    const persistencia = { deletes: 0, inserts: 0, updates: 0 };
    if (devePersistir && fechamento) {
      await medirEtapa('T9-persistence', () =>
        persistirPrevia(db, fechamento, previa, produtos, opts, persistencia), {
          ...poolMetric,
          vendas: previa.vendas.length
        });
      PerformanceMonitor.record('fiscal:preview:T9-persistence-counts', persistencia);
      fechamento = await obterPorId(fechamento.id, { db });
      await medirEtapa('T10-complementation', () =>
        atualizarComplementacaoDoFechamento(db, fechamento.id, contextoDia));
      fechamento = await obterPorId(fechamento.id, { db });
    }

    const responseInicio = performance.now();
    const responseMetric = iniciarMetrica('T11-response-mount');
    const resultado = {
      data,
      resumo,
      previa,
      fechamento,
      complementacao: fechamento && fechamento.complementacao ? fechamento.complementacao : null,
      indicadores: {
        produtos_elegiveis: previa.metricas.produtos_elegiveis,
        linhas_elegiveis: previa.metricas.linhas_elegiveis,
        quantidade_utilizada: previa.itensUtilizados.reduce((total, item) => total + Number(item.quantidade_utilizada || 0), 0),
        valor_elegivel: previa.valor_elegivel,
        valor_distribuido: previa.valor_distribuido,
        diferenca: previa.diferenca,
        quantidade_vendas: previa.quantidade_vendas
      },
      protecao: {
        snapshot_antes: null,
        snapshot_depois: null,
        comercial_inalterado: true
      }
    };
    finalizarMetrica(responseMetric, {
      elapsed_ms: Number((performance.now() - responseInicio).toFixed(3))
    });
    PerformanceMonitor.record('fiscal:preview:T11-generation-metrics', {
      fechamento_id: fechamento?.id || null,
      data,
      elapsed_ms: Number((performance.now() - inicioTotal).toFixed(3)),
      ...poolMetric,
      grupos: previa.metricas.grupos,
      vendas: previa.vendas.length,
      itens_fiscais: previa.vendas.reduce((total, venda) => total + (venda.itens || []).length, 0),
      estados_avaliados: previa.metricas.estados_avaliados,
      transicoes_avaliadas: previa.metricas.transicoes_avaliadas,
      deletes: persistencia?.deletes || 0,
      inserts: persistencia?.inserts || 0,
      updates: persistencia?.updates || 0
    });
    return resultado;
  }

  const produtosComp = await complementacao.obterProdutosFiscaisDisponiveisParaComplementacao(
    db,
    contextoDia?.produtosFiscais || null
  );
  const lotes = complementacao.mesclarLotesMonitoramentoComComplementacao(
    lotesMonitor,
    produtosComp,
    { valorAlvoCents: toCentavos(valorInformado) }
  );
  const produtos = lotes.length ? agregarProdutosDosLotes(lotes) : (resumo.produtos || []);

  const snapshotAntes = deps.capturarSnapshot !== false
    ? await medirEtapa('snapshot-before', () => snapshotComercial(db))
    : null;

  const metricasExecucao = {};
  const poolMetric = {
    produtos_candidatos: new Set(lotes.map((lote) => Number(lote.produto_id))).size,
    lotes: lotes.length
  };
  PerformanceMonitor.record('fiscal:preview:T4-pool', {
    produtos_candidatos: poolMetric.produtos_candidatos
  });
  PerformanceMonitor.record('fiscal:preview:T5-lotes', { lotes: poolMetric.lotes });
  const previa = await medirEtapa('T7-distribution', () => gerarPreviaDistribuicaoNoWorker({
    tipo: 'normal',
    lotes: lotes.length ? lotes : produtos,
    valorInformado,
    opcoes: { ...opts, metricasExecucao }
  }), poolMetric);
  PerformanceMonitor.record('fiscal:preview:T6-groups', { grupos: previa.metricas.grupos });
  PerformanceMonitor.record('fiscal:preview:T8-search', {
    estados_avaliados: previa.metricas.estados_avaliados,
    transicoes_avaliadas: previa.metricas.transicoes_avaliadas,
    max_estados: previa.metricas.max_estados
  });

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

  const persistencia = { deletes: 0, inserts: 0, updates: 0 };
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
        persistencia.deletes += 1;
        await run(db, `DELETE FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id = ?`, [fechamento.id]);
        persistencia.deletes += 1;
        await run(
          db,
          `UPDATE fechamentos_fiscais
           SET valor_informado = 0, valor_distribuido = 0, diferenca = 0, status = ?, atualizado_em = ?
           WHERE id = ?`,
          [STATUS.RASCUNHO, agoraLocal(), fechamento.id]
        );
        persistencia.updates += 1;
        await run(db, 'COMMIT');
      } catch (err) {
        try { await run(db, 'ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
      }
    } else {
      await medirEtapa('T9-persistence', () =>
        persistirPrevia(db, fechamento, previa, produtos, opts, persistencia), {
          ...poolMetric,
          vendas: previa.vendas.length
        });
      PerformanceMonitor.record('fiscal:preview:T9-persistence-counts', persistencia);
    }
    fechamento = await obterPorId(fechamento.id, { db });
    await medirEtapa('T10-complementation', () =>
      atualizarComplementacaoDoFechamento(db, fechamento.id, contextoDia));
    fechamento = await obterPorId(fechamento.id, { db });
  } else if (fechamento) {
    fechamento.complementacao = await complementacao.gerarComplementacaoFiscal(fechamento, {
      db,
      persistir: false
    }).catch(() => null);
  }

  const snapshotDepois = deps.capturarSnapshot !== false
    ? await medirEtapa('snapshot-after', () => snapshotComercial(db))
    : null;

  const responseInicio = performance.now();
  const responseMetric = iniciarMetrica('T11-response-mount');
  const resultado = {
    data,
    resumo,
    previa,
    fechamento,
    complementacao: fechamento && fechamento.complementacao ? fechamento.complementacao : null,
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
  finalizarMetrica(responseMetric, {
    elapsed_ms: Number((performance.now() - responseInicio).toFixed(3))
  });
  PerformanceMonitor.record('fiscal:preview:T11-generation-metrics', {
    fechamento_id: fechamento?.id || null,
    data,
    elapsed_ms: Number((performance.now() - inicioTotal).toFixed(3)),
    ...poolMetric,
    grupos: previa.metricas.grupos,
    vendas: previa.vendas.length,
    itens_fiscais: previa.vendas.reduce((total, venda) => total + (venda.itens || []).length, 0),
    estados_avaliados: previa.metricas.estados_avaliados,
    transicoes_avaliadas: previa.metricas.transicoes_avaliadas,
    deletes: persistencia.deletes,
    inserts: persistencia.inserts,
    updates: persistencia.updates
  });
  return resultado;
}

function gerarPrevia(params = {}, deps = {}) {
  const db = getDb(deps.db);
  let dbId = dbIdentidades.get(db);
  if (!dbId) {
    dbId = ++proximaIdentidadeDb;
    dbIdentidades.set(db, dbId);
  }
  const identidade = params.id || params.fechamento_id
    ? `fechamento:${Number(params.id || params.fechamento_id)}`
    : `data:${String(params.data || params.data_fechamento || '')}`;
  const chave = `${dbId}:${identidade}`;
  const assinatura = JSON.stringify({
    params,
    moduloOn: deps.moduloOn,
    capturarSnapshot: deps.capturarSnapshot,
    persistir: deps.persistir
  });
  const existente = previewsEmAndamento.get(chave);
  if (existente) {
    if (existente.assinatura === assinatura) return existente.promise;
    const erro = new Error('Já existe uma geração de prévia em andamento para este fechamento.');
    erro.statusCode = 409;
    erro.code = 'PREVIA_EM_ANDAMENTO';
    return Promise.reject(erro);
  }

  const promise = gerarPreviaInterna(params, deps).finally(() => {
    if (previewsEmAndamento.get(chave)?.promise === promise) {
      previewsEmAndamento.delete(chave);
    }
  });
  previewsEmAndamento.set(chave, { assinatura, promise });
  return promise;
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

async function limparTudoDoDia(data, deps = {}) {
  const db = getDb(deps.db);
  await assertModuloAtivo(db, deps);
  const dataNorm = normalizarData(data);
  const dbId = dbIdentidades.get(db);
  const limpaveis = new Set([
    STATUS.RASCUNHO,
    STATUS.PREVIA,
    STATUS.PRONTO_EMISSAO,
    STATUS.REJEITADO,
    STATUS.ERRO,
    STATUS.CANCELADO
  ]);
  let fechamentosLimpos = 0;
  let fechamentosPreservados = 0;

  await run(db, 'BEGIN IMMEDIATE');
  try {
    const fechamentos = await all(
      db,
      `SELECT id, status FROM fechamentos_fiscais
       WHERE data_fechamento = ?
       ORDER BY id`,
      [dataNorm]
    );

    for (const fechamento of fechamentos) {
      const id = Number(fechamento.id);
      const status = String(fechamento.status || '').toUpperCase();
      if (!limpaveis.has(status)) {
        fechamentosPreservados += 1;
        continue;
      }

      const chavePrevia = dbId ? `${dbId}:fechamento:${id}` : null;
      if (chavePrevia && previewsEmAndamento.has(chavePrevia)) {
        const erro = new Error('Há uma prévia em andamento para esta data. Aguarde a conclusão antes de limpar.');
        erro.statusCode = 409;
        erro.code = 'PREVIA_EM_ANDAMENTO';
        throw erro;
      }

      const artefatos = await get(
        db,
        `SELECT
           (SELECT COUNT(*) FROM fechamentos_fiscais_documentos
            WHERE fechamento_fiscal_id = ?
              AND (UPPER(status) = 'AUTORIZADO'
                OR COALESCE(chave_acesso, '') <> ''
                OR COALESCE(protocolo, '') <> '')) AS documentos_autorizados,
           (SELECT COUNT(*) FROM fechamentos_fiscais_transmissoes
            WHERE fechamento_fiscal_id = ?) AS transmissoes`,
        [id, id]
      );
      if (
        Number(artefatos?.documentos_autorizados || 0) > 0
        || Number(artefatos?.transmissoes || 0) > 0
      ) {
        fechamentosPreservados += 1;
        continue;
      }

      await run(db, 'DELETE FROM fechamentos_fiscais_documentos_itens WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_documentos_pagamentos WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_documentos WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_previa_itens WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_previa_vendas WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_itens WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_recebimentos WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_recebimentos_comprovantes WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_recebimentos_vendas WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_complementacao_itens WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais_complementacao WHERE fechamento_fiscal_id = ?', [id]);
      await run(db, 'DELETE FROM fechamentos_fiscais WHERE id = ?', [id]);
      fechamentosLimpos += 1;
    }

    await run(db, 'COMMIT');
  } catch (err) {
    await run(db, 'ROLLBACK').catch(() => {});
    throw err;
  }

  logTecnico('dados_dia_limpos', {
    data: dataNorm,
    fechamentos_limpos: fechamentosLimpos,
    fechamentos_preservados: fechamentosPreservados
  });
  return {
    data: dataNorm,
    fechamentos_limpos: fechamentosLimpos,
    fechamentos_preservados: fechamentosPreservados,
    mensagem: 'Prévia e registros fiscais ainda não autorizados foram removidos. Estoque, vendas originais, documentos autorizados e tentativas de transmissão foram preservados.'
  };
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

async function continuarEmissaoFiscal(id, opts = {}, deps = {}) {
  const saldoSvc = require('./FechamentoFiscalSaldoService');
  const base = await saldoSvc.continuarEmissaoFechamento(id, deps);
  const optsContinuar = { ...opts, continuar_emissao: true, continuar: true };

  // Gera prévia automática só do saldo pendente e prepara documentos (preservando autorizados)
  const previa = await gerarPrevia({
    id: Number(id),
    valor_informado: base.valor_base_continuacao,
    persistir: true,
    valor_alvo: opts.valor_alvo,
    valor_min: opts.valor_min,
    valor_max: opts.valor_max,
    continuar_emissao: true
  }, deps);

  let preparacao = null;
  if (opts.preparar !== false && previa && previa.ok !== false) {
    try {
      preparacao = await prepararEmissaoFiscal(id, optsContinuar, deps);
    } catch (err) {
      return {
        ...base,
        previa,
        preparacao_erro: err.message,
        code: err.code || 'PREPARACAO_CONTINUACAO',
        ok: false,
        mensagem: `${base.mensagem}\nPrévia gerada para R$ ${Number(base.valor_base_continuacao).toFixed(2)}, mas a preparação falhou: ${err.message}`
      };
    }
  }

  return {
    ok: true,
    ...base,
    previa,
    preparacao,
    mensagem:
      `Venda emitida (acumulado): R$ ${Number(base.saldo.valor_emitido_autorizado).toFixed(2)}\n` +
      `Valor original do fechamento: R$ ${Number(base.saldo.valor_principal).toFixed(2)}\n` +
      `Valor restante para emissão: R$ ${Number(base.saldo.valor_pendente_emissao).toFixed(2)}`
  };
}

module.exports = {
  STATUS,
  STATUS_ATIVOS,
  criarRascunho,
  listarFechamentos,
  obterPorId,
  adicionarRecebimento,
  removerRecebimento,
  substituirRecebimentos,
  gerarComplementacaoFiscal: complementacao.gerarComplementacaoFiscal,
  calcularComplementacaoFiscal: complementacao.calcularComplementacaoFiscal,
  gerarPrevia,
  cancelarFechamento,
  limparTudoDoDia,
  validarFiscal,
  prepararEmissaoFiscal,
  listarDocumentosFiscais,
  transmitirFechamentoFiscal,
  recuperarFechamentoFiscal,
  continuarEmissaoFiscal,
  listarVendasElegiveisRecebimento,
  salvarRecebimentosVendas,
  listarComprovantesRecebimento,
  salvarComprovantesRecebimento,
  gerarPreviaPorComprovante,
  listarProdutosElegiveisDoDia,
  listarLotesElegiveisDoDia,
  listarMonitoramentoProdutosDoDia,
  obterResumoDia,
  snapshotComercial,
  gerarPreviaDistribuicao,
  toCentavos,
  arredondarMoeda,
  somarMoeda,
  assertModuloAtivo,
  resolverDataFechamento
};
