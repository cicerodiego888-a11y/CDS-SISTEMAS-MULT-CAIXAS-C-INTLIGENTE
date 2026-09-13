/**
 * Sprint 15.5 — ToledoConflictResolver
 * Detecta conflitos: alteração simultânea, PLU duplicado, produto inexistente.
 */

'use strict';

const { pluKey, indexByPlu, detectarCampos } = require('./ToledoChangeDetector');

const TIPOS = Object.freeze({
  PLU_DUPLICADO: 'PLU_DUPLICADO',
  PRODUTO_INEXISTENTE: 'PRODUTO_INEXISTENTE',
  ALTERACAO_SIMULTANEA: 'ALTERACAO_SIMULTANEA',
  ALTERADO_DURANTE_SYNC: 'ALTERADO_DURANTE_SYNC'
});

/**
 * @param {object} ctx
 * @param {Array} ctx.produtos — carga a enviar
 * @param {object} [ctx.snapshotBase] — snapshot no início do planning
 * @param {object} [ctx.snapshotAgora] — snapshot recalculado no commit
 * @param {Array} [ctx.balanca] — estado lido da balança (opcional)
 */
function detectar(ctx = {}) {
  const conflitos = [];
  const produtos = Array.isArray(ctx.produtos) ? ctx.produtos : [];
  const seen = new Map();

  for (const p of produtos) {
    const plu = pluKey(p);
    if (!plu) {
      conflitos.push({
        tipo: TIPOS.PRODUTO_INEXISTENTE,
        plu: null,
        mensagem: 'Produto sem PLU',
        produto: p
      });
      continue;
    }
    if (seen.has(plu)) {
      conflitos.push({
        tipo: TIPOS.PLU_DUPLICADO,
        plu,
        mensagem: `PLU duplicado na carga: ${plu}`,
        produto: p
      });
    } else {
      seen.set(plu, p);
    }
  }

  if (ctx.snapshotBase && ctx.snapshotAgora) {
    const base = indexByPlu(ctx.snapshotBase.plus || []);
    const agora = indexByPlu(ctx.snapshotAgora.plus || []);
    for (const [plu, itemAgora] of agora.entries()) {
      const itemBase = base.get(plu);
      if (!itemBase) continue;
      const diffs = detectarCampos(itemBase, itemAgora);
      // Se o snapshot "agora" mudou vs base enquanto sync rodava (hash diferente no mesmo PLU planejado)
      if (diffs.length && ctx.plusPlanejados) {
        const planejado = ctx.plusPlanejados.has
          ? ctx.plusPlanejados.has(plu)
          : (ctx.plusPlanejados || []).includes(plu);
        if (planejado) {
          conflitos.push({
            tipo: TIPOS.ALTERADO_DURANTE_SYNC,
            plu,
            mensagem: `Produto ${plu} alterado durante a sincronização`,
            campos: diffs
          });
        }
      }
    }

    if (hashMudou(ctx.snapshotBase, ctx.snapshotAgora) && !conflitos.some((c) => c.tipo === TIPOS.ALTERADO_DURANTE_SYNC)) {
      // alteração simultânea global
      if (ctx.detectarSimultanea !== false) {
        conflitos.push({
          tipo: TIPOS.ALTERACAO_SIMULTANEA,
          plu: null,
          mensagem: 'Carga ERP alterada durante o planejamento/execução',
          hashBase: ctx.snapshotBase.hash,
          hashAgora: ctx.snapshotAgora.hash
        });
      }
    }
  }

  return {
    ok: conflitos.length === 0,
    conflitos,
    resumo: {
      total: conflitos.length,
      duplicados: conflitos.filter((c) => c.tipo === TIPOS.PLU_DUPLICADO).length,
      inexistentes: conflitos.filter((c) => c.tipo === TIPOS.PRODUTO_INEXISTENTE).length,
      simultaneos: conflitos.filter((c) =>
        c.tipo === TIPOS.ALTERACAO_SIMULTANEA || c.tipo === TIPOS.ALTERADO_DURANTE_SYNC).length
    }
  };
}

function hashMudou(a, b) {
  return Boolean(a?.hash && b?.hash && a.hash !== b.hash);
}

class ToledoConflictResolver {
  detectar(ctx) {
    return detectar(ctx);
  }
}

module.exports = ToledoConflictResolver;
module.exports.ToledoConflictResolver = ToledoConflictResolver;
module.exports.detectar = detectar;
module.exports.TIPOS = TIPOS;
