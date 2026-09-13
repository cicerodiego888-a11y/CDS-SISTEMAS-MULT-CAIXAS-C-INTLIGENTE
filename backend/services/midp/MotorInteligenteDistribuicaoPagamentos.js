/**
 * MIDP — Motor Inteligente de Distribuição de Pagamentos
 *
 * Sprint 3.8A — Infraestrutura (paridade legado).
 * Sprint 3.8B — Consome Valor Fiscal Efetivo do Motor F×NF.
 * Sprint 3.8C — Consolida política oficial única: PRESERVAR DINHEIRO.
 * RC7.10.1 — Consome Valor Fiscal Líquido (após desconto/acréscimo comercial).
 *
 * Princípio: o MIDP NUNCA decide valores fiscais.
 * O MIDP apenas aloca meios de pagamento sobre valorFiscalLiquido / valorNaoFiscal.
 *
 * Política V1 (única): PRESERVAR_DINHEIRO.
 * Não há políticas paralelas nesta versão.
 */

'use strict';

const PRIORIDADE_FORMAS = Object.freeze([
  'pix',
  'cartao_debito',
  'cartao_credito',
  'cartao',
  'dinheiro'
]);

/** @deprecated Use POLITICA_PRESERVAR_DINHEIRO — mantido por compatibilidade 3.8A */
const MODO_PARIDADE_LEGADO = 'LEGACY_PARITY';

/** Política oficial única do MIDP V1 (Sprint 3.8C). */
const POLITICA_PRESERVAR_DINHEIRO = 'PRESERVAR_DINHEIRO';

/** @deprecated Alias 3.8B → política oficial 3.8C */
const MODO_PRESERVACAO_DINHEIRO = POLITICA_PRESERVAR_DINHEIRO;

