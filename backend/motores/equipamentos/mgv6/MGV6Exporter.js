/**
 * Sprint 14.15.1 — MGV6Exporter
 * Grava TXT via arquivo temporário + rename atômico.
 * Não executa MGV6.
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { normalizar } = require('./MGV6Configuration');
const { buildProdutos } = require('./MGV6FileBuilder');
const {
  validarConfiguracao,
  resolverCaminhosExport
} = require('./MGV6Validator');
const { MGV6Error, CODES } = require('./MGV6Errors');

/**
 * @param {Buffer} buffer
 * @param {string} tempPath
 * @param {string} finalPath
 */
function escreverAtomico(buffer, tempPath, finalPath) {
  if (!Buffer.isBuffer(buffer)) {
    throw MGV6Error.fromCode(CODES.EXPORT_FAILED, 'Conteúdo de exportação deve ser Buffer');
  }
  try {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    fs.writeFileSync(tempPath, buffer);
    // validação básica do temp
    const st = fs.statSync(tempPath);
    if (!st.isFile() || st.size !== buffer.length) {
      throw MGV6Error.fromCode(CODES.EXPORT_FAILED, 'Arquivo temporário inválido após gravação');
    }
    const lido = fs.readFileSync(tempPath);
    if (!lido.equals(buffer)) {
      throw MGV6Error.fromCode(CODES.EXPORT_FAILED, 'Conteúdo do arquivo temporário diverge do buffer');
    }
    // eslint-disable-next-line no-console
    console.log('[MGV6] Arquivo validado');

    if (fs.existsSync(finalPath)) {
      fs.unlinkSync(finalPath);
    }
    fs.renameSync(tempPath, finalPath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) { /* ignore */ }
    if (err instanceof MGV6Error) throw err;
    throw MGV6Error.fromCode(CODES.EXPORT_FAILED, err.message || 'Falha na exportação atômica', {
      statusCode: 500,
      cause: err.message
    });
  }
}

/**
 * @param {Array<object>} lista
 * @param {object} configuracao
 * @returns {Promise<object>}
 */
async function exportarProdutos(lista, configuracao) {
  // eslint-disable-next-line no-console
  console.log('[MGV6] Exportação iniciada');
  const items = Array.isArray(lista) ? lista : [];
  // eslint-disable-next-line no-console
  console.log(`[MGV6] Produtos selecionados: ${items.length}`);

  const cfg = validarConfiguracao(normalizar(configuracao), {
    requireFolder: true
  });

  const built = buildProdutos(items, cfg);
  // eslint-disable-next-line no-console
  console.log('[MGV6] Arquivo gerado');
  // eslint-disable-next-line no-console
  console.log(`[MGV6] Registros: ${built.quantidade} | Tamanho do registro: ${built.registroLength} | Layout: ${built.layout || 'MGV6-REAL-CLIENT-V1'}`);

  const paths = resolverCaminhosExport(cfg.exportFolder, cfg.fileName);
  escreverAtomico(built.buffer, paths.tempPath, paths.finalPath);
  // eslint-disable-next-line no-console
  console.log('[MGV6] Arquivo exportado');

  const hash = crypto.createHash('sha256').update(built.buffer).digest('hex');
  return {
    sucesso: true,
    arquivo: paths.fileName,
    pasta: paths.folder,
    caminho: paths.finalPath,
    quantidade: items.length,
    registros_count: built.quantidade,
    registroLength: built.registroLength,
    layout: built.layout || 'MGV6-REAL-CLIENT-V1',
    tamanho_bytes: built.buffer.length,
    hash_arquivo: hash,
    encoding: built.encoding,
    lineEnding: built.lineEnding,
    status: 'EXPORTADO',
    buffer: built.buffer,
    registros: built.registros,
    codigosMgv6: built.codigosMgv6 || []
  };
}

module.exports = {
  exportarProdutos,
  escreverAtomico
};
