/**
 * RC3.16.11 — TRACE temporário do fluxo real de emissão NF-e.
 * Somente rastreamento: NÃO altera regras / builder / assinatura / SOAP.
 *
 * Grava em DUAS pastas (Electron usa FISCAL_DIR em ProgramData;
 * a RC3.16.10 grava no root do código-fonte):
 *   - logs/nfe/trace/fluxo.log          (projeto)
 *   - {FISCAL_DIR}/debug/nfe-trace/     (runtime Electron)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getFiscalSubDir } = require('./paths');

function getProjectRoot() {
  return path.resolve(__dirname, '../../..');
}

function garantirDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function caminhosTrace() {
  const projeto = garantirDir(path.join(getProjectRoot(), 'logs', 'nfe', 'trace'));
  let fiscal = null;
  try {
    fiscal = getFiscalSubDir('debug/nfe-trace');
  } catch (_) { /* ignore */ }
  return {
    projetoLog: path.join(projeto, 'fluxo.log'),
    fiscalLog: fiscal ? path.join(fiscal, 'fluxo.log') : null,
    projetoDir: projeto,
    fiscalDir: fiscal
  };
}

/**
 * @param {string} metodo
 * @param {object} [dados]
 */
function traceNfe(metodo, dados = {}) {
  const payload = {
    ts: new Date().toISOString(),
    metodo: String(metodo || ''),
    pid: process.pid,
    cwd: process.cwd(),
    __dirname_fiscal: __dirname,
    FISCAL_DIR: process.env.FISCAL_DIR || null,
    ...Object.fromEntries(
      Object.entries(dados || {}).filter(([, v]) => v !== undefined)
    )
  };

  const linha = `[TRACE][NFE] ${JSON.stringify(payload)}`;
  console.log(linha);

  const { projetoLog, fiscalLog } = caminhosTrace();
  const bloco = `${linha}\n`;
  try {
    fs.appendFileSync(projetoLog, bloco, 'utf8');
  } catch (err) {
    console.error('[TRACE][NFE] falha projeto:', err.message);
  }
  if (fiscalLog) {
    try {
      fs.appendFileSync(fiscalLog, bloco, 'utf8');
    } catch (err) {
      console.error('[TRACE][NFE] falha FISCAL_DIR:', err.message);
    }
  }
}

module.exports = { traceNfe, caminhosTrace };
