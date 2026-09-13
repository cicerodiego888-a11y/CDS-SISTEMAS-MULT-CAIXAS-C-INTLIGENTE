/**
 * Sprint 14.15.1 / RC14.15.7 — Validador do Bridge MGV6.
 * Identidade operacional: PLU / código balança (EAN e codigo interno não entram).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { MGV6Error, CODES } = require('./MGV6Errors');
const { assertConfigShape, DEFAULTS, DESCRICAO_MAX_LEGADO } = require('./MGV6Configuration');
const identity = require('./MGV6IdentityResolver');

const EXTENSOES_ARQUIVO = new Set(['.txt', '.TXT', '.Txt']);

/**
 * Código do item no TX: PLU / codigo_balanca (ignora codigo_mgv6).
 * @param {object} produto
 * @returns {string}
 */
function resolverCodigoProduto(produto = {}) {
  return identity.extrairCodigoItemTx(produto);
}

/**
 * @param {string} codigoRaw
 * @param {object} config
 * @returns {{ ok: boolean, codigo?: string, erro?: string, code?: string }}
 */
function validarCodigo(codigoRaw, config = {}) {
  const maxDigitos = Number(config.codigoDigitos) || DEFAULTS.codigoDigitos;
  const check = identity.validarCodigoItem(codigoRaw);
  if (!check.ok) {
    return {
      ok: false,
      erro: check.erro,
      code: check.code
    };
  }
  if (check.codigo.length > maxDigitos) {
    return {
      ok: false,
      erro: `Código com ${check.codigo.length} dígitos excede o máximo de ${maxDigitos}`,
      code: CODES.CODE_OVERFLOW
    };
  }
  return { ok: true, codigo: check.codigo };
}

/**
 * Converte preço para centavos inteiros (sem arredondamento silencioso).
 * @param {*} preco
 * @param {object} config
 * @returns {{ ok: boolean, centavos?: number, erro?: string }}
 */
function validarPreco(preco, config = {}) {
  const maxCentavos = Number(config.precoCentavosMax) || DEFAULTS.precoCentavosMax;
  if (preco == null || preco === '') {
    return { ok: false, erro: 'Preço ausente' };
  }
  const n = typeof preco === 'number' ? preco : Number(String(preco).replace(',', '.'));
  if (!Number.isFinite(n)) {
    return { ok: false, erro: 'Preço não numérico' };
  }
  if (n < 0) {
    return { ok: false, erro: 'Preço não pode ser negativo' };
  }
  const centavosFloat = n * 100;
  const centavos = Math.round(centavosFloat);
  if (Math.abs(centavosFloat - centavos) > 1e-6) {
    return {
      ok: false,
      erro: `Preço ${n} não pode ser representado exatamente em centavos`
    };
  }
  if (centavos > maxCentavos) {
    return {
      ok: false,
      erro: `Preço em centavos (${centavos}) excede o máximo ${maxCentavos}`
    };
  }
  return { ok: true, centavos };
}

/**
 * Limpa descrição; truncamento legado ocorre no builder.
 * @param {*} descricao
 * @param {object} [_config]
 * @returns {{ ok: boolean, descricao?: string, erro?: string }}
 */
function validarDescricao(descricao, _config = {}) {
  let s = descricao == null ? '' : String(descricao);
  s = s.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '');
  s = s.trim();
  if (!s) {
    return { ok: false, erro: 'Descrição ausente' };
  }
  return { ok: true, descricao: s };
}

/**
 * Truncamento por caracteres compatível com o TX legado.
 * @param {string} descricao
 * @param {object} config
 * @returns {string}
 */
function truncarDescricaoLegado(descricao, config = {}) {
  const max = Number.isFinite(Number(config.descricaoMaxLength)) && Number(config.descricaoMaxLength) > 0
    ? Math.floor(Number(config.descricaoMaxLength))
    : DESCRICAO_MAX_LEGADO;
  const s = String(descricao ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max);
}

/**
 * @param {object} produto — com PLU / codigo_balanca
 * @param {object} config
 */
function validarProduto(produto, config) {
  const errors = [];
  const codigoCheck = validarCodigo(identity.extrairCodigoItemTx(produto), config);
  if (!codigoCheck.ok) {
    errors.push({
      campo: 'plu',
      motivo: codigoCheck.erro,
      code: codigoCheck.code || CODES.PRODUCT_PLU_REQUIRED
    });
  }

  const precoRaw = produto.preco != null ? produto.preco : produto.preco_venda;
  const precoCheck = validarPreco(precoRaw, config);
  if (!precoCheck.ok) errors.push({ campo: 'preco', motivo: precoCheck.erro });

  const descRaw = produto.descricao || produto.nome || produto.descricao_reduzida || '';
  const descCheck = validarDescricao(descRaw, config);
  if (!descCheck.ok) errors.push({ campo: 'descricao', motivo: descCheck.erro });

  if (errors.length) {
    return { ok: false, errors };
  }

  const descricaoFinal = truncarDescricaoLegado(descCheck.descricao, config);

  return {
    ok: true,
    errors: [],
    normalized: {
      produto_id: produto.id != null ? produto.id : produto.produto_id,
      codigo: codigoCheck.codigo,
      plu: codigoCheck.codigo,
      centavos: precoCheck.centavos,
      descricao: descricaoFinal,
      preco: precoCheck.centavos / 100
    }
  };
}

/**
 * @param {object} configRaw
 * @param {{ requireEnabled?: boolean, requireFolder?: boolean }} [opcoes]
 */
