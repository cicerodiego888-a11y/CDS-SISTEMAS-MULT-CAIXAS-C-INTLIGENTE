/**
 * Sprint 14.15.1 / RC14.15.4 / RC14.15.7 — MGV6FileBuilder
 * Monta registro TXITENS a partir de PLU/código item já resolvido.
 *
 * Layout TXITENS conhecido (indústria / amostras cliente) — RC14.15.7:
 *   DD(2) TT(2) Z(1) CCCCCC(6) PPPPPP(6) VVV(3) D1(≤50) + padding → 320
 *
 * Representação no builder (byte-compatível, semântica documentada):
 * pos 0–1:   DD departamento (default "01")
 * pos 2–10:  TT+Z+CCCCCC (9) — PLU/código item zero-pad (NÃO é EAN)
 * pos 11–19: PPPPPP+VVV (9) — preço em centavos + validade (VVV=000 nas amostras)
 * pos 20–319: D1 descrição (máx. 50 chars) + espaços
 *
 * Código interno CDS ≠ PLU ≠ EAN ≠ CCCCCC.
 * Cada registro = exatamente 320 caracteres. CRLF NÃO conta nos 320.
 */

'use strict';

const {
  normalizar,
  resolverLineEnding,
  REGISTRO_LENGTH,
  DESCRICAO_AREA_LENGTH,
  DESCRICAO_MAX_LEGADO,
  LAYOUT_ID
} = require('./MGV6Configuration');
const { encodeText } = require('./MGV6Encoding');
const {
  validarProduto,
  truncarDescricaoLegado
} = require('./MGV6Validator');
const identity = require('./MGV6IdentityResolver');
const { MGV6Error, CODES } = require('./MGV6Errors');

/**
 * RC14.15.5 — campo numérico posições 11–19 (exatamente 9 caracteres).
 * @param {number|string} valorNormalizado
 * @returns {string}
 */
function formatarCampoNumericoMgv6(valorNormalizado) {
  if (typeof valorNormalizado === 'number') {
    const c = valorNormalizado;
    if (!Number.isInteger(c) || c < 0 || c > 99999) {
      throw MGV6Error.fromCode(
        CODES.PRICE_INVALID,
        `Campo numérico MGV6 inválido (centavos): ${valorNormalizado}`,
        { statusCode: 400, valor: valorNormalizado }
      );
    }
    return `0${String(c).padStart(5, '0')}000`;
  }

  const raw = String(valorNormalizado ?? '').trim();
  if (!/^\d+$/.test(raw)) {
    throw MGV6Error.fromCode(
      CODES.PRICE_INVALID,
      'Campo numérico MGV6 deve conter apenas dígitos',
      { statusCode: 400, valor: raw }
    );
  }
  if (raw.length > 9) {
    throw MGV6Error.fromCode(
      CODES.PRICE_INVALID,
      `Campo numérico MGV6 com ${raw.length} dígitos excede 9 (rejeitado, sem truncar)`,
      { statusCode: 400, valor: raw, tamanho: raw.length, limite: 9 }
    );
  }
  return raw.padStart(9, '0');
}

/**
 * @deprecated alias — preferir formatarCampoNumericoMgv6
 */
function formatarBlocoPreco(centavos) {
  return formatarCampoNumericoMgv6(centavos);
}

/**
 * Bloco posicional TT+Z+CCCCCC (9 chars). Não é entidade "código MGV6".
 * @param {string} codigoDigitos — PLU / código do item
 * @returns {string}
 */
function formatarCodigo9(codigoDigitos) {
  try {
    return identity.formatarCodigoMgv69(codigoDigitos);
  } catch (err) {
    if (err && err.code === CODES.CODE_OVERFLOW) throw err;
    if (err && err.code === CODES.CODE_INVALID) throw err;
    throw err;
  }
}

/**
 * Área de descrição: trunca ao máximo legado, depois limita à área 300.
 * Truncamento por caracteres (compatível com WINDOWS-1252).
 * @param {string} descricao
 * @param {{ produto_id?: *, codigo?: string, config?: object }} [meta]
 * @returns {string}
 */
