/**
 * Sprint 14.15.1 / RC14.15.17 / RC14.15.19 — MGV6Launcher
 * Abre MGV6.exe via Electron shell.openPath (ShellExecute).
 * NÃO usa CreateProcess/spawn como launcher primário (EACCES/UAC).
 */

'use strict';

const path = require('path');
const { normalizar } = require('./MGV6Configuration');
const { validarExecutavel } = require('./MGV6Validator');
const { MGV6Error, CODES } = require('./MGV6Errors');

const METODO_SHELL = 'shell-execute';

/**
 * Resolve a função openPath (Electron shell ou injeção de teste).
 * @param {{ openPath?: Function }} opcoes
 * @returns {Promise<(caminho: string) => Promise<string>>}
 */
async function obterOpenPathFn(opcoes = {}) {
  if (typeof opcoes.openPath === 'function') {
    return opcoes.openPath;
  }
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const electron = require('electron');
    if (electron && electron.shell && typeof electron.shell.openPath === 'function') {
      return (caminho) => electron.shell.openPath(caminho);
    }
  } catch (_) {
    /* fora do Electron */
  }
  throw MGV6Error.fromCode(
    CODES.LAUNCH_FAILED,
    'ShellExecute indisponível: CDS deve abrir o MGV6 pelo Electron (shell.openPath)',
    { statusCode: 500, code: 'NO_SHELL_EXECUTE' }
  );
}

/**
 * @param {object} configuracao
 * @param {{ openPath?: Function }} [opcoes]
 * @returns {Promise<object>}
 */
async function launch(configuracao, opcoes = {}) {
  const cfg = normalizar(configuracao);

  if (!cfg.autoLaunch) {
    // eslint-disable-next-line no-console
    console.log('[MGV6] MGV6 não iniciado (autoLaunch=false)');
    return {
      iniciado: false,
      sucesso: false,
      motivo: 'autoLaunch=false',
      pid: null,
      path: null,
      metodo: null,
      timestamp: new Date().toISOString()
    };
  }

  let exeAbs;
  try {
    exeAbs = validarExecutavel(cfg.mgv6Executable);
  } catch (err) {
    const msg = err.message || 'Executável MGV6 inválido';
    const code = /não encontrado|not found/i.test(msg)
      ? CODES.EXECUTABLE_NOT_FOUND
      : CODES.LAUNCH_INVALID;
    throw MGV6Error.fromCode(code, msg, { statusCode: 400 });
  }

  const cwdExe = path.dirname(exeAbs);
  const timestamp = new Date().toISOString();

  // eslint-disable-next-line no-console
  console.log(`[MGV6] ✔ MGV6 encontrado: ${exeAbs}`);
  // eslint-disable-next-line no-console
  console.log(`[MGV6] Abrindo via ShellExecute (Electron shell.openPath)...`);

  let openPathFn;
  try {
    openPathFn = await obterOpenPathFn(opcoes);
  } catch (err) {
    throw err;
  }

  let erroShell = '';
  try {
    // Electron: string vazia = sucesso; string não vazia = mensagem de erro
    erroShell = await openPathFn(exeAbs);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`[MGV6] ❌ Não foi possível abrir o MGV6: ${err.message}`);
    throw MGV6Error.fromCode(
      CODES.LAUNCH_FAILED,
      err.message || 'Falha ao abrir MGV6 via ShellExecute',
      {
        statusCode: 500,
        path: exeAbs,
        cwd: cwdExe,
        metodo: METODO_SHELL,
        timestamp
      }
    );
  }

  if (erroShell != null && String(erroShell).trim() !== '') {
    const motivo = String(erroShell).trim();
    // eslint-disable-next-line no-console
    console.log(`[MGV6] ❌ Não foi possível abrir o MGV6: ${motivo}`);
    throw MGV6Error.fromCode(CODES.LAUNCH_FAILED, motivo, {
      statusCode: 500,
      path: exeAbs,
      cwd: cwdExe,
      metodo: METODO_SHELL,
      timestamp
    });
  }

  // eslint-disable-next-line no-console
  console.log('[MGV6] ✔ MGV6 aberto pelo Windows');
  // eslint-disable-next-line no-console
  console.log('[MGV6] ℹ A carga da balança é realizada manualmente no MGV6.');

  return {
    sucesso: true,
    iniciado: true,
    metodo: METODO_SHELL,
    pid: null,
    path: exeAbs,
    cwd: cwdExe,
    timestamp,
    resultado: 'SHELL_EXECUTE_OK',
    nota: 'A carga da balança é realizada manualmente no MGV6.'
  };
}

module.exports = {
  launch,
  METODO_SHELL,
  obterOpenPathFn
};