const VERSAO_MIDP = '3.8C';

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function formatarMoedaBr(valor) {
  const n = round2(valor);
  return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

function isFormaDinheiro(forma) {
  const f = String(forma || '').toLowerCase().trim();
  return f === 'dinheiro' || f === 'especie' || f === 'espécie' || f === 'cash';
}

/**
 * Alocação oficial F×NF sobre pagamentos comerciais.
 * Contrato RC7.10.1: recebe valorFiscalLiquido (nunca bruto com desconto pendente).
 */
function alocarPagamentos(pagamentos = [], valorFiscalLiquido = 0, valorNaoFiscalLiquido = 0) {
  return alocarPagamentosLegado(pagamentos, valorFiscalLiquido, valorNaoFiscalLiquido);
}

/**
 * Algoritmo oficial de alocação F×NF sobre pagamentos comerciais.
 * Prioridade: eletrônicos primeiro no fiscal → dinheiro tende ao não fiscal.
 * @deprecated Preferir alocarPagamentos (alias oficial RC7.10.1).
 */
function alocarPagamentosLegado(pagamentos = [], totalFiscal = 0, totalNaoFiscal = 0) {
  let saldoFiscal = Number(totalFiscal);
  let saldoNaoFiscal = Number(totalNaoFiscal);

  const recebimentosFiscal = [];
  const recebimentosNaoFiscal = [];

  const lista = Array.isArray(pagamentos) ? pagamentos : [];
  lista.sort((a, b) => {
    const pa = PRIORIDADE_FORMAS.indexOf(a.forma_pagamento);
    const pb = PRIORIDADE_FORMAS.indexOf(b.forma_pagamento);
    return pa - pb;
  });

  for (const pagamento of lista) {
    let valorDisponivel = Number(pagamento.valor || 0);

    if (saldoFiscal > 0) {
      const valorFiscal = Math.min(saldoFiscal, valorDisponivel);

      if (valorFiscal > 0) {
        recebimentosFiscal.push({
          ...pagamento,
          valor: valorFiscal,
          tipo_recebimento: 'fiscal'
        });

        saldoFiscal -= valorFiscal;
        valorDisponivel -= valorFiscal;
      }
    }

    if (valorDisponivel > 0 && saldoNaoFiscal > 0) {
      const valorNaoFiscal = Math.min(saldoNaoFiscal, valorDisponivel);

      recebimentosNaoFiscal.push({
        ...pagamento,
        valor: valorNaoFiscal,
        tipo_recebimento: 'nao_fiscal'
      });

      saldoNaoFiscal -= valorNaoFiscal;
    }
  }

  return {
    recebimentosFiscal,
    recebimentosNaoFiscal,
    saldoFiscal,
    saldoNaoFiscal
  };
}

/**
 * Monta texto de auditoria técnica (nunca exibido ao operador).
 */
function formatarLogAuditoriaMidp(auditoria = {}) {
  const politicaLabel = auditoria.politicaAtiva
    ? 'Preservar Dinheiro'
    : 'Algoritmo Legado';

  return [
    '[MIDP]',
    `Fiscal Máximo.............${formatarMoedaBr(auditoria.valorFiscalMaximo)}`,
    `Fiscal Efetivo............${formatarMoedaBr(auditoria.valorFiscalEfetivo)}`,
    `Não Fiscal................${formatarMoedaBr(auditoria.valorNaoFiscal)}`,
    `Política..................${politicaLabel}`,
    `Dinheiro preservado.......${formatarMoedaBr(auditoria.dinheiroPreservado)}`,
    `Motivo....................${auditoria.motivo || '—'}`
  ].join('\n');
}

function emitirLogAuditoriaMidp(auditoria) {
  const texto = formatarLogAuditoriaMidp(auditoria);
  try {
    console.log(texto);
  } catch (_) {
    /* ignore */
  }
  return texto;
}

function somarDinheiroEmRecebimentos(lista = []) {
  return round2(
    (Array.isArray(lista) ? lista : [])
      .filter((p) => isFormaDinheiro(p.forma_pagamento))
      .reduce((s, p) => s + Number(p.valor || 0), 0)
  );
}

function resolverMotivoAuditoria({
  midpAtivo,
  valorFiscalMaximo,
  valorFiscalEfetivo,
  dinheiroPreservado
}) {
  if (!midpAtivo) {
    return 'MIDP desativado';
  }
  const delta = round2(Number(valorFiscalMaximo) - Number(valorFiscalEfetivo));
  if (delta > 0.009 || dinheiroPreservado > 0.009) {
    return 'Distribuição válida';
  }
  return 'Sem alternativa válida — comportamento legado';
}

/**
 * @param {object} entrada
 * @param {Array}  entrada.pagamentosComerciais
 * @param {number} entrada.valorFiscalLiquido — preferencial (RC7.10.1)
 * @param {number} entrada.valorFiscalEfetivo — alias / legado
 * @param {number} entrada.valorNaoFiscal
 * @param {number} [entrada.valorFiscalMaximo] — espelho do Motor (auditoria)
 * @param {boolean} [entrada.preservacaoAplicada]
 * @param {boolean} [entrada.emitirLog=true]
 */
function executar(entrada = {}) {
  const pagamentosComerciais = Array.isArray(entrada.pagamentosComerciais)
    ? entrada.pagamentosComerciais
    : (Array.isArray(entrada.pagamentos) ? entrada.pagamentos : []);

  // Contrato RC7.10.1: Valor Fiscal Líquido (aliases legados aceitos).
  const valorFiscalLiquido = Number(
    entrada.valorFiscalLiquido != null
      ? entrada.valorFiscalLiquido
      : (entrada.valorFiscalEfetivo != null
        ? entrada.valorFiscalEfetivo
        : (entrada.totalFiscal != null ? entrada.totalFiscal : 0))
  );
  const valorFiscalEfetivo = valorFiscalLiquido;
  const valorNaoFiscal = Number(
    entrada.valorNaoFiscal != null
      ? entrada.valorNaoFiscal
      : (entrada.totalNaoFiscal != null ? entrada.totalNaoFiscal : 0)
  );
  const valorFiscalMaximo = Number(
    entrada.valorFiscalMaximo != null ? entrada.valorFiscalMaximo : valorFiscalLiquido
  );

  let midpAtivo = false;
  if (entrada.midpAtivo != null) {
    midpAtivo = Boolean(entrada.midpAtivo);
  } else {
            // RC8.2.2 — MIDP NÃO consulta configuração (midpAtivo vem do núcleo/Orquestrador).
            // Migração: se midpAtivo omitido → false (rótulo LEGACY_PARITY). Algoritmo de alocação inalterado.
    midpAtivo = false;
  }

  const alocacao = alocarPagamentos(
    pagamentosComerciais,
    valorFiscalLiquido,
    valorNaoFiscal
  );

  const dinheiroPreservado = somarDinheiroEmRecebimentos(alocacao.recebimentosNaoFiscal);
  const politica = midpAtivo ? POLITICA_PRESERVAR_DINHEIRO : MODO_PARIDADE_LEGADO;
  const motivo = resolverMotivoAuditoria({
    midpAtivo,
    valorFiscalMaximo,
    valorFiscalEfetivo,
    dinheiroPreservado
  });

  const auditoria = {
    valorFiscalMaximo: round2(valorFiscalMaximo),
    valorFiscalEfetivo: round2(valorFiscalEfetivo),
    valorNaoFiscal: round2(valorNaoFiscal),
    politica,
    politicaAtiva: midpAtivo,
    politicaLabel: midpAtivo ? 'Preservar Dinheiro' : 'Algoritmo Legado',
    dinheiroPreservado,
    motivo,
    preservacaoAplicada: Boolean(entrada.preservacaoAplicada)
      || round2(valorFiscalMaximo - valorFiscalEfetivo) > 0.009
  };

  const logTexto = formatarLogAuditoriaMidp(auditoria);
  if (entrada.emitirLog !== false) {
    emitirLogAuditoriaMidp(auditoria);
  }

  return {
    sucesso: true,
    motor: 'MIDP',
    versao: VERSAO_MIDP,
    politica,
    modo: politica,
    pagamentoComercial: pagamentosComerciais,
    pagamentoFiscal: alocacao.recebimentosFiscal,
    pagamentoNaoFiscal: alocacao.recebimentosNaoFiscal,
    recebimentosFiscal: alocacao.recebimentosFiscal,
    recebimentosNaoFiscal: alocacao.recebimentosNaoFiscal,
    saldoFiscal: alocacao.saldoFiscal,
    saldoNaoFiscal: alocacao.saldoNaoFiscal,
    valorFiscalLiquido,
    valorFiscalEfetivo,
    valorFiscalMaximo,
    valorNaoFiscal,
    auditoria,
    logAuditoria: logTexto
  };
}

function distribuirPagamentos(pagamentos = [], totalFiscal = 0, totalNaoFiscal = 0) {
  const resultado = executar({
    pagamentosComerciais: pagamentos,
    valorFiscalLiquido: totalFiscal,
    valorFiscalEfetivo: totalFiscal,
    valorNaoFiscal: totalNaoFiscal,
    emitirLog: false
  });
  return {
    recebimentosFiscal: resultado.recebimentosFiscal,
    recebimentosNaoFiscal: resultado.recebimentosNaoFiscal,
    saldoFiscal: resultado.saldoFiscal,
    saldoNaoFiscal: resultado.saldoNaoFiscal
  };
}

module.exports = {
  PRIORIDADE_FORMAS,
  MODO_PARIDADE_LEGADO,
  MODO_PRESERVACAO_DINHEIRO,
  POLITICA_PRESERVAR_DINHEIRO,
  VERSAO_MIDP,
  executar,
  distribuirPagamentos,
  alocarPagamentos,
  alocarPagamentosLegado,
  formatarLogAuditoriaMidp,
  emitirLogAuditoriaMidp
};
