/**
 * Sprint 14.7 — ToledoPluValidator
 * RC15.5 — ValidationReport com campo / valor / motivo (nunca só VALIDATION_ERROR).
 */

'use strict';

const { PluError, CODES } = require('./ToledoPluErrors');

const LIMITES = Object.freeze({
  pluMaxLen: 8,
  descricaoMax: 22,
  codigoBarrasMax: 14,
  precoMax: 999999.99,
  departamentoMax: 99,
  departamentoMin: 1
});

/**
 * @typedef {object} ValidationErrorItem
 * @property {string} campo
 * @property {*} valor
 * @property {string} motivo
 */

/**
 * @typedef {object} ValidationCheck
 * @property {string} campo
 * @property {string} label
 * @property {*} valor
 * @property {boolean} ok
 * @property {string} [motivo]
 */

/**
 * @typedef {object} ValidationReport
 * @property {boolean} success
 * @property {ValidationErrorItem[]} errors
 * @property {ValidationCheck[]} checks
 * @property {object} produto
 */

function pushCheck(checks, errors, { campo, label, valor, ok, motivo }) {
  checks.push({
    campo,
    label: label || campo,
    valor: valor === undefined ? null : valor,
    ok: Boolean(ok),
    motivo: ok ? undefined : (motivo || 'Validação falhou.')
  });
  if (!ok) {
    errors.push({
      campo,
      valor: valor === undefined ? null : valor,
      motivo: motivo || 'Validação falhou.'
    });
  }
}

/**
 * RC15.5 — gera relatório completo de validação do PLU.
 * @param {object} plu estrutura mapeada (ToledoPluMapper)
 * @param {object} [contexto] produto original (ativo, pesável, etc.)
 * @returns {ValidationReport}
 */
function buildReport(plu = {}, contexto = {}) {
  const errors = [];
  const checks = [];
  const src = contexto && typeof contexto === 'object' ? contexto : {};

  const produtoId = plu.produto_id != null ? plu.produto_id : (src.id != null ? src.id : src.produto_id);
  const descricao = plu.descricao != null ? plu.descricao : (src.descricao || src.nome || null);
  const pluCode = plu.plu != null ? String(plu.plu).trim() : '';

  // —— Produto ativo ——
  const ativoRaw = src.ativo !== undefined ? src.ativo : plu.ativo;
  const ativoInformado = ativoRaw !== undefined && ativoRaw !== null;
  const ativoOk = !ativoInformado || !(ativoRaw === 0 || ativoRaw === false || ativoRaw === '0');
  pushCheck(checks, errors, {
    campo: 'ativo',
    label: 'Produto ativo',
    valor: ativoInformado ? ativoRaw : null,
    ok: ativoOk,
    motivo: 'Produto inativo — envio para balança não permitido.'
  });

  // —— Produto pesável ——
  const pesavelRaw = src.produto_fracionado ?? src.vendido_por_peso ?? src.produto_pesavel ?? plu.produto_fracionado;
  const pesavelInformado = pesavelRaw !== undefined && pesavelRaw !== null;
  const pesavelOk = !pesavelInformado || Number(pesavelRaw) === 1 || pesavelRaw === true || pesavelRaw === '1';
  pushCheck(checks, errors, {
    campo: 'produto_pesavel',
    label: 'Produto pesável',
    valor: pesavelInformado ? pesavelRaw : null,
    ok: pesavelOk,
    motivo: 'Produto não pesável — envio para balança não permitido.'
  });

  // —— PLU ——
  let pluOk = true;
  let pluMotivo = '';
  if (!pluCode) {
    pluOk = false;
    pluMotivo = 'PLU obrigatório.';
  } else if (!/^\d{1,8}$/.test(pluCode) || pluCode.length > LIMITES.pluMaxLen) {
    pluOk = false;
    pluMotivo = pluCode.length > LIMITES.pluMaxLen
      ? `PLU excede ${LIMITES.pluMaxLen} dígitos.`
      : 'PLU inválido — use apenas dígitos.';
  }
  pushCheck(checks, errors, {
    campo: 'plu',
    label: 'PLU válido',
    valor: pluCode || null,
    ok: pluOk,
    motivo: pluMotivo
  });

  // —— Departamento ——
  const depRaw = plu.departamento;
  const depNum = depRaw == null || depRaw === '' ? NaN : Number(depRaw);
  let depOk = true;
  let depMotivo = '';
  if (depRaw == null || depRaw === '' || Number.isNaN(depNum)) {
    depOk = false;
    depMotivo = 'Departamento obrigatório.';
  } else if (depNum < LIMITES.departamentoMin) {
    depOk = false;
    depMotivo = 'Departamento obrigatório.';
  } else if (depNum > LIMITES.departamentoMax) {
    depOk = false;
    depMotivo = `Departamento deve ser no máximo ${LIMITES.departamentoMax}.`;
  }
  pushCheck(checks, errors, {
    campo: 'departamento',
    label: 'Departamento',
    valor: depRaw == null ? null : depRaw,
    ok: depOk,
    motivo: depMotivo
  });

  // —— Unidade ——
  const unidade = plu.unidade != null && String(plu.unidade).trim() !== ''
    ? String(plu.unidade).trim()
    : (src.unidade != null && String(src.unidade).trim() !== '' ? String(src.unidade).trim() : null);
  const unidadeOk = Boolean(unidade);
  pushCheck(checks, errors, {
    campo: 'unidade',
    label: 'Unidade',
    valor: unidade,
    ok: unidadeOk,
    motivo: 'Unidade obrigatória.'
  });

  // —— Preço ——
  const precoRaw = plu.preco;
  const precoNum = precoRaw == null || precoRaw === '' ? NaN : Number(precoRaw);
  let precoOk = true;
  let precoMotivo = '';
  if (precoRaw == null || precoRaw === '' || Number.isNaN(precoNum)) {
    precoOk = false;
    precoMotivo = 'Preço obrigatório.';
  } else if (precoNum <= 0) {
    precoOk = false;
    precoMotivo = 'Preço deve ser maior que zero.';
  } else if (precoNum > LIMITES.precoMax) {
    precoOk = false;
    precoMotivo = `Preço excede o máximo permitido (${LIMITES.precoMax}).`;
  }
  pushCheck(checks, errors, {
    campo: 'preco',
    label: 'Preço',
    valor: precoRaw == null ? null : precoRaw,
    ok: precoOk,
    motivo: precoMotivo
  });

  // —— Descrição ——
  const descStr = descricao != null ? String(descricao).trim() : '';
  let descOk = true;
  let descMotivo = '';
  if (!descStr) {
    descOk = false;
    descMotivo = 'Descrição obrigatória.';
  } else if (descStr.length > LIMITES.descricaoMax) {
    descOk = false;
    descMotivo = `Descrição excede ${LIMITES.descricaoMax} caracteres.`;
  }
  pushCheck(checks, errors, {
    campo: 'descricao',
    label: 'Descrição',
    valor: descStr || null,
    ok: descOk,
    motivo: descMotivo
  });

  // —— Código de barras (opcional) ——
  if (plu.codigoBarras && String(plu.codigoBarras).length > LIMITES.codigoBarrasMax) {
    pushCheck(checks, errors, {
      campo: 'codigoBarras',
      label: 'Código de barras',
      valor: plu.codigoBarras,
      ok: false,
      motivo: `Código de barras excede ${LIMITES.codigoBarrasMax} caracteres.`
    });
  }

  return {
    success: errors.length === 0,
    errors,
    checks,
    produto: {
      id: produtoId != null ? produtoId : null,
      descricao: descStr || null,
      plu: pluCode || null
    },
    limites: LIMITES
  };
}

