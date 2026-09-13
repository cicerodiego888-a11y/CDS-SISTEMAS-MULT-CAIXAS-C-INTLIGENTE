/**
 * Sprint 14.8 / 15.4 — ToledoSyncPlanner
 * V1: plan(comparacao). V15.4: planFull / planIncremental.
 */

'use strict';

const { SITUACAO } = require('./ToledoSyncComparator');

const ACAO = Object.freeze({
  IGNORAR: 'IGNORAR',
  ENVIAR: 'ENVIAR',
  ATUALIZAR: 'ATUALIZAR',
  REVISAR: 'REVISAR'
});

const MODOS = Object.freeze({
  FULL: 'full',
  INCREMENTAL: 'incremental',
  DELTA: 'delta'
});

/**
 * @param {Array} comparacao resultado do Comparator
 * @returns {{itens:Array, resumo:object}}
 */
function plan(comparacao = []) {
  const itens = comparacao.map((row) => {
    let acao = ACAO.IGNORAR;
    if (row.situacao === SITUACAO.NOVO) acao = ACAO.ENVIAR;
    else if (row.situacao === SITUACAO.ALTERADO) acao = ACAO.ATUALIZAR;
    else if (row.situacao === SITUACAO.AUSENTE) acao = ACAO.REVISAR;
    else acao = ACAO.IGNORAR;

    return {
      plu: row.plu,
      situacao: row.situacao,
      acao,
      cds: row.cds,
      balanca: row.balanca,
      selecionado: acao === ACAO.ENVIAR || acao === ACAO.ATUALIZAR
    };
  });

  const resumo = {
    total: itens.length,
    iguais: itens.filter((i) => i.situacao === SITUACAO.IGUAL).length,
    alterados: itens.filter((i) => i.situacao === SITUACAO.ALTERADO).length,
    novos: itens.filter((i) => i.situacao === SITUACAO.NOVO).length,
    ausentes: itens.filter((i) => i.situacao === SITUACAO.AUSENTE).length,
    aExecutar: itens.filter((i) => i.selecionado).length
  };

  return { itens, resumo, modo: null };
}

/**
 * Upload completo: todos os produtos CDS (ENVIAR/ATUALIZAR).
 * @param {Array} produtosCds
 * @param {Array} [ultimaSyncOuBalanca] — opcional para marcar situação
 */
function planFull(produtosCds = [], ultimaSyncOuBalanca = []) {
  const balMap = indexByPlu(ultimaSyncOuBalanca);
  const itens = (Array.isArray(produtosCds) ? produtosCds : []).map((p) => {
    const plu = String(p.plu != null ? p.plu : p.codigo || '');
    const prev = balMap.get(plu);
    const situacao = !prev ? SITUACAO.NOVO : (mudou(p, prev) ? SITUACAO.ALTERADO : SITUACAO.IGUAL);
    return {
      plu,
      situacao,
      acao: ACAO.ENVIAR,
      cds: p,
      balanca: prev || null,
      selecionado: true,
      tipo: 'PLU'
    };
  });

  return {
    modo: MODOS.FULL,
    itens,
    resumo: {
      total: itens.length,
      aExecutar: itens.length,
      novos: itens.filter((i) => i.situacao === SITUACAO.NOVO).length,
      alterados: itens.filter((i) => i.situacao === SITUACAO.ALTERADO).length,
      iguais: itens.filter((i) => i.situacao === SITUACAO.IGUAL).length
    },
    carga: {
      plus: itens.map((i) => i.cds),
      departamentos: extrairDepartamentos(itens.map((i) => i.cds)),
      precos: itens.map((i) => ({ plu: i.plu, preco: i.cds.preco, tipo: 'preco' })),
      etiquetas: itens.filter((i) => i.cds.etiqueta || i.cds.label).map((i) => ({
        plu: i.plu,
        etiqueta: i.cds.etiqueta || i.cds.label,
        tipo: 'etiqueta'
      }))
    }
  };
}

