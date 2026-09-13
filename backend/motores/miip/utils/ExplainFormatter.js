/**
 * ExplainFormatter — Formata MiipExplanation em diferentes modos.
 *
 * Sprint 12 — Camada de Explicabilidade.
 *
 * @module motores/miip/utils/ExplainFormatter
 */

const MODOS = Object.freeze({
  TECNICO: 'tecnico',
  USUARIO: 'usuario',
  AUDITORIA: 'auditoria'
});

/**
 * @param {import('../core/MiipExplanation')} explicacao
 * @param {string} [modo]
 * @returns {string}
 */
function formatar(explicacao, modo = MODOS.USUARIO) {
  if (!explicacao) return '';

  switch (modo) {
    case MODOS.TECNICO:
      return formatarTecnico(explicacao);
    case MODOS.AUDITORIA:
      return formatarAuditoria(explicacao);
    case MODOS.USUARIO:
    default:
      return formatarUsuario(explicacao);
  }
}

/**
 * @param {import('../core/MiipExplanation')} explicacao
 * @returns {string}
 */
function formatarUsuario(explicacao) {
  const linhas = [explicacao.titulo, ''];

  if (explicacao.motivosPositivos.length || explicacao.motivosNegativos.length) {
    linhas.push('Motivos:');
    explicacao.motivosPositivos.forEach((m) => linhas.push(`✔ ${m}`));
    explicacao.motivosNegativos.forEach((m) => linhas.push(`✖ ${m}`));
    linhas.push('');
  }

  if (explicacao.recomendacao) {
    linhas.push('Recomendação:');
    linhas.push(explicacao.recomendacao);
  }

  return linhas.join('\n').trim();
}

/**
 * @param {import('../core/MiipExplanation')} explicacao
 * @returns {string}
 */
function formatarTecnico(explicacao) {
  const linhas = [
    `[${explicacao.nivelCerteza ?? 'N/A'}] ${explicacao.titulo}`,
    `Resumo: ${explicacao.resumo}`,
    ''
  ];

  if (explicacao.atributosCoincidentes.length) {
    linhas.push(`Atributos coincidentes: ${explicacao.atributosCoincidentes.join(', ')}`);
  }

  if (explicacao.atributosDivergentes.length) {
    linhas.push(`Atributos divergentes: ${explicacao.atributosDivergentes.join(', ')}`);
  }

  if (explicacao.motivosPositivos.length) {
    linhas.push('');
    linhas.push('Motivos positivos:');
    explicacao.motivosPositivos.forEach((m) => linhas.push(`+ ${m}`));
  }

  if (explicacao.motivosNegativos.length) {
    linhas.push('Motivos negativos:');
    explicacao.motivosNegativos.forEach((m) => linhas.push(`- ${m}`));
  }

  if (explicacao.recomendacao) {
    linhas.push('');
    linhas.push(`Recomendação: ${explicacao.recomendacao}`);
  }

  return linhas.join('\n').trim();
}

/**
 * @param {import('../core/MiipExplanation')} explicacao
 * @returns {string}
 */
function formatarAuditoria(explicacao) {
  return JSON.stringify({
    titulo: explicacao.titulo,
    resumo: explicacao.resumo,
    nivelCerteza: explicacao.nivelCerteza,
    motivosPositivos: explicacao.motivosPositivos,
    motivosNegativos: explicacao.motivosNegativos,
    atributosCoincidentes: explicacao.atributosCoincidentes,
    atributosDivergentes: explicacao.atributosDivergentes,
    recomendacao: explicacao.recomendacao,
    explicacaoCurta: explicacao.explicacaoCurta,
    explicacaoCompleta: explicacao.explicacaoCompleta
  }, null, 2);
}

/**
 * @param {string} valor
 * @returns {boolean}
 */
function isModoValido(valor) {
  return typeof valor === 'string' && Object.values(MODOS).includes(valor);
}

module.exports = {
  MODOS,
  formatar,
  formatarUsuario,
  formatarTecnico,
  formatarAuditoria,
  isModoValido
};
