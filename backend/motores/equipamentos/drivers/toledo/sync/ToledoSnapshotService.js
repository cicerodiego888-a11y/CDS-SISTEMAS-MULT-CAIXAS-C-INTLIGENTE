/**
 * Sprint 15.5 — ToledoSnapshotService
 * Gera e persiste snapshots de carga (PLUs, depts, preços, etiquetas, hash, versão).
 */

'use strict';

const crypto = require('crypto');
const { pluKey, normalizar } = require('./ToledoChangeDetector');
const { hashPayload } = require('./ToledoDeltaRepository');

function extrairDepartamentos(plus = []) {
  const seen = new Set();
  const deps = [];
  for (const p of plus) {
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
 * Monta snapshot canônico a partir de produtos CDS / carga.
 */
function buildFromProdutos(produtos = [], meta = {}) {
  const plus = (Array.isArray(produtos) ? produtos : [])
    .map(normalizar)
    .filter((p) => p && p.plu)
    .sort((a, b) => String(a.plu).localeCompare(String(b.plu), undefined, { numeric: true }));

  const departamentos = meta.departamentos || extrairDepartamentos(plus);
  const precos = plus.map((p) => ({ plu: p.plu, preco: p.preco }));
  const etiquetas = plus
    .filter((p) => p.etiqueta || p.label)
    .map((p) => ({ plu: p.plu, etiqueta: p.etiqueta || p.label }));
  const promocoes = plus
    .filter((p) => p.promocao)
    .map((p) => ({ plu: p.plu, promocao: p.promocao }));

  const corpo = {
    plus,
    departamentos,
    precos,
    etiquetas,
    promocoes
  };
  const hash = hashPayload(corpo);

  return {
    versao: meta.versao || null,
    hash,
    data: meta.data || new Date().toISOString(),
    equipamentoId: meta.equipamentoId || meta.equipamento_id || null,
    host: meta.host || null,
    porta: meta.porta != null ? Number(meta.porta) : null,
    totalPlus: plus.length,
    ...corpo
  };
}

function hashSnapshot(snapshot) {
  if (!snapshot) return null;
  if (snapshot.hash) return snapshot.hash;
  return hashPayload({
    plus: snapshot.plus || [],
    departamentos: snapshot.departamentos || [],
    precos: snapshot.precos || [],
    etiquetas: snapshot.etiquetas || [],
    promocoes: snapshot.promocoes || []
  });
}

class ToledoSnapshotService {
  constructor(deps = {}) {
    this.repository = deps.repository || null;
  }

  criar(produtos, meta = {}) {
    return buildFromProdutos(produtos, meta);
  }

  hash(snapshot) {
    return hashSnapshot(snapshot);
  }

  /**
   * Persiste snapshot embutido em versão (via VersionManager/repo).
   */
  async persistirNaVersao(versionId, snapshot) {
    if (!this.repository) return snapshot;
    await this.repository.atualizarVersao(versionId, {
      snapshot,
      hash: hashSnapshot(snapshot)
    });
    return snapshot;
  }

  fromVersion(versionRow) {
    if (!versionRow) return null;
    const snap = versionRow.snapshot;
    if (!snap) return null;
    return typeof snap === 'string' ? JSON.parse(snap) : snap;
  }
}

module.exports = ToledoSnapshotService;
module.exports.ToledoSnapshotService = ToledoSnapshotService;
module.exports.buildFromProdutos = buildFromProdutos;
module.exports.hashSnapshot = hashSnapshot;
module.exports.hashPayload = hashPayload;
module.exports.pluKey = pluKey;
