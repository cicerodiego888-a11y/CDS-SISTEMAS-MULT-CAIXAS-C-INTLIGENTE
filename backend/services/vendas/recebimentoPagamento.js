/**
 * Camada de pagamento — Recebimento A / Recebimento B.
 * Interno (NFC-e / Motor): A ⇔ fiscal, B ⇔ nao_fiscal.
 * Interface, API de pagamento e logs funcionais: apenas A/B.
 */
'use strict';

const GRUPO_A = 'A';
const GRUPO_B = 'B';

function textoTipo(valor) {
  return String(valor || '').toLowerCase().trim();
}

function grupoRecebimento(tipoOuGrupo) {
  const t = textoTipo(tipoOuGrupo);
  if (
    t === 'a'
    || t === 'recebimento_a'
    || t === 'recebimento a'
    || t === 'fiscal'
  ) {
    return GRUPO_A;
  }
  if (
    t === 'b'
    || t === 'recebimento_b'
    || t === 'recebimento b'
    || t === 'nao_fiscal'
    || t === 'nao fiscal'
    || t === 'não fiscal'
  ) {
    return GRUPO_B;
  }
  return null;
}

function ehGrupoA(tipoOuGrupo) {
  return grupoRecebimento(tipoOuGrupo) === GRUPO_A;
}

function ehGrupoB(tipoOuGrupo) {
  return grupoRecebimento(tipoOuGrupo) === GRUPO_B;
}

function tipoInternoRecebimento(tipoOuGrupo) {
  const g = grupoRecebimento(tipoOuGrupo);
  if (g === GRUPO_A) return 'fiscal';
  if (g === GRUPO_B) return 'nao_fiscal';
  return null;
}

function rotuloRecebimento(tipoOuGrupo) {
  const g = grupoRecebimento(tipoOuGrupo);
  if (g === GRUPO_A) return 'Recebimento A';
  if (g === GRUPO_B) return 'Recebimento B';
  return '';
}

function ordemGrupoRecebimento(tipoOuGrupo) {
  const g = grupoRecebimento(tipoOuGrupo);
  if (g === GRUPO_A) return 0;
  if (g === GRUPO_B) return 1;
  return 2;
}

function ordenarRecebimentosAB(linhas) {
  return [...(Array.isArray(linhas) ? linhas : [])].sort((a, b) => (
    ordemGrupoRecebimento(a && (a.grupo_recebimento || a.tipo_recebimento))
    - ordemGrupoRecebimento(b && (b.grupo_recebimento || b.tipo_recebimento))
  ));
}

function persistirGrupoRecebimento(linha) {
  return grupoRecebimento(
    linha && (linha.grupo_recebimento || linha.tipo_recebimento)
  );
}

function mapearPagamentoRespostaApi(linha) {
  const grupo = persistirGrupoRecebimento(linha);
  return {
    forma_pagamento: linha.forma_pagamento,
    valor: Number(linha.valor || 0),
    status: linha.status || null,
    grupo_recebimento: grupo,
    rotulo_recebimento: rotuloRecebimento(grupo)
  };
}

/**
 * Prefere venda_recebimentos; se a venda não tiver linhas, usa venda_pagamentos.
 * Não inventa A/B quando tipo_recebimento está vazio.
 */
function agruparPagamentosExibicaoPorVenda(recebimentos, pagamentos) {
  const recPorVenda = new Map();
  for (const r of Array.isArray(recebimentos) ? recebimentos : []) {
    const id = Number(r.venda_id);
    if (!Number.isFinite(id)) continue;
    if (!recPorVenda.has(id)) recPorVenda.set(id, []);
    recPorVenda.get(id).push(r);
  }
  const pagPorVenda = new Map();
  for (const p of Array.isArray(pagamentos) ? pagamentos : []) {
    const id = Number(p.venda_id);
    if (!Number.isFinite(id)) continue;
    if (!pagPorVenda.has(id)) pagPorVenda.set(id, []);
    pagPorVenda.get(id).push(p);
  }
  const ids = new Set([...recPorVenda.keys(), ...pagPorVenda.keys()]);
  const result = {};
  for (const id of ids) {
    const recs = recPorVenda.get(id) || [];
    const linhas = recs.length ? recs : (pagPorVenda.get(id) || []);
    result[id] = ordenarRecebimentosAB(linhas).map(mapearPagamentoRespostaApi);
  }
  return result;
}

function somarPorGrupo(linhas, grupo) {
  return Math.round(
    (Array.isArray(linhas) ? linhas : [])
      .filter((l) => grupoRecebimento(l.grupo_recebimento || l.tipo_recebimento) === grupo)
      .reduce((s, l) => s + Number(l.valor || 0), 0) * 100
  ) / 100;
}

