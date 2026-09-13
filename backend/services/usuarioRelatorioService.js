'use strict';

const db = require('../database');

const EXPR_VALOR_VENDA = `COALESCE(NULLIF(COALESCE(v.valor_fiscal, 0) + COALESCE(v.valor_nao_fiscal, 0), 0), v.total, 0)`;

const SQL_VENDA_ATIVA = `(COALESCE(v.cancelada, 0) = 0 AND LOWER(COALESCE(v.status, '')) != 'cancelada')`;
const SQL_VENDA_CANCELADA = `(COALESCE(v.cancelada, 0) = 1 OR LOWER(COALESCE(v.status, '')) = 'cancelada')`;

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function hojeLocalISO() {
  const agora = new Date();
  const br = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' }));
  const y = br.getFullYear();
  const m = String(br.getMonth() + 1).padStart(2, '0');
  const d = String(br.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function inicioMesLocalISO() {
  const hoje = hojeLocalISO();
  return `${hoje.slice(0, 7)}-01`;
}

function inicioAnoLocalISO() {
  return `${hojeLocalISO().slice(0, 4)}-01-01`;
}

function parseDetalhesAuditoria(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { texto: String(raw) };
  }
}

async function resumoVendas(usuarioId, filtroDataSql, paramsBase) {
  const row = await dbGet(
    `SELECT
        COUNT(*) AS quantidade,
        COALESCE(SUM(${EXPR_VALOR_VENDA}), 0) AS valor_total,
        COALESCE(SUM(v.desconto), 0) AS desconto_total
     FROM vendas v
     WHERE v.operador_id = ?
       AND ${SQL_VENDA_ATIVA}
       ${filtroDataSql}`,
    paramsBase
  );
  return {
    quantidade: Number(row?.quantidade || 0),
    valor_total: Number(row?.valor_total || 0),
    desconto_total: Number(row?.desconto_total || 0)
  };
}

async function obterRelatorioUsuario(usuarioId, opcoes = {}) {
  const usuario = await dbGet(
    `SELECT id, username, nome, role, COALESCE(perfil, 'USUARIO') AS perfil, created_at, COALESCE(ativo, 1) AS ativo
     FROM usuarios WHERE id = ?`,
    [usuarioId]
  );

  if (!usuario) {
    const err = new Error('Usuário não encontrado.');
    err.status = 404;
    throw err;
  }

  const hoje = hojeLocalISO();
  const inicioMes = inicioMesLocalISO();
  const inicioAno = inicioAnoLocalISO();
  const inicioPeriodo = opcoes.inicio || null;
  const fimPeriodo = opcoes.fim || null;

  let filtroPeriodoSql = '';
  const paramsPeriodo = [usuarioId];
  if (inicioPeriodo) {
    filtroPeriodoSql += ' AND date(COALESCE(v.data_venda, v.created_at)) >= date(?)';
    paramsPeriodo.push(inicioPeriodo);
  }
  if (fimPeriodo) {
    filtroPeriodoSql += ' AND date(COALESCE(v.data_venda, v.created_at)) <= date(?)';
    paramsPeriodo.push(fimPeriodo);
  }

  const [vendasDia, vendasMes, vendasAno, vendasPeriodo] = await Promise.all([
    resumoVendas(usuarioId, 'AND date(COALESCE(v.data_venda, v.created_at)) = date(?)', [usuarioId, hoje]),
    resumoVendas(usuarioId, 'AND date(COALESCE(v.data_venda, v.created_at)) >= date(?)', [usuarioId, inicioMes]),
    resumoVendas(usuarioId, 'AND date(COALESCE(v.data_venda, v.created_at)) >= date(?)', [usuarioId, inicioAno]),
    resumoVendas(usuarioId, filtroPeriodoSql, paramsPeriodo)
  ]);

  const cancelamentosAuditoria = await dbGet(
    `SELECT COUNT(*) AS total
     FROM auditoria
     WHERE usuario_id = ? AND acao = 'cancelar_venda'`,
    [usuarioId]
  );

  const cancelamentosOperador = await dbGet(
    `SELECT COUNT(*) AS total, COALESCE(SUM(${EXPR_VALOR_VENDA}), 0) AS valor
     FROM vendas v
     WHERE v.operador_id = ? AND ${SQL_VENDA_CANCELADA}`,
    [usuarioId]
  );

  const devolucoes = await dbGet(
    `SELECT COUNT(*) AS total
     FROM auditoria
     WHERE usuario_id = ? AND acao = 'devolver_venda'`,
    [usuarioId]
  );

  const autorizacoesDesconto = await dbGet(
    `SELECT COUNT(*) AS total, COALESCE(SUM(v.desconto), 0) AS valor_descontos
     FROM vendas v
     WHERE v.desconto_autorizado_por_id = ? AND v.desconto > 0`,
    [usuarioId]
  );

  const caixaMov = await dbGet(
    `SELECT
        COALESCE(SUM(CASE WHEN tipo = 'sangria' THEN valor ELSE 0 END), 0) AS sangrias_valor,
        COALESCE(SUM(CASE WHEN tipo = 'sangria' THEN 1 ELSE 0 END), 0) AS sangrias_qtd,
        COALESCE(SUM(CASE WHEN tipo = 'suprimento' THEN valor ELSE 0 END), 0) AS suprimentos_valor,
        COALESCE(SUM(CASE WHEN tipo = 'suprimento' THEN 1 ELSE 0 END), 0) AS suprimentos_qtd
     FROM caixa_movimentacoes
     WHERE usuario_id = ?`,
    [usuarioId]
  );

  const caixaSessoes = await dbGet(
    `SELECT
        COUNT(*) AS sessoes,
        COALESCE(SUM(CASE WHEN status = 'fechado' OR fechado_em IS NOT NULL THEN 1 ELSE 0 END), 0) AS fechamentos
     FROM caixa_sessoes
     WHERE operador_id = ?`,
    [usuarioId]
  );

  const logins = await dbGet(
    `SELECT COUNT(*) AS total FROM auditoria WHERE usuario_id = ? AND acao = 'login'`,
    [usuarioId]
  );

  const ultimoLogin = await dbGet(
    `SELECT criado_em FROM auditoria WHERE usuario_id = ? AND acao = 'login' ORDER BY criado_em DESC LIMIT 1`,
    [usuarioId]
  );

  const acoesAuditoriaResumo = await dbAll(
    `SELECT acao, COUNT(*) AS total
     FROM auditoria
     WHERE usuario_id = ?
     GROUP BY acao
     ORDER BY total DESC
     LIMIT 20`,
    [usuarioId]
  );

  const cancelamentosRecentes = await dbAll(
    `SELECT id, acao, referencia_id, detalhes, criado_em
     FROM auditoria
     WHERE usuario_id = ? AND acao IN ('cancelar_venda', 'devolver_venda')
     ORDER BY criado_em DESC
     LIMIT 15`,
    [usuarioId]
  );

  const autorizacoesRecentes = await dbAll(
    `SELECT
        v.id,
        v.codigo,
        v.total,
        v.desconto,
        v.desconto_autorizado_em AS criado_em,
        v.desconto_autorizado_por AS autorizado_por
     FROM vendas v
     WHERE v.desconto_autorizado_por_id = ? AND COALESCE(v.desconto, 0) > 0
     ORDER BY v.desconto_autorizado_em DESC
     LIMIT 15`,
    [usuarioId]
  );

  const vendasRecentes = await dbAll(
    `SELECT v.id, v.codigo, v.total, v.forma_pagamento, v.data_venda, v.created_at, v.status, v.cancelada
     FROM vendas v
     WHERE v.operador_id = ?
     ORDER BY COALESCE(v.created_at, v.data_venda) DESC
     LIMIT 15`,
    [usuarioId]
  );

  const vendasPorMes = await dbAll(
    `SELECT
        strftime('%Y-%m', COALESCE(v.data_venda, v.created_at)) AS mes,
        COUNT(*) AS quantidade,
        COALESCE(SUM(${EXPR_VALOR_VENDA}), 0) AS valor_total
     FROM vendas v
     WHERE v.operador_id = ? AND ${SQL_VENDA_ATIVA}
     GROUP BY mes
     ORDER BY mes DESC
     LIMIT 12`,
    [usuarioId]
  );

  return {
    usuario,
    periodo: {
      hoje,
      inicio_mes: inicioMes,
      inicio_ano: inicioAno,
      filtro_inicio: inicioPeriodo,
      filtro_fim: fimPeriodo
    },
    vendas: {
      dia: vendasDia,
      mes: vendasMes,
      ano: vendasAno,
      periodo: vendasPeriodo,
      por_mes: vendasPorMes.map((r) => ({
        mes: r.mes,
        quantidade: Number(r.quantidade || 0),
        valor_total: Number(r.valor_total || 0)
      })),
      recentes: vendasRecentes.map((v) => ({
        id: v.id,
        codigo: v.codigo,
        total: Number(v.total || 0),
        forma_pagamento: v.forma_pagamento,
        data: v.data_venda || v.created_at,
        cancelada: Number(v.cancelada || 0) === 1 || String(v.status || '').toLowerCase() === 'cancelada'
      }))
    },
    cancelamentos: {
      via_auditoria: Number(cancelamentosAuditoria?.total || 0),
      vendas_canceladas: Number(cancelamentosOperador?.total || 0),
      valor_cancelado: Number(cancelamentosOperador?.valor || 0),
      recentes: cancelamentosRecentes.map((a) => ({
        id: a.id,
        acao: a.acao,
        referencia_id: a.referencia_id,
        criado_em: a.criado_em,
        detalhes: parseDetalhesAuditoria(a.detalhes)
      }))
    },
    devolucoes: {
      total: Number(devolucoes?.total || 0)
    },
    autorizacoes: {
      descontos_concedidos: Number(autorizacoesDesconto?.total || 0),
      valor_descontos: Number(autorizacoesDesconto?.valor_descontos || 0),
      recentes: autorizacoesRecentes.map((a) => ({
        venda_id: a.id,
        codigo: a.codigo,
        total: Number(a.total || 0),
        desconto: Number(a.desconto || 0),
        criado_em: a.criado_em,
        autorizado_por: a.autorizado_por
      }))
    },
    caixa: {
      sangrias: {
        quantidade: Number(caixaMov?.sangrias_qtd || 0),
        valor: Number(caixaMov?.sangrias_valor || 0)
      },
      suprimentos: {
        quantidade: Number(caixaMov?.suprimentos_qtd || 0),
        valor: Number(caixaMov?.suprimentos_valor || 0)
      },
      sessoes: Number(caixaSessoes?.sessoes || 0),
      fechamentos: Number(caixaSessoes?.fechamentos || 0)
    },
    acesso: {
      logins: Number(logins?.total || 0),
      ultimo_login: ultimoLogin?.criado_em || null
    },
    auditoria_resumo: acoesAuditoriaResumo.map((r) => ({
      acao: r.acao,
      total: Number(r.total || 0)
    }))
  };
}

module.exports = {
  obterRelatorioUsuario
};
