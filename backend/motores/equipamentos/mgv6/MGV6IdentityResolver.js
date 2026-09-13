/**
 * RC14.15.9 — Resolução operacional MGV6 / TXITENS.
 *
 * Regra oficial (única):
 *   PLU CDS = CÓDIGO DO ITEM DA BALANÇA / MGV6 (CCCCCC)
 *
 * Fonte: produto_identificadores.tipo = 'PLU' / produto.plu
 *         (+ codigo_balanca se existir — mesmo conceito, não é "Código MGV6")
 *
 * NÃO usa:
 *   - codigo_mgv6 / tipo=MGV6 (dados podem existir no banco; ignorados na exportação)
 *   - EAN / GTIN / codigo_barras
 *   - código interno
 *
 * "Integrar com Balança":
 *   - integrar_balanca = 0 → excluído
 *   - integrar_balanca = 1 → exige PLU
 *   - ausente + produto_fracionado=1 → elegível (retrocompat CDS)
 */

'use strict';

const { MGV6Error, CODES } = require('./MGV6Errors');
const { DEFAULTS } = require('./MGV6Configuration');

/** @deprecated RC14.15.5 — dados históricos podem existir; não usados na exportação */
const TIPO_MGV6 = 'MGV6';

/**
 * Bloco posicional TT+Z+CCCCCC (9 chars). Não é entidade "código MGV6".
 */
const CODIGO_DIGITOS = DEFAULTS.codigoDigitos || 9;

/**
 * @param {object} produto
 * @returns {boolean}
 */
function produtoIntegraBalanca(produto = {}) {
  const raw = produto.integrar_balanca != null
    ? produto.integrar_balanca
    : produto.integrarBalanca;
  if (raw === false || raw === 0 || raw === '0') return false;
  if (raw === true || raw === 1 || raw === '1') return true;
  if (Number(produto.produto_fracionado ?? produto.vendido_por_peso ?? produto.produto_pesavel ?? 0) === 1) {
    return true;
  }
  return Boolean(extrairPluBalanca(produto));
}

/**
 * PLU / código do item da balança.
 * Ignora codigo_mgv6, EAN e código interno.
 * @param {object} produto
 * @returns {string}
 */
function extrairPluBalanca(produto = {}) {
  const candidatos = [
    produto.plu,
    produto.codigo_balanca,
    produto.codigoBalanca
  ];
  for (const c of candidatos) {
    if (c == null || String(c).trim() === '') continue;
    const digits = String(c).trim().replace(/\D/g, '');
    if (digits) return digits;
  }
  return '';
}

/**
 * Código do item no TX = apenas PLU.
 * @param {object} produto
 * @returns {string}
 */
function extrairCodigoItemTx(produto = {}) {
  return extrairPluBalanca(produto) || '';
}

/** @deprecated — não usa codigo_mgv6; alias de extrairCodigoItemTx */
function extrairCodigoMgv6Bruto(produto = {}) {
  return extrairCodigoItemTx(produto);
}

/** @deprecated — sempre vazio na resolução operacional (RC14.15.9) */
function extrairCodigoMgv6Legado() {
  return '';
}

/**
 * @param {object} produto
 */
function diagnosticoProduto(produto = {}) {
  return {
    produtoId: produto.id != null ? produto.id : produto.produto_id ?? null,
    codigo: produto.codigo != null ? String(produto.codigo) : null,
    plu: produto.plu != null ? String(produto.plu) : null,
    codigo_balanca: produto.codigo_balanca != null
      ? String(produto.codigo_balanca)
      : (produto.codigoBalanca != null ? String(produto.codigoBalanca) : null),
    codigo_barras: produto.codigo_barras != null
      ? String(produto.codigo_barras)
      : (produto.codigoBarras != null ? String(produto.codigoBarras) : null),
    integrar_balanca: produtoIntegraBalanca(produto),
    nome: produto.nome || produto.descricao || null
  };
}

/**
 * @param {string|number} bruto
 */
function validarCodigoItem(bruto) {
  const raw = String(bruto ?? '').trim();
  if (!raw) {
    return { ok: false, code: CODES.PRODUCT_PLU_REQUIRED, erro: 'PLU / código do item da balança ausente' };
  }
  if (!/^\d+$/.test(raw)) {
    return {
      ok: false,
      code: CODES.CODE_INVALID,
      erro: 'PLU / código do item da balança deve conter apenas dígitos'
    };
  }
  if (raw.length > CODIGO_DIGITOS) {
    return {
      ok: false,
      code: CODES.CODE_OVERFLOW,
      erro: `Código com ${raw.length} dígitos excede o máximo de ${CODIGO_DIGITOS} no bloco TX`
    };
  }
  return { ok: true, codigo: raw };
}

