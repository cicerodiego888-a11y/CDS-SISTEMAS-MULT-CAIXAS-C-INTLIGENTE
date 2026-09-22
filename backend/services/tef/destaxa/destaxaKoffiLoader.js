'use strict';

/**
 * Único módulo que conhece koffi e as assinaturas C da Destaxa.
 *
 * Decisão: koffi (N-API) em vez de ffi-napi/ref-napi citados nos TODOs SiTef.
 * Motivo: o projeto não possui FFI instalada; Electron permanece em 22.3.27;
 * koffi tem binários N-API e não exige rebuild nativo típico de ffi-napi.
 *
 * Assinaturas oficiais (não inventadas):
 *   void iniciaClientDestaxa(char *resultado, char *entrada, int tamanho_entrada);
 *   void iniciaTransacaoDestaxa(char *resultado, const char *operacao, char *entrada, int tamanho_entrada, char *saida, int *tamanho_saida);
 *   void continuaTransacaoDestaxa(char *resultado, char *entrada, int tamanho_entrada, char *saida, int *tamanho_saida);
 *   void finalizaTransacaoDestaxa(char *resultado, int confirmacao);
 */

const { EXPORTS_OBRIGATORIOS, ERROS, criarErro } = require('./destaxaConstantes');

const PROTOS = {
  iniciaClientDestaxa: 'void iniciaClientDestaxa(uint8 *resultado, uint8 *entrada, int tamanho_entrada)',
  iniciaTransacaoDestaxa: 'void iniciaTransacaoDestaxa(uint8 *resultado, const char *operacao, uint8 *entrada, int tamanho_entrada, uint8 *saida, int *tamanho_saida)',
  continuaTransacaoDestaxa: 'void continuaTransacaoDestaxa(uint8 *resultado, uint8 *entrada, int tamanho_entrada, uint8 *saida, int *tamanho_saida)',
  finalizaTransacaoDestaxa: 'void finalizaTransacaoDestaxa(uint8 *resultado, int confirmacao)'
};

function obterKoffi() {
  try {
    return require('koffi');
  } catch (error) {
    throw criarErro(
      ERROS.DESTAXA_DLL_LOAD_FAILED,
      'Biblioteca nativa koffi indisponível para carregar a DLL Destaxa',
      { causa: error.message }
    );
  }
}

function extrairErroWindows(error, dllPath) {
  const mensagem = String(error?.message || error || '');
  const dependenciaAusente = /specified module could not be found|não foi possível encontrar o módulo|126|193|The specified procedure could not be found/i.test(mensagem);
  return {
    codigo: error?.code || null,
    errno: error?.errno || null,
    win32: error?.errno || error?.code || null,
    mensagem,
    arquitetura: process.arch,
    caminho: dllPath,
    dependencia: dependenciaAusente
      ? 'DLL Destaxa ou dependência nativa ausente no Windows (não baixar DLL de fonte não oficial)'
      : null
  };
}

function carregarBiblioteca(dllPath) {
  const koffi = obterKoffi();
  let lib;
  try {
    lib = koffi.load(dllPath);
  } catch (error) {
    const windows = extrairErroWindows(error, dllPath);
    throw criarErro(
      ERROS.DESTAXA_DLL_LOAD_FAILED,
      `Falha ao carregar DLL Destaxa: ${windows.mensagem}`,
      { dllPath, windows }
    );
  }

  const exports = {};
  const presentes = {};
  const ausentes = [];

  for (const nome of EXPORTS_OBRIGATORIOS) {
    try {
      exports[nome] = lib.func(PROTOS[nome]);
      presentes[nome] = true;
    } catch (error) {
      presentes[nome] = false;
      ausentes.push(nome);
      exports[nome] = null;
    }
  }

  if (ausentes.length) {
    try {
      lib.unload();
    } catch {
      // ignore
    }
    throw criarErro(
      ERROS.DESTAXA_EXPORT_MISSING,
      `Exports Destaxa ausentes: ${ausentes.join(', ')}`,
      { dllPath, exports: presentes, ausentes }
    );
  }

  return {
    lib,
    exports,
    presentes,
    unload() {
      try {
        if (typeof lib.unload === 'function') {
          lib.unload();
        }
      } catch {
        // ignore
      }
    }
  };
}

module.exports = {
  PROTOS,
  carregarBiblioteca,
  obterKoffi,
  extrairErroWindows
};
