'use strict';

/**
 * Validação Destaxa 1.83 no processo Electron real do CDS.
 * Ativado SOMENTE com TEF_DESTAXA_REAL_TEST=1.
 * Não chama iniciaTransacaoDestaxa / continua / finaliza.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const DestaxaRealAdapter = require('../adapters/DestaxaRealAdapter');
const destaxaDllResolver = require('./destaxaDllResolver');
const { EXPORTS_OBRIGATORIOS, ESTADOS } = require('./destaxaConstantes');

const ENV_FLAG = 'TEF_DESTAXA_REAL_TEST';

function modoAtivo() {
  return String(process.env[ENV_FLAG] || '').trim() === '1';
}

function inspecionarVsPagueClient() {
  const candidatos = [
    'C:\\VBI\\Java\\bin\\VSPagueClient.exe'
  ];
  const arquivoEncontrado = candidatos.find((p) => fs.existsSync(p)) || null;
  let executando = false;
  let detalheTasklist = null;
  try {
    const saida = execSync('tasklist /FI "IMAGENAME eq VSPagueClient.exe" /FO CSV /NH', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 8000
    });
    detalheTasklist = String(saida || '').trim();
    executando = /VSPagueClient\.exe/i.test(detalheTasklist) && !/No tasks|Nenhuma/i.test(detalheTasklist);
  } catch (error) {
    detalheTasklist = error.message;
  }
  return {
    encontrado: Boolean(arquivoEncontrado) || executando,
    jaEstavaExecutando: executando,
    caminho: arquivoEncontrado,
    detalheTasklist
  };
}

function coletarRuntime() {
  return {
    arch: process.arch,
    electron: process.versions.electron || null,
    node: process.versions.node,
    modules: process.versions.modules,
    platform: process.platform,
    execPath: process.execPath,
    cwd: process.cwd()
  };
}

function caminhoRelatorio() {
  const raiz = destaxaDllResolver.encontrarRaizProjeto();
  return path.join(raiz, 'docs', 'build', 'tef-destaxa-electron-runtime-report.json');
}

async function executarNoProcessoElectron() {
  const runtime = coletarRuntime();
  console.log('[TEF-DESTAXA-ELECTRON-TEST] runtime', runtime);
  console.log({
    arch: runtime.arch,
    electron: runtime.electron,
    node: runtime.node,
    modules: runtime.modules,
    platform: runtime.platform
  });

  const vspague = inspecionarVsPagueClient();
  console.log('[TEF-DESTAXA-ELECTRON-TEST] VSPagueClient', vspague);

  const adapter = new DestaxaRealAdapter({});
  const carregado = adapter.bridge.load();
  const diagLoad = adapter.bridge.getDiagnostics();

  const exportsEncontrados = { ...diagLoad.exports };
  const exportsOk = EXPORTS_OBRIGATORIOS.every((nome) => exportsEncontrados[nome] === true);

  let client = null;
  if (carregado.sucesso && exportsOk) {
    client = adapter.bridge.iniciarClient({});
  }

  const relatorio = {
    modo: ENV_FLAG,
    runtime,
    vspague,
    adapter: adapter.nome,
    dllPath: diagLoad.dllPath,
    dllExists: diagLoad.dllExists,
    dllLoaded: diagLoad.dllLoaded,
    exports: exportsEncontrados,
    exportsOk,
    iniciaClientExecutado: Boolean(client),
    entrada: client?.entrada || null,
    tamanhoEntrada: client?.tamanhoEntrada || null,
    codigoDestaxa: client?.codigoDestaxa || null,
    descricaoCodigo: client?.descricaoCodigo || null,
    duracaoMs: client?.duracaoMs || null,
    estado: client?.estado || diagLoad.estado,
    diagnostico: adapter.bridge.getDiagnostics(),
    transacaoFinanceira: false,
    crtPixEst: false,
    funcoesTransacionaisChamadas: []
  };

  const arquivo = caminhoRelatorio();
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify(relatorio, null, 2), 'utf8');
  console.log('[TEF-DESTAXA-ELECTRON-TEST] relatorio', arquivo);
  console.log('[TEF-DESTAXA-ELECTRON-TEST] resultado', JSON.stringify({
    codigoDestaxa: relatorio.codigoDestaxa,
    estado: relatorio.estado,
    dllLoaded: relatorio.dllLoaded,
    exportsOk: relatorio.exportsOk
  }));

  adapter.bridge.unload();

  if (!relatorio.dllLoaded || !relatorio.exportsOk) {
    return 1;
  }
  if (relatorio.codigoDestaxa === '00' && relatorio.estado === ESTADOS.CLIENT_INITIALIZED) {
    return 0;
  }
  return 2;
}

module.exports = {
  ENV_FLAG,
  modoAtivo,
  executarNoProcessoElectron,
  caminhoRelatorio
};