function validarConfiguracao(configRaw, opcoes = {}) {
  const cfg = assertConfigShape(configRaw);
  if (opcoes.requireEnabled && !cfg.enabled) {
    throw MGV6Error.fromCode(CODES.NOT_ENABLED, 'Compatibilidade MGV6 não está habilitada para este equipamento', {
      statusCode: 400
    });
  }
  if (opcoes.requireFolder) {
    validarPastaExportacao(cfg.exportFolder, { requireWritable: true });
    validarNomeArquivo(cfg.fileName);
  }
  return cfg;
}

/**
 * @param {string} fileName
 * @returns {string} basename seguro
 */
function validarNomeArquivo(fileName) {
  const raw = String(fileName || '').trim();
  if (!raw) {
    throw MGV6Error.fromCode(CODES.PATH_INVALID, 'Nome do arquivo vazio');
  }
  if (raw.includes('\0') || /[<>:"|?*]/.test(raw)) {
    throw MGV6Error.fromCode(CODES.PATH_INVALID, 'Nome do arquivo contém caracteres inválidos');
  }
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    throw MGV6Error.fromCode(CODES.PATH_TRAVERSAL, 'Nome do arquivo não pode conter path ou ..');
  }
  const base = path.basename(raw);
  if (base !== raw) {
    throw MGV6Error.fromCode(CODES.PATH_TRAVERSAL, 'Nome do arquivo inválido (path traversal)');
  }
  const ext = path.extname(base);
  if (!EXTENSOES_ARQUIVO.has(ext) && ext.toLowerCase() !== '.txt') {
    throw MGV6Error.fromCode(CODES.PATH_INVALID, 'Extensão do arquivo deve ser .TXT');
  }
  return base;
}

/**
 * @param {string} folder
 * @param {{ requireWritable?: boolean }} [opcoes]
 * @returns {string} path absoluto normalizado
 */
function validarPastaExportacao(folder, opcoes = {}) {
  const raw = String(folder || '').trim();
  if (!raw) {
    throw MGV6Error.fromCode(CODES.FOLDER_INVALID, 'Pasta de exportação não configurada');
  }
  if (raw.includes('\0')) {
    throw MGV6Error.fromCode(CODES.PATH_INVALID, 'Pasta contém caractere nulo');
  }
  const abs = path.resolve(raw);
  if (!path.isAbsolute(abs)) {
    throw MGV6Error.fromCode(CODES.PATH_INVALID, 'Pasta de exportação deve ser caminho absoluto');
  }
  if (!fs.existsSync(abs)) {
    throw MGV6Error.fromCode(CODES.FOLDER_INVALID, `Pasta de exportação não existe: ${abs}`);
  }
  const st = fs.statSync(abs);
  if (!st.isDirectory()) {
    throw MGV6Error.fromCode(CODES.FOLDER_INVALID, 'Caminho de exportação não é um diretório');
  }
  if (opcoes.requireWritable) {
    try {
      fs.accessSync(abs, fs.constants.W_OK);
    } catch (_) {
      throw MGV6Error.fromCode(CODES.WRITE_DENIED, `Sem permissão de escrita na pasta: ${abs}`);
    }
  }
  return abs;
}

/**
 * @param {string} exportFolderAbs
 * @param {string} fileName
 */
function resolverCaminhosExport(exportFolderAbs, fileName) {
  const safeName = validarNomeArquivo(fileName);
  const folder = validarPastaExportacao(exportFolderAbs, { requireWritable: true });
  const finalPath = path.resolve(folder, safeName);
  const rel = path.relative(folder, finalPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw MGV6Error.fromCode(CODES.PATH_TRAVERSAL, 'Path do arquivo sai da pasta de exportação');
  }
  const tempPath = `${finalPath}.tmp`;
  return { finalPath, tempPath, fileName: safeName, folder };
}

/**
 * @param {string} exePath
 */
function validarExecutavel(exePath) {
  const raw = String(exePath || '').trim();
  if (!raw) {
    throw MGV6Error.fromCode(CODES.LAUNCH_INVALID, 'Caminho do MGV6.exe não configurado');
  }
  if (raw.includes('\0') || raw.includes('"') || raw.includes('|') || raw.includes('&') || raw.includes(';')) {
    throw MGV6Error.fromCode(CODES.LAUNCH_INVALID, 'Caminho do executável contém caracteres perigosos');
  }
  const abs = path.resolve(raw);
  if (!path.isAbsolute(abs)) {
    throw MGV6Error.fromCode(CODES.LAUNCH_INVALID, 'Executável MGV6 deve ser caminho absoluto');
  }
  if (path.extname(abs).toLowerCase() !== '.exe') {
    throw MGV6Error.fromCode(CODES.LAUNCH_INVALID, 'Executável MGV6 deve ter extensão .exe');
  }
  if (!fs.existsSync(abs)) {
    throw MGV6Error.fromCode(CODES.LAUNCH_INVALID, `Executável não encontrado: ${abs}`);
  }
  const st = fs.statSync(abs);
  if (!st.isFile()) {
    throw MGV6Error.fromCode(CODES.LAUNCH_INVALID, 'Caminho do MGV6 não é um arquivo');
  }
  return abs;
}

module.exports = {
  resolverCodigoProduto,
  validarCodigo,
  validarPreco,
  validarDescricao,
  truncarDescricaoLegado,
  validarProduto,
  validarConfiguracao,
  validarNomeArquivo,
  validarPastaExportacao,
  resolverCaminhosExport,
  validarExecutavel,
  EXTENSOES_ARQUIVO
};
