/**
 * RC14.15.11 — Validação pós-gravação do TXITENS.TXT (antes do launch).
 * Não altera layout; apenas inspeciona o arquivo em disco.
 */

'use strict';

const fs = require('fs');
const { REGISTRO_LENGTH } = require('./MGV6Configuration');
const { MGV6Error, CODES } = require('./MGV6Errors');

const CRLF = '\r\n';

/**
 * @param {string} caminhoAbs
 * @param {{
 *   quantidadeEsperada?: number,
 *   plusEsperados?: Array<string|number>,
 *   registroLength?: number
 * }} [opcoes]
 * @returns {{
 *   ok: true,
 *   caminho: string,
 *   tamanhoBytes: number,
 *   registros: number,
 *   registroLength: number,
 *   plusExportados: string[],
 *   blocos9: string[]
 * }}
 */
function validarArquivoTxitensGerado(caminhoAbs, opcoes = {}) {
  const caminho = String(caminhoAbs || '').trim();
  const regLen = Number(opcoes.registroLength) > 0
    ? Number(opcoes.registroLength)
    : REGISTRO_LENGTH;
  const qtdEsperada = opcoes.quantidadeEsperada != null
    ? Number(opcoes.quantidadeEsperada)
    : null;

  if (!caminho) {
    throw MGV6Error.fromCode(CODES.FILE_INVALID, 'Caminho do TXITENS.TXT ausente', {
      statusCode: 500
    });
  }
  if (!fs.existsSync(caminho)) {
    throw MGV6Error.fromCode(
      CODES.FILE_INVALID,
      `TXITENS.TXT não encontrado após gravação: ${caminho}`,
      { statusCode: 500, caminho }
    );
  }

  const st = fs.statSync(caminho);
  if (!st.isFile() || st.size <= 0) {
    throw MGV6Error.fromCode(
      CODES.FILE_INVALID,
      'TXITENS.TXT inválido ou vazio após gravação',
      { statusCode: 500, caminho, tamanho: st.size }
    );
  }

  const buffer = fs.readFileSync(caminho);
  const text = buffer.toString('latin1');

  if (!text.includes(CRLF)) {
    throw MGV6Error.fromCode(
      CODES.FILE_INVALID,
      'TXITENS.TXT sem terminador CRLF',
      { statusCode: 500, caminho }
    );
  }

  const corpo = text.endsWith(CRLF) ? text.slice(0, -CRLF.length) : text;
  const registros = corpo.length ? corpo.split(CRLF) : [];

  if (!registros.length) {
    throw MGV6Error.fromCode(
      CODES.FILE_INVALID,
      'TXITENS.TXT sem registros',
      { statusCode: 500, caminho }
    );
  }

  if (qtdEsperada != null && Number.isFinite(qtdEsperada) && registros.length !== qtdEsperada) {
    throw MGV6Error.fromCode(
      CODES.FILE_INVALID,
      `TXITENS.TXT: esperado ${qtdEsperada} registro(s), encontrado ${registros.length}`,
      { statusCode: 500, caminho, esperado: qtdEsperada, encontrado: registros.length }
    );
  }

  const tamanhoEsperado = registros.length * (regLen + CRLF.length);
  if (buffer.length !== tamanhoEsperado) {
    throw MGV6Error.fromCode(
      CODES.FILE_INVALID,
      `TXITENS.TXT: tamanho ${buffer.length} ≠ esperado ${tamanhoEsperado} (${registros.length}×${regLen}+CRLF)`,
      { statusCode: 500, caminho, tamanho: buffer.length, esperado: tamanhoEsperado }
    );
  }

  const blocos9 = [];
  const plusExportados = [];
  for (let i = 0; i < registros.length; i += 1) {
    const reg = registros[i];
    if (reg.length !== regLen) {
      throw MGV6Error.fromCode(
        CODES.RECORD_SIZE_INVALID,
        `Registro ${i + 1} possui ${reg.length} caracteres (esperado ${regLen})`,
        { statusCode: 500, indice: i, tamanho: reg.length, limite: regLen }
      );
    }
    const bloco = reg.substring(2, 11);
    if (!/^\d{9}$/.test(bloco)) {
      throw MGV6Error.fromCode(
        CODES.FILE_INVALID,
        `Registro ${i + 1}: bloco PLU/código inválido (${bloco})`,
        { statusCode: 500, indice: i, bloco }
      );
    }
    blocos9.push(bloco);
    plusExportados.push(bloco.slice(-6));
  }

  const plusEsperados = Array.isArray(opcoes.plusEsperados) ? opcoes.plusEsperados : null;
  if (plusEsperados && plusEsperados.length) {
    for (let i = 0; i < plusEsperados.length; i += 1) {
      const esperado = String(plusEsperados[i]).replace(/\D/g, '');
      if (!esperado) continue;
      const cccccc = esperado.padStart(6, '0').slice(-6);
      const blocoEsp = esperado.padStart(9, '0');
      if (blocos9[i] !== blocoEsp && plusExportados[i] !== cccccc) {
        throw MGV6Error.fromCode(
          CODES.FILE_INVALID,
          `Registro ${i + 1}: PLU esperado ${cccccc}, encontrado ${plusExportados[i]}`,
          {
            statusCode: 500,
            indice: i,
            pluEsperado: cccccc,
            pluEncontrado: plusExportados[i]
          }
        );
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('[MGV6] ✔ TXITENS validado');

  return {
    ok: true,
    caminho,
    tamanhoBytes: buffer.length,
    registros: registros.length,
    registroLength: regLen,
    encoding: 'WINDOWS-1252',
    lineEnding: 'CRLF',
    plusExportados,
    blocos9
  };
}

module.exports = {
  validarArquivoTxitensGerado,
  CRLF
};