/**
 * Compatível com API anterior: { ok, errors: string[], ...report }
 */
function validate(plu = {}, contexto = {}) {
  const report = buildReport(plu, contexto);
  return {
    ok: report.success,
    errors: report.errors.map((e) => e.motivo),
    errorCodes: report.errors.map((e) => e.campo),
    report,
    limites: LIMITES
  };
}

/**
 * Log no terminal no formato RC15.5.
 * @param {ValidationReport} report
 */
function logReport(report) {
  if (!report) return;
  const pad = (label, ok) => {
    const dots = '.'.repeat(Math.max(2, 26 - String(label).length));
    return `${label}${dots}${ok ? 'OK' : 'FALHOU'}`;
  };
  const lines = [
    '',
    '===== VALIDAÇÃO DO PLU =====',
    'Produto:',
    String(report.produto?.descricao || '—'),
    'PLU:',
    String(report.produto?.plu || '—')
  ];
  if (report.produto?.id != null) {
    lines.push('Produto ID:', String(report.produto.id));
  }
  for (const c of report.checks || []) {
    lines.push(pad(c.label || c.campo, c.ok));
  }
  if (!report.success && Array.isArray(report.errors) && report.errors.length) {
    lines.push('Motivos:');
    for (const e of report.errors) {
      lines.push(`• ${e.motivo}`);
    }
  }
  lines.push('=============================');
  lines.push('');
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

/**
 * Formato checklist (✔ / ✖) para logs estruturados.
 * @param {ValidationReport} report
 * @returns {string}
 */
function formatChecklist(report) {
  return (report.checks || [])
    .map((c) => `${c.ok ? '✔' : '✖'} ${c.label || c.campo}`)
    .join('\n');
}

function assertValid(plu, contexto = {}) {
  const report = buildReport(plu, contexto);
  logReport(report);
  if (!report.success) {
    const motivos = report.errors.map((e) => e.motivo).join(' ');
    const err = PluError.fromCode(
      CODES.VALIDATION_ERROR,
      motivos || 'PLU inválido.',
      {
        statusCode: 400,
        validationReport: report,
        errors: report.errors,
        checklist: formatChecklist(report)
      }
    );
    err.validationReport = report;
    throw err;
  }
  return report;
}

module.exports = {
  validate,
  buildReport,
  assertValid,
  logReport,
  formatChecklist,
  LIMITES
};