/**
 * Upload incremental: somente alterações vs última sincronização / balança.
 */
function planIncremental(produtosCds = [], ultimaSyncOuBalanca = []) {
  const full = planFull(produtosCds, ultimaSyncOuBalanca);
  const itens = full.itens
    .filter((i) => i.situacao === SITUACAO.NOVO || i.situacao === SITUACAO.ALTERADO)
    .map((i) => ({
      ...i,
      acao: i.situacao === SITUACAO.NOVO ? ACAO.ENVIAR : ACAO.ATUALIZAR
    }));

  return {
    modo: MODOS.INCREMENTAL,
    itens,
    resumo: {
      total: full.itens.length,
      aExecutar: itens.length,
      novos: itens.filter((i) => i.situacao === SITUACAO.NOVO).length,
      alterados: itens.filter((i) => i.situacao === SITUACAO.ALTERADO).length,
      iguais: full.resumo.iguais,
      ignorados: full.resumo.iguais
    },
    carga: {
      plus: itens.map((i) => i.cds),
      departamentos: extrairDepartamentos(itens.map((i) => i.cds)),
      precos: itens.map((i) => ({ plu: i.plu, preco: i.cds.preco, tipo: 'preco' })),
      etiquetas: itens.filter((i) => i.cds.etiqueta || i.cds.label).map((i) => ({
        plu: i.plu,
        etiqueta: i.cds.etiqueta || i.cds.label,
        tipo: 'etiqueta'
      }))
    }
  };
}

function indexByPlu(lista) {
  const map = new Map();
  for (const item of lista || []) {
    const plu = String(item.plu != null ? item.plu : item.codigo || '');
    if (plu) map.set(plu, item);
  }
  return map;
}

function mudou(a, b) {
  if (!a || !b) return true;
  const campos = ['descricao', 'preco', 'tara', 'departamento', 'validade'];
  return campos.some((c) => String(a[c] ?? '') !== String(b[c] ?? ''));
}

function extrairDepartamentos(produtos) {
  const seen = new Set();
  const deps = [];
  for (const p of produtos || []) {
    const d = p.departamento != null ? p.departamento : p.departamento_id;
    if (d == null || seen.has(String(d))) continue;
    seen.add(String(d));
    deps.push({
      departamento: d,
      id: d,
      codigo: d,
      nome: p.departamento_nome || `Dept ${d}`
    });
  }
  return deps;
}

/**
 * Sprint 15.5 — plano a partir de delta (hash/snapshot).
 * @param {object} delta — retorno de ToledoDeltaEngine.compute
 * @param {object} [carga] — opcional (senão deriva do delta)
 */
function planDelta(delta, carga = null) {
  const deltaEngine = require('./ToledoDeltaEngine');
  const payload = carga || deltaEngine.toCarga(delta);
  const itens = (payload.plus || []).map((p) => {
    const isNovo = (delta.novos || []).some((n) => String(n.plu) === String(p.plu));
    return {
      plu: String(p.plu),
      situacao: isNovo ? SITUACAO.NOVO : SITUACAO.ALTERADO,
      acao: isNovo ? ACAO.ENVIAR : ACAO.ATUALIZAR,
      cds: p,
      balanca: null,
      selecionado: true,
      tipo: 'PLU'
    };
  });

  return {
    modo: MODOS.DELTA,
    delta,
    itens,
    resumo: {
      total: (delta.resumo?.novos || 0) + (delta.resumo?.alterados || 0) + (delta.resumo?.removidos || 0),
      aExecutar: itens.length,
      novos: delta.resumo?.novos || 0,
      alterados: delta.resumo?.alterados || 0,
      removidos: delta.resumo?.removidos || 0,
      iguais: 0,
      semAlteracoes: Boolean(delta.semAlteracoes)
    },
    carga: payload
  };
}

module.exports = {
  plan,
  planFull,
  planIncremental,
  planDelta,
  ACAO,
  MODOS
};