function formatarDescricaoArea(descricao, meta = {}) {
  const truncada = truncarDescricaoLegado(descricao, meta.config || {});
  if (truncada.length > DESCRICAO_AREA_LENGTH) {
    throw MGV6Error.fromCode(
      CODES.DESCRIPTION_OVERFLOW,
      `Descrição MGV6 excede ${DESCRICAO_AREA_LENGTH} caracteres disponíveis (posições 20–319).`,
      {
        statusCode: 400,
        produto: meta.produto_id != null ? meta.produto_id : null,
        codigo: meta.codigo != null ? String(meta.codigo) : null,
        tamanho: truncada.length,
        limite: DESCRICAO_AREA_LENGTH
      }
    );
  }
  return truncada;
}

/**
 * Aceita produto com PLU / codigo_balanca (código do item).
 * Ignora codigo_mgv6 (RC14.15.9).
 * @param {object} produto
 * @param {object} configuracao
 */
function buildConteudoLogico(produto, configuracao) {
  const config = normalizar(configuracao);
  let produtoComId = produto;
  if (!identity.extrairCodigoItemTx(produto)) {
    identity.resolverIdentidade(produto); // lança PLU_REQUIRED / NOT_INTEGRATED
  } else if (!produto.codigoItem9) {
    produtoComId = identity.comIdentidadeResolvida(produto);
  }

  const check = validarProduto(produtoComId, config);
  if (!check.ok) {
    const first = check.errors[0];
    const code = first?.code || CODES.PRODUTO_INVALID;
    if (
      code === CODES.PRODUCT_PLU_REQUIRED
      || code === CODES.PRODUCT_NOT_INTEGRATED
      || code === CODES.PRODUCT_IDENTITY_REQUIRED
      || code === CODES.CODE_OVERFLOW
    ) {
      const nome = produto?.nome || produto?.descricao || 'sem nome';
      throw MGV6Error.fromCode(
        code,
        first.motivo || `Produto "${nome}" inválido para MGV6`,
        {
          statusCode: 400,
          errors: check.errors,
          ...identity.diagnosticoProduto(produto)
        }
      );
    }
    const motivos = check.errors.map((e) => `${e.campo}: ${e.motivo}`).join('; ');
    throw MGV6Error.fromCode(CODES.PRODUTO_INVALID, motivos || 'Produto inválido para MGV6', {
      statusCode: 400,
      errors: check.errors,
      produto_id: produto?.id ?? produto?.produto_id ?? null,
      codigoTentativa: identity.extrairCodigoItemTx(produto)
    });
  }

  const { codigo, centavos, descricao } = check.normalized;
  const produtoId = check.normalized.produto_id;
  const tipo = String(config.tipoRegistro || '01');
  if (!/^\d{2}$/.test(tipo)) {
    throw MGV6Error.fromCode(CODES.CONFIG_INVALID, 'tipoRegistro deve ter 2 dígitos');
  }

  const codigo9 = formatarCodigo9(codigo);
  const campoNum = formatarCampoNumericoMgv6(centavos);
  const desc = formatarDescricaoArea(descricao, {
    produto_id: produtoId,
    codigo,
    config
  });
  const conteudo = `${tipo}${codigo9}${campoNum}${desc}`;

  return {
    conteudo,
    codigo: codigo9,
    codigoItem: codigo,
    /** @deprecated alias de codigoItem */
    codigoMgv6: codigo,
    campoNumerico: campoNum,
    centavos,
    descricao: desc,
    produto_id: produtoId,
    tipo
  };
}

/**
 * Completa até exatamente REGISTRO_LENGTH com espaços (nunca zeros).
 */
function padRegistro(conteudo, meta = {}) {
  const limite = Number.isFinite(meta.limite) ? Number(meta.limite) : REGISTRO_LENGTH;
  const raw = String(conteudo ?? '');
  if (raw.length > limite) {
    throw MGV6Error.fromCode(
      CODES.RECORD_OVERFLOW,
      'Registro MGV6 excede 320 caracteres.',
      {
        statusCode: 400,
        produto: meta.produto_id != null ? meta.produto_id : null,
        codigo: meta.codigo != null ? String(meta.codigo) : null,
        tamanho: raw.length,
        limite
      }
    );
  }
  return raw.padEnd(limite, ' ');
}

