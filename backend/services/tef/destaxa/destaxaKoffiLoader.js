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
      { causa: error.message, classeDiagnostico: 'KOFFI_AUSENTE' }
    );
  }
}

/**
 * Classifica falha de LoadLibrary/koffi.load sem INIT.
 * Win32 126 = módulo/dependência ausente; 193 = formato/arquitetura inválida.
 */
function extrairErroWindows(error, dllPath) {
  const mensagem = String(error?.message || error || '');
  const errno = error?.errno != null ? Number(error.errno) : null;
  const code = error?.code != null ? String(error.code) : null;
  const win32 = errno != null && Number.isFinite(errno) ? Math.abs(errno) : null;

  const is193 = win32 === 193
    || /193|not a valid Win32 application|não é um aplicativo Win32 válido|Bad EXE format/i.test(mensagem);
  const is126 = win32 === 126
    || /126|specified module could not be found|não foi possível encontrar o módulo especificado/i.test(mensagem);
  const procedureMissing = /The specified procedure could not be found|não foi possível encontrar o procedimento/i.test(mensagem);

  let classeDiagnostico = 'ERRO_CARREGAMENTO';
  let codigoErro = ERROS.DESTAXA_DLL_LOAD_FAILED;
  let dependencia = null;

  if (is193) {
    classeDiagnostico = 'ARQUITETURA_INCOMPATIVEL';
    codigoErro = ERROS.DESTAXA_ARCHITECTURE_MISMATCH;
  } else if (is126) {
    classeDiagnostico = 'DEPENDENCIA_NATIVA_AUSENTE';
    codigoErro = ERROS.DESTAXA_NATIVE_DEPENDENCY_MISSING;
    dependencia = 'DLL Destaxa presente, mas dependência nativa do Windows (CRT/WS2) ou módulo satélite ausente';
  } else if (procedureMissing) {
    classeDiagnostico = 'EXPORT_OU_DEPENDENCIA';
    codigoErro = ERROS.DESTAXA_DLL_LOAD_FAILED;
    dependencia = 'Procedimento/exportação não encontrada no módulo carregado';
  }

  return {
    codigo: code,
    errno,
    win32: win32 || code,
    mensagem,
    arquitetura: process.arch,
    caminho: dllPath,
    classeDiagnostico,
    codigoErro,
    dependencia
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
      windows.codigoErro || ERROS.DESTAXA_DLL_LOAD_FAILED,
      `Falha ao carregar DLL Destaxa: ${windows.mensagem}`,
      { dllPath, windows, classeDiagnostico: windows.classeDiagnostico }
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
      { dllPath, exports: presentes, ausentes, classeDiagnostico: 'EXPORT_AUSENTE' }
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
