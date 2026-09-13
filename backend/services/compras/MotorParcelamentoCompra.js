/**
 * RC8.5.0 — Parcelamento flexível na compra.
 * Gera grade de parcelas e valida soma = total da nota.
 * Não altera regras fiscais / XML / MIIP.
 *
 * @module services/compras/MotorParcelamentoCompra
 */

'use strict';

function moeda(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function numInt(v, fallback = 1) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Adiciona dias a uma data YYYY-MM-DD (calendário civil).
 */
function adicionarDias(dataIso, dias) {
  const base = String(dataIso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return base;
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(dias || 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Divide valor total em N parcelas (centavos), resto na última.
 */
function dividirValorEmParcelas(valorTotal, quantidade) {
  const qtd = Math.max(1, numInt(quantidade, 1));
  const total = moeda(valorTotal);
  const base = Math.floor((total / qtd) * 100) / 100;
  const resto = moeda(total - base * qtd);
  const valores = [];
  for (let i = 1; i <= qtd; i += 1) {
    valores.push(moeda(base + (i === qtd ? resto : 0)));
  }
  return valores;
}

/**
 * Gera grade automática.
 * @param {Object} input
 * @param {number} input.valorTotal
 * @param {number} input.quantidadeParcelas
 * @param {number} input.diasEntreParcelas
 * @param {string} input.primeiroVencimento YYYY-MM-DD
 * @param {number} [input.valorEntrada] se > 0, parcela 1 = entrada (venc. = primeiro) e demais no restante
 * @returns {{ parcelas: Array<{numero,vencimento,valor}>, totalParcelas: number, soma: number }}
 */
function gerarGradeParcelas(input = {}) {
  const valorTotal = moeda(input.valorTotal ?? input.valor_total ?? 0);
  const dias = Math.max(0, numInt(input.diasEntreParcelas ?? input.dias_entre_parcelas, 30));
  const primeiro = String(input.primeiroVencimento || input.data_vencimento || '').slice(0, 10);
  const valorEntrada = moeda(input.valorEntrada ?? input.valor_entrada ?? 0);
  let qtd = Math.max(1, numInt(input.quantidadeParcelas ?? input.parcelas, 1));

  const parcelas = [];

  if (valorEntrada > 0) {
    const restante = moeda(Math.max(0, valorTotal - valorEntrada));
    const valoresRestantes = dividirValorEmParcelas(restante, qtd);
    const totalLinhas = valoresRestantes.length + 1;
    parcelas.push({
      numero: 1,
      vencimento: primeiro,
      valor: valorEntrada,
      tipo: 'entrada'
    });
    valoresRestantes.forEach((valor, idx) => {
      parcelas.push({
        numero: idx + 2,
        vencimento: adicionarDias(primeiro, dias * (idx + 1)),
        valor,
        tipo: 'parcela'
      });
    });
    const soma = moeda(parcelas.reduce((s, p) => s + Number(p.valor || 0), 0));
    return { parcelas, totalParcelas: totalLinhas, soma, valorTotal };
  }

  const valores = dividirValorEmParcelas(valorTotal, qtd);
  valores.forEach((valor, idx) => {
    parcelas.push({
      numero: idx + 1,
      vencimento: adicionarDias(primeiro, dias * idx),
      valor,
      tipo: 'parcela'
    });
  });
  const soma = moeda(parcelas.reduce((s, p) => s + Number(p.valor || 0), 0));
  return { parcelas, totalParcelas: parcelas.length, soma, valorTotal };
}

/**
 * Valida se a soma das parcelas = total da nota.
 * @returns {{ ok: boolean, soma: number, valorTotal: number, diferenca: number, mensagem: string|null }}
 */
function validarSomaParcelas(parcelas, valorTotal) {
  const total = moeda(valorTotal);
  const lista = Array.isArray(parcelas) ? parcelas : [];
  const soma = moeda(lista.reduce((s, p) => s + Number(p.valor || 0), 0));
  const diferenca = moeda(soma - total);
  if (Math.abs(diferenca) < 0.005) {
    return { ok: true, soma, valorTotal: total, diferenca: 0, mensagem: null };
  }
  if (diferenca < 0) {
    return {
      ok: false,
      soma,
      valorTotal: total,
      diferenca,
      mensagem: `Faltam: R$ ${Math.abs(diferenca).toFixed(2).replace('.', ',')}`
    };
  }
  return {
    ok: false,
    soma,
    valorTotal: total,
    diferenca,
    mensagem: `Excesso: R$ ${diferenca.toFixed(2).replace('.', ',')}`
  };
}

/**
 * Normaliza grade vinda do cliente.
 */
function normalizarParcelasDetalhe(lista) {
  if (!Array.isArray(lista)) return [];
  return lista.map((p, idx) => ({
    numero: numInt(p.numero, idx + 1),
    documento: p.documento != null ? String(p.documento) : (p.nDup != null ? String(p.nDup) : null),
    vencimento: String(p.vencimento || p.data_vencimento || p.dVenc || '').slice(0, 10),
    valor: moeda(p.valor ?? p.vDup),
    tipo: p.tipo || 'parcela'
  })).filter((p) => p.vencimento && p.valor >= 0);
}

/**
 * RC8.5.1 — Grade a partir de modelo (ex.: dias [30,60,90] a partir da data-base).
 * @param {Object} input
 * @param {number} input.valorTotal
 * @param {number[]} input.diasParcelas — dias absolutos desde a data-base
 * @param {string} input.dataBase YYYY-MM-DD
 * @param {number} [input.valorEntrada]
 * @param {boolean} [input.temEntrada]
 */
function gerarGradePorModelo(input = {}) {
  const valorTotal = moeda(input.valorTotal ?? input.valor_total ?? 0);
  const dataBase = String(input.dataBase || input.data_base || input.primeiroVencimento || '').slice(0, 10);
  const diasBrutos = Array.isArray(input.diasParcelas)
    ? input.diasParcelas
    : (Array.isArray(input.dias_parcelas) ? input.dias_parcelas : []);
  const dias = diasBrutos.map((d) => Math.max(0, numInt(d, 0)));
  const temEntrada = input.temEntrada === true
    || Number(input.tem_entrada) === 1
    || moeda(input.valorEntrada ?? input.valor_entrada ?? 0) > 0;
  const valorEntrada = temEntrada
    ? moeda(input.valorEntrada ?? input.valor_entrada ?? 0)
    : 0;

  if (!dias.length) {
    return {
      parcelas: [{
        numero: 1,
        vencimento: dataBase,
        valor: valorTotal,
        tipo: valorEntrada > 0 ? 'entrada' : 'parcela'
      }],
      totalParcelas: 1,
      soma: valorTotal,
      valorTotal
    };
  }

  const parcelas = [];

  if (valorEntrada > 0) {
    parcelas.push({
      numero: 1,
      vencimento: dataBase,
      valor: valorEntrada,
      tipo: 'entrada'
    });
    const restante = moeda(Math.max(0, valorTotal - valorEntrada));
    const valores = dividirValorEmParcelas(restante, dias.length);
    dias.forEach((d, idx) => {
      parcelas.push({
        numero: idx + 2,
        vencimento: adicionarDias(dataBase, d),
        valor: valores[idx],
        tipo: 'parcela'
      });
    });
  } else {
    const valores = dividirValorEmParcelas(valorTotal, dias.length);
    dias.forEach((d, idx) => {
      parcelas.push({
        numero: idx + 1,
        vencimento: adicionarDias(dataBase, d),
        valor: valores[idx],
        tipo: 'parcela'
      });
    });
  }

  const soma = moeda(parcelas.reduce((s, p) => s + Number(p.valor || 0), 0));
  return { parcelas, totalParcelas: parcelas.length, soma, valorTotal };
}

/**
 * Parseia nome/código tipo "30/60/90" ou "Entrada + 30/60" → dias[].
 */
function parsearDiasDoNomeCondicao(nome) {
  const texto = String(nome || '').trim();
  if (!texto) return { dias: [], temEntrada: false };
  const temEntrada = /entrada/i.test(texto);
  const corpo = texto.replace(/entrada\s*\+?\s*/i, '');
  if (/^à?\s*vista$/i.test(texto) || /^avista$/i.test(texto)) {
    return { dias: [0], temEntrada: false };
  }
  const partes = corpo.split(/[\/|,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const dias = [];
  partes.forEach((p) => {
    const m = p.match(/(\d+)/);
    if (m) dias.push(Number(m[1]));
  });
  if (!dias.length && /^\d+$/.test(corpo)) dias.push(Number(corpo));
  return { dias, temEntrada };
}

module.exports = {
  moeda,
  adicionarDias,
  dividirValorEmParcelas,
  gerarGradeParcelas,
  gerarGradePorModelo,
  parsearDiasDoNomeCondicao,
  validarSomaParcelas,
  normalizarParcelasDetalhe
};
