'use strict';

const { PROVIDER } = require('./destaxaConstantes');

const CAMPOS_PROIBIDOS = /pan|senha|cvv|cartao|card|pin|track|cvv2/i;

function sanitizar(valor) {
  if (valor == null) return valor;
  if (typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(sanitizar);
  const saida = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (CAMPOS_PROIBIDOS.test(chave)) {
      saida[chave] = '[REDACTED]';
    } else if (item && typeof item === 'object') {
      saida[chave] = sanitizar(item);
    } else {
      saida[chave] = item;
    }
  }
  return saida;
}

function registrar(evento, dados = {}) {
  const payload = sanitizar({
    provider: PROVIDER,
    evento,
    ...dados
  });
  console.log(`[TEF-${PROVIDER}] ${evento}`, JSON.stringify(payload));
  return payload;
}

function registrarBlocoReal(diag = {}, extra = {}) {
  const exports = diag.exports || {};
  const linhas = [
    '[DESTAXA]',
    `Arquitetura: ${diag.processArch || process.arch}`,
    `DLL: ${diag.dllPath || ''}`,
    `DLL encontrada: ${diag.dllExists === true}`,
    `DLL carregada: ${diag.dllLoaded === true}`,
    `Exports: iniciaClientDestaxa=${Boolean(exports.iniciaClientDestaxa)}; iniciaTransacaoDestaxa=${Boolean(exports.iniciaTransacaoDestaxa)}; continuaTransacaoDestaxa=${Boolean(exports.continuaTransacaoDestaxa)}; finalizaTransacaoDestaxa=${Boolean(exports.finalizaTransacaoDestaxa)}`,
    `iniciaClient: ${extra.iniciaClientExecutado === true}`,
    `Código: ${diag.clientResultCode || extra.codigoDestaxa || ''}`,
    `Tempo: ${extra.duracaoMs != null ? `${extra.duracaoMs}ms` : ''}`,
    `Estado: ${diag.estado || ''}`
  ];
  console.log(linhas.join('\n'));
  return linhas.join('\n');
}

module.exports = {
  registrar,
  registrarBlocoReal,
  sanitizar
};
