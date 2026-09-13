/**
 * Normalização e validação do layout de etiqueta configurável.
 */

const { obterPreset } = require('./presetsEtiqueta');

function toInt(valor, fallback) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toBool(valor, fallback = true) {
  if (valor === undefined || valor === null || valor === '') return fallback;
  if (typeof valor === 'boolean') return valor;
  const s = String(valor).toLowerCase();
  if (s === '1' || s === 'true' || s === 'sim' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'nao' || s === 'não' || s === 'no') return false;
  return fallback;
}

/**
 * @param {Object} bruto
 * @returns {{ ok: true, layout: Object }|{ ok: false, erro: string }}
 */
function normalizarLayoutEtiqueta(bruto = {}) {
  const fonte = bruto && typeof bruto === 'object' ? { ...bruto } : {};

  if (fonte.preset_id && (!fonte.digitos_plu || !fonte.prefixo)) {
    const preset = obterPreset(fonte.preset_id);
    if (preset) Object.assign(fonte, preset, fonte);
  }

  const prefixo = String(fonte.prefixo != null ? fonte.prefixo : '2').replace(/\D/g, '');
  if (!prefixo) {
    return { ok: false, erro: 'Prefixo é obrigatório.' };
  }

  const digitosPlu = toInt(fonte.digitos_plu, 0);
  const digitosVariavel = toInt(fonte.digitos_variavel, 0);
  const tamanhoTotal = toInt(fonte.tamanho_total, 13);
  const digitoVerificador = toBool(fonte.digito_verificador, true);
  const tipoVariavel = String(fonte.tipo_variavel || 'VALOR').toUpperCase() === 'PESO'
    ? 'PESO'
    : 'VALOR';

  if (digitosPlu < 1 || digitosPlu > 10) {
    return { ok: false, erro: 'Quantidade de dígitos do PLU inválida.' };
  }
  if (digitosVariavel < 1 || digitosVariavel > 10) {
    return { ok: false, erro: 'Quantidade de dígitos da informação variável inválida.' };
  }
  if (tamanhoTotal < 8 || tamanhoTotal > 18) {
    return { ok: false, erro: 'Tamanho total do código inválido.' };
  }

  let posicaoInicial = toInt(fonte.posicao_inicial, 0);
  let posicaoFinal = toInt(fonte.posicao_final, 0);

  if (!posicaoInicial || !posicaoFinal) {
    posicaoInicial = prefixo.length + digitosPlu + 1;
    posicaoFinal = posicaoInicial + digitosVariavel - 1;
  }

  if (posicaoInicial < 1 || posicaoFinal < posicaoInicial) {
    return { ok: false, erro: 'Posição inicial/final da informação variável inválida.' };
  }

  const expectedVarDigits = posicaoFinal - posicaoInicial + 1;
  if (expectedVarDigits !== digitosVariavel) {
    return {
      ok: false,
      erro: `Dígitos da variável (${digitosVariavel}) não batem com posições ${posicaoInicial}–${posicaoFinal}.`
    };
  }

  const dvLen = digitoVerificador ? 1 : 0;
  const expectedTotal = prefixo.length + digitosPlu + digitosVariavel + dvLen;
  if (expectedTotal !== tamanhoTotal) {
    return {
      ok: false,
      erro: `Tamanho total (${tamanhoTotal}) diverge do layout (prefixo+PLU+variável+DV = ${expectedTotal}).`
    };
  }

  if (posicaoFinal + dvLen !== tamanhoTotal) {
    return {
      ok: false,
      erro: 'Posição final da variável deve terminar imediatamente antes do dígito verificador (ou no fim do código).'
    };
  }

  return {
    ok: true,
    layout: {
      preset_id: fonte.preset_id ? String(fonte.preset_id) : 'outro',
      prefixo,
      digitos_plu: digitosPlu,
      tipo_variavel: tipoVariavel,
      posicao_inicial: posicaoInicial,
      posicao_final: posicaoFinal,
      digitos_variavel: digitosVariavel,
      tamanho_total: tamanhoTotal,
      digito_verificador: digitoVerificador
    }
  };
}

module.exports = {
  normalizarLayoutEtiqueta,
  toBool,
  toInt
};