function round2Recebimento(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function resolverFluxoVendaRecebimentos(body = {}) {
  const fluxo = String(body.fluxo_venda || body.fluxoVenda || '').toLowerCase().trim();
  if (fluxo === 'fiscal') return true;
  if (fluxo === 'nao_fiscal' || fluxo === 'nao-fiscal' || fluxo === 'b') return false;
  return null;
}

function flagVerdadeira(valor) {
  if (valor === true || valor === 1) return true;
  const t = String(valor == null ? '' : valor).toLowerCase().trim();
  return t === '1' || t === 'true' || t === 'sim' || t === 'fiscal';
}

/** F12 / fluxo da venda. Sem fluxo_venda, usa venda_fiscal e por último emitir_fiscal. */
function resolverFluxoVendaEfetivo(body = {}) {
  const explicit = resolverFluxoVendaRecebimentos(body);
  if (explicit !== null) return explicit;
  if (body.venda_fiscal !== undefined && body.venda_fiscal !== null && body.venda_fiscal !== '') {
    return flagVerdadeira(body.venda_fiscal);
  }
  return flagVerdadeira(body.emitir_fiscal);
}

/**
 * Orquestração de recebimentos: o fluxo da venda (F12) manda, não o saldo interno.
 * Venda não fiscal → somente B (total comercial).
 * Venda fiscal → A/B da composição final (já com transferência, se houver).
 */
function decidirFluxoRecebimentosAB(valorA, valorB, opcoes = {}) {
  const totalComercial = round2Recebimento(
    opcoes.totalComercial != null ? opcoes.totalComercial : (Number(valorA || 0) + Number(valorB || 0))
  );
  const fluxoFiscal = opcoes.fluxoVendaFiscal === true;

  if (!fluxoFiscal) {
    const b = totalComercial > 0 ? totalComercial : round2Recebimento(valorB);
    return {
      fluxoVenda: 'nao_fiscal',
      valorA: 0,
      valorB: b,
      abrirA: false,
      abrirB: b > 0,
      somenteA: false,
      somenteB: b > 0,
      mista: false,
      ordem: b > 0 ? ['B'] : []
    };
  }

  const a = round2Recebimento(valorA);
  const b = round2Recebimento(valorB);
  const abrirA = a > 0;
  const abrirB = b > 0;
  const ordem = [];
  if (abrirA) ordem.push('A');
  if (abrirB) ordem.push('B');
  return {
    fluxoVenda: 'fiscal',
    valorA: a,
    valorB: b,
    abrirA,
    abrirB,
    somenteA: abrirA && !abrirB,
    somenteB: !abrirA && abrirB,
    mista: abrirA && abrirB,
    ordem
  };
}

function consolidarRecebimentosSomenteB({ pagamentosVenda, total, formaPagamento, tef } = {}) {
  const pags = Array.isArray(pagamentosVenda) && pagamentosVenda.length
    ? pagamentosVenda.filter((p) => Number(p.valor || 0) > 0)
    : [];
  const base = pags.length
    ? pags
    : [{
        forma_pagamento: formaPagamento,
        valor: round2Recebimento(total),
        tef_transacao_id: tef && tef.transacao_id,
        nsu: tef && tef.nsu,
        autorizacao: tef && tef.autorizacao,
        tef
      }];
  return base.map((p) => ({
    ...p,
    tipo_recebimento: 'nao_fiscal',
    grupo_recebimento: GRUPO_B
  }));
}

/**
 * Recebimentos persistidos: fluxo da venda, não saldo interno do Motor.
 * Não fiscal → uma (ou N comerciais) linha(s) B no total comercial.
 * Fiscal → composição A/B já calculada (transferência incluída no Motor).
 */
function aplicarPoliticaRecebimentosFluxoVenda({
  body = {},
  totalFiscal,
  totalNaoFiscal,
  totalComercial,
  pagamentosVenda,
  formaPagamento,
  tef,
  recebimentosOrquestrador
} = {}) {
  const fluxoVendaFiscal = resolverFluxoVendaEfetivo(body);
  const recebimentos = fluxoVendaFiscal
    ? (Array.isArray(recebimentosOrquestrador) ? recebimentosOrquestrador : [])
    : consolidarRecebimentosSomenteB({
        pagamentosVenda,
        total: totalComercial,
        formaPagamento,
        tef
      });
  return {
    fluxoVendaFiscal,
    recebimentos,
    valorFiscalStatus: fluxoVendaFiscal ? Number(totalFiscal || 0) : 0,
    valorNaoFiscalStatus: fluxoVendaFiscal
      ? Number(totalNaoFiscal || 0)
      : round2Recebimento(totalComercial)
  };
}

module.exports = {
  GRUPO_A,
  GRUPO_B,
  grupoRecebimento,
  ehGrupoA,
  ehGrupoB,
  tipoInternoRecebimento,
  rotuloRecebimento,
  ordemGrupoRecebimento,
  ordenarRecebimentosAB,
  persistirGrupoRecebimento,
  mapearPagamentoRespostaApi,
  agruparPagamentosExibicaoPorVenda,
  somarPorGrupo,
  resolverFluxoVendaRecebimentos,
  resolverFluxoVendaEfetivo,
  decidirFluxoRecebimentosAB,
  consolidarRecebimentosSomenteB,
  aplicarPoliticaRecebimentosFluxoVenda
};