/** @deprecated alias */
function validarCodigoMgv6(bruto) {
  return validarCodigoItem(bruto);
}

/**
 * @param {string|number} codigoDigitos
 * @returns {string}
 */
function formatarCodigoItem9(codigoDigitos) {
  const check = validarCodigoItem(codigoDigitos);
  if (!check.ok) {
    throw MGV6Error.fromCode(check.code, check.erro, {
      statusCode: 400,
      codigo: String(codigoDigitos ?? ''),
      limite: CODIGO_DIGITOS
    });
  }
  return check.codigo.padStart(CODIGO_DIGITOS, '0');
}

/** @deprecated alias */
function formatarCodigoMgv69(codigoDigitos) {
  return formatarCodigoItem9(codigoDigitos);
}

/**
 * Resolve identidade operacional para TXITENS — somente PLU.
 * @param {object} produto
 */
function resolverIdentidade(produto = {}) {
  const diag = diagnosticoProduto(produto);
  const nome = diag.nome || 'sem nome';

  if (!produtoIntegraBalanca(produto)) {
    throw MGV6Error.fromCode(
      CODES.PRODUCT_NOT_INTEGRATED,
      `Produto "${nome}" não está marcado para Integrar com Balança.`,
      { statusCode: 400, ...diag }
    );
  }

  const plu = extrairPluBalanca(produto);
  if (!plu) {
    throw MGV6Error.fromCode(
      CODES.PRODUCT_PLU_REQUIRED,
      `Produto "${nome}" marcado para balança, mas sem PLU (código do item da balança) configurado.`,
      { statusCode: 400, ...diag }
    );
  }

  const check = validarCodigoItem(plu);
  if (!check.ok) {
    throw MGV6Error.fromCode(check.code, check.erro, {
      statusCode: 400,
      ...diag,
      codigoTentativa: plu,
      limite: CODIGO_DIGITOS
    });
  }

  const codigo9 = check.codigo.padStart(CODIGO_DIGITOS, '0');
  const cccccc = check.codigo.padStart(6, '0').slice(-6);

  return {
    plu: check.codigo,
    codigoItem: check.codigo,
    /** @deprecated alias do código do item (PLU) — não é campo UI Código MGV6 */
    codigoMgv6: check.codigo,
    codigoMgv69: codigo9,
    codigoItem9: codigo9,
    cccccc,
    origem: 'PLU',
    produtoId: diag.produtoId,
    diagnostico: diag
  };
}

/**
 * @param {object} produto
 * @returns {object}
 */
function comIdentidadeResolvida(produto = {}) {
  const id = resolverIdentidade(produto);
  return {
    ...produto,
    plu: id.plu,
    codigo_item_tx: id.codigoItem,
    codigoItem: id.codigoItem,
    codigoItem9: id.codigoItem9,
    cccccc: id.cccccc,
    identidadeOrigem: id.origem
  };
}

/**
 * @param {object[]} produtos
 */
function resolverLista(produtos = []) {
  const resolvidos = [];
  const pendentes = [];
  const excluidos = [];
  for (const p of Array.isArray(produtos) ? produtos : []) {
    if (!produtoIntegraBalanca(p)) {
      excluidos.push({ produto: p, details: diagnosticoProduto(p) });
      continue;
    }
    try {
      resolvidos.push(comIdentidadeResolvida(p));
    } catch (err) {
      if (err && (err.code === CODES.PRODUCT_PLU_REQUIRED || err.code === CODES.PRODUCT_NOT_INTEGRATED)) {
        pendentes.push({
          produto: p,
          details: err.details || diagnosticoProduto(p),
          message: err.message,
          code: err.code
        });
      } else {
        throw err;
      }
    }
  }
  return { resolvidos, pendentes, excluidos };
}

module.exports = {
  TIPO_MGV6,
  CODIGO_DIGITOS,
  produtoIntegraBalanca,
  extrairPluBalanca,
  extrairCodigoMgv6Legado,
  extrairCodigoItemTx,
  extrairCodigoMgv6Bruto,
  diagnosticoProduto,
  validarCodigoItem,
  validarCodigoMgv6,
  formatarCodigoItem9,
  formatarCodigoMgv69,
  resolverIdentidade,
  comIdentidadeResolvida,
  resolverLista
};
