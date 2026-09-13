/**
 * Sprint 14.8 — ToledoSyncComparator
 * Compara objetos de domínio CDS × Balança (sem protocolo).
 */

'use strict';

const SITUACAO = Object.freeze({
  IGUAL: 'IGUAL',
  ALTERADO: 'ALTERADO',
  NOVO: 'NOVO',
  AUSENTE: 'AUSENTE'
});

function chavePlu(item) {
  return String(item && item.plu != null ? item.plu : '').trim();
}

function normalizar(item = {}) {
  return {
    plu: chavePlu(item),
    descricao: item.descricao != null ? String(item.descricao).trim() : '',
    preco: Number(item.preco) || 0,
    validade: item.validade != null ? String(item.validade) : null,
    tara: Number(item.tara) || 0,
    departamento: Number(item.departamento) || 0,
    codigoBarras: item.codigoBarras || item.codigo_barras || '',
    produto_id: item.produto_id != null ? item.produto_id : (item.id != null ? item.id : null)
  };
}

function iguais(a, b) {
  return a.descricao === b.descricao
    && Number(a.preco) === Number(b.preco)
    && Number(a.tara) === Number(b.tara)
    && Number(a.departamento) === Number(b.departamento)
    && String(a.codigoBarras || '') === String(b.codigoBarras || '')
    && String(a.validade || '') === String(b.validade || '');
}

/**
 * @param {Array} cdsLista
 * @param {Array} balancaLista
 * @returns {Array<{plu, situacao, cds, balanca}>}
 */
function compare(cdsLista = [], balancaLista = []) {
  const mapCds = new Map();
  const mapBal = new Map();

  for (const raw of cdsLista) {
    const n = normalizar(raw);
    if (n.plu) mapCds.set(n.plu, n);
  }
  for (const raw of balancaLista) {
    const n = normalizar(raw);
    if (n.plu) mapBal.set(n.plu, n);
  }

  const plus = new Set([...mapCds.keys(), ...mapBal.keys()]);
  const resultado = [];

  for (const plu of [...plus].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const cds = mapCds.get(plu) || null;
    const balanca = mapBal.get(plu) || null;
    let situacao;
    if (cds && balanca) {
      situacao = iguais(cds, balanca) ? SITUACAO.IGUAL : SITUACAO.ALTERADO;
    } else if (cds && !balanca) {
      situacao = SITUACAO.NOVO;
    } else {
      situacao = SITUACAO.AUSENTE;
    }
    resultado.push({ plu, situacao, cds, balanca });
  }

  return resultado;
}

module.exports = {
  compare,
  normalizar,
  SITUACAO
};
