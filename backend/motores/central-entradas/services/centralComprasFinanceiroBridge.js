'use strict';

/**
 * RC4.31.14 — verifica se payload financeiro persistido está completo.
 * Early return no bridge só quando todos os campos exigidos existem.
 *
 * @param {Object} payload
 * @returns {boolean}
 */
function financeiroPayloadCompleto(payload = {}) {
  if (!payload.forma_pagamento) return false;
  if (!payload.condicao_pagamento) return false;

  const pagamentos = Array.isArray(payload.pagamentos) ? payload.pagamentos : [];
  const grade = Array.isArray(payload.parcelas_detalhe) ? payload.parcelas_detalhe : [];
  const duplicatas = Array.isArray(payload.duplicatas) ? payload.duplicatas : [];
  const condicao = String(payload.condicao_pagamento || '').toLowerCase();
  const exigeGrade = condicao === 'prazo' || grade.length > 0 || duplicatas.length > 0;

  if (exigeGrade) {
    if (!grade.length) return false;
    const gradeComVencimento = grade.every(
      (p) => String(p?.vencimento || p?.dVenc || '').trim().length >= 10
    );
    if (!gradeComVencimento) return false;
  }

  if (condicao !== 'avista' && pagamentos.length === 0 && !payload.forma_pagamento) {
    return false;
  }

  return true;
}

module.exports = {
  financeiroPayloadCompleto
};
