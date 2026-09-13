/**
 * Sprint 15.5 — ToledoDeltaEngine
 * Compara snapshot atual × anterior e gera delta de alterações.
 */

'use strict';

const { indexByPlu, detectarCampos, pluKey } = require('./ToledoChangeDetector');
const { hashSnapshot } = require('./ToledoSnapshotService');

/**
 * @param {object} atual — snapshot atual
 * @param {object|null} anterior — snapshot anterior (ou null = tudo novo)
 */
function compute(atual, anterior = null) {
  const plusAtual = atual?.plus || [];
  const plusAnt = anterior?.plus || [];
  const mapAnt = indexByPlu(plusAnt);
  const mapAtual = indexByPlu(plusAtual);

  const novos = [];
  const alterados = [];
  const removidos = [];
  const mudancasPreco = [];
  const mudancasDepartamento = [];
  const mudancasEtiqueta = [];
  const campos = [];

  for (const [plu, item] of mapAtual.entries()) {
    const prev = mapAnt.get(plu);
    if (!prev) {
      novos.push(item);
      campos.push({
        plu,
        produto_id: item.produto_id ?? null,
        campo: '*',
        valor_anterior: null,
        valor_novo: item,
        tipo: 'NOVO'
      });
      continue;
    }
    const diffs = detectarCampos(prev, item);
    if (diffs.length) {
      alterados.push(item);
      campos.push(...diffs);
      for (const d of diffs) {
        if (d.tipo === 'PRECO') mudancasPreco.push(d);
        if (d.tipo === 'DEPARTAMENTO') mudancasDepartamento.push(d);
        if (d.tipo === 'ETIQUETA') mudancasEtiqueta.push(d);
      }
    }
  }

  for (const [plu, item] of mapAnt.entries()) {
    if (!mapAtual.has(plu)) {
      removidos.push(item);
      campos.push({
        plu,
        produto_id: item.produto_id ?? null,
        campo: '*',
        valor_anterior: item,
        valor_novo: null,
        tipo: 'REMOVIDO'
      });
    }
  }

  const hashIgual = Boolean(
    atual && anterior
    && hashSnapshot(atual)
    && hashSnapshot(atual) === hashSnapshot(anterior)
  );

  return {
    hashAtual: hashSnapshot(atual),
    hashAnterior: hashSnapshot(anterior),
    hashIgual,
    semAlteracoes: hashIgual || (
      novos.length === 0
      && alterados.length === 0
      && removidos.length === 0
    ),
    novos,
    alterados,
    removidos,
    mudancasPreco,
    mudancasDepartamento,
    mudancasEtiqueta,
    campos,
    resumo: {
      novos: novos.length,
      alterados: alterados.length,
      removidos: removidos.length,
      precos: mudancasPreco.length,
      departamentos: mudancasDepartamento.length,
      etiquetas: mudancasEtiqueta.length,
      totalMudancas: novos.length + alterados.length + removidos.length
    }
  };
}

/**
 * Converte delta em carga para o Planner/BatchBuilder (sem removidos no wire).
 */
function toCarga(delta, opcoes = {}) {
  const plus = [...(delta.novos || []), ...(delta.alterados || [])];
  const departamentos = [];
  const seenDept = new Set();
  for (const p of plus) {
    const d = p.departamento;
    if (d == null || seenDept.has(String(d))) continue;
    seenDept.add(String(d));
    departamentos.push({ departamento: d, id: d, codigo: d, nome: `Dept ${d}` });
  }

  return {
    plus,
    departamentos: opcoes.incluirDepartamentos === false ? [] : departamentos,
    precos: plus.map((p) => ({ plu: p.plu, preco: p.preco, tipo: 'preco' })),
    etiquetas: plus
      .filter((p) => p.etiqueta || p.label)
      .map((p) => ({ plu: p.plu, etiqueta: p.etiqueta || p.label, tipo: 'etiqueta' })),
    removidos: delta.removidos || []
  };
}

class ToledoDeltaEngine {
  compute(atual, anterior) {
    return compute(atual, anterior);
  }

  toCarga(delta, opcoes) {
    return toCarga(delta, opcoes);
  }
}

module.exports = ToledoDeltaEngine;
module.exports.ToledoDeltaEngine = ToledoDeltaEngine;
module.exports.compute = compute;
module.exports.toCarga = toCarga;
module.exports.pluKey = pluKey;