/**
 * @param {object} produto — preferir { plu, preco, descricao/nome }
 * @param {object} configuracao
 * @returns {string} registro sem terminador, length === 320
 */
function buildRecord(produto, configuracao) {
  const input = produto && typeof produto === 'object'
    ? {
        ...produto,
        plu: produto.plu != null && String(produto.plu).trim() !== ''
          ? produto.plu
          : (produto.codigo_balanca || produto.codigoBalanca || null),
        preco: produto.preco != null ? produto.preco : produto.preco_venda,
        descricao: produto.descricao || produto.nome
      }
    : produto;

  const logico = buildConteudoLogico(input, configuracao);
  const registro = padRegistro(logico.conteudo, {
    produto_id: logico.produto_id ?? input?.id ?? input?.produto_id ?? null,
    codigo: logico.codigo
  });
  if (registro.length !== REGISTRO_LENGTH) {
    throw MGV6Error.fromCode(
      CODES.RECORD_SIZE_INVALID,
      `Registro MGV6 inválido: esperado ${REGISTRO_LENGTH}, obtido ${registro.length}`,
      {
        statusCode: 500,
        produto: logico.produto_id,
        codigo: logico.codigo,
        tamanho: registro.length,
        limite: REGISTRO_LENGTH
      }
    );
  }
  return registro;
}

function buildProduto(produto, configuracao) {
  return buildRecord(produto, configuracao);
}

/**
 * @param {Array<object>} lista — produtos com identidade MGV6
 * @param {object} configuracao
 */
function buildProdutos(lista, configuracao) {
  const config = normalizar(configuracao);
  const items = Array.isArray(lista) ? lista : [];
  if (!items.length) {
    throw MGV6Error.fromCode(CODES.EMPTY_LIST, 'Lista de produtos vazia', { statusCode: 400 });
  }

  const registros = [];
  const codigosItem = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const logico = buildConteudoLogico(item, config);
    const reg = padRegistro(logico.conteudo, {
      produto_id: logico.produto_id,
      codigo: logico.codigo
    });
    // eslint-disable-next-line no-console
    console.log(
      `[MGV6] Produto ${item?.id ?? item?.nome ?? i + 1} | PLU (código do item): ${logico.codigoItem} | bloco TX: ${logico.codigo}`
    );
    registros.push(reg);
    codigosItem.push(logico.codigoItem);
  }

  for (let i = 0; i < registros.length; i += 1) {
    if (registros[i].length !== REGISTRO_LENGTH) {
      throw MGV6Error.fromCode(
        CODES.RECORD_SIZE_INVALID,
        `Registro ${i + 1} não possui ${REGISTRO_LENGTH} caracteres`,
        { statusCode: 500, indice: i, tamanho: registros[i].length, limite: REGISTRO_LENGTH }
      );
    }
  }

  const eol = resolverLineEnding(config);
  const texto = registros.map((r) => `${r}${eol}`).join('');
  const buffer = encodeText(texto, config.encoding);
  return {
    registros,
    texto,
    buffer,
    encoding: config.encoding,
    lineEnding: config.lineEnding,
    registroLength: REGISTRO_LENGTH,
    quantidade: registros.length,
    arquivo: config.fileName,
    layout: LAYOUT_ID,
    codigosItem,
    /** @deprecated alias de codigosItem */
    codigosMgv6: codigosItem,
    descricaoMaxLegado: DESCRICAO_MAX_LEGADO
  };
}

module.exports = {
  REGISTRO_LENGTH,
  DESCRICAO_AREA_LENGTH,
  DESCRICAO_MAX_LEGADO,
  LAYOUT_ID,
  buildConteudoLogico,
  padRegistro,
  buildRecord,
  buildProduto,
  buildProdutos,
  formatarCampoNumericoMgv6,
  formatarBlocoPreco,
  formatarCodigo9,
  formatarDescricaoArea
};
