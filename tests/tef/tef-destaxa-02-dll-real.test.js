/**
 * TEF-DESTAXA-02 — REAL DLL TEST
 * Carrega libdll-integracao-tef.dll oficial 1.83 via Koffi e chama somente iniciaClientDestaxa.
 *
 * Executar: npm run test:tef-destaxa-real
 * Não usa mocks. Não inicia venda/PDV. Não executa CRT/PIX/EST.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DestaxaNativeBridge = require('../../backend/services/tef/destaxa/DestaxaNativeBridge');
const destaxaDllResolver = require('../../backend/services/tef/destaxa/destaxaDllResolver');
const destaxaBinarios = require('../../backend/services/tef/destaxa/destaxaBinarios');
const destaxaLogger = require('../../backend/services/tef/destaxa/destaxaLogger');
const {
  EXPORTS_OBRIGATORIOS,
  ESTADOS,
  ERROS,
  pastaArquitetura
} = require('../../backend/services/tef/destaxa/destaxaConstantes');

function sha256Arquivo(caminho) {
  return crypto.createHash('sha256').update(fs.readFileSync(caminho)).digest('hex').toUpperCase();
}

function coletarRuntime() {
  const pkg = require('../../package.json');
  let electronInstalado = pkg.devDependencies?.electron || pkg.dependencies?.electron || null;
  try {
    const electronPkg = require('../../node_modules/electron/package.json');
    electronInstalado = electronPkg.version || electronInstalado;
  } catch {
    // pacote electron ausente neste ambiente
  }

  return {
    node: process.versions.node,
    modules: process.versions.modules,
    processArch: process.arch,
    osArch: process.arch,
    platform: process.platform,
    electronPackage: electronInstalado,
    electronRuntime: process.versions.electron || null,
    main: pkg.main
  };
}

function verificarBinariosCopiados() {
  const raiz = destaxaDllResolver.encontrarRaizProjeto();
  const pasta = path.join(raiz, 'resources', 'tef', 'destaxa');
  const relatorio = {};
  for (const [archPasta, meta] of Object.entries(destaxaBinarios.arquivos)) {
    const arquivo = path.join(pasta, archPasta, meta.nome);
    assert.strictEqual(fs.existsSync(arquivo), true, `DLL ausente: ${arquivo}`);
    const stat = fs.statSync(arquivo);
    const hash = sha256Arquivo(arquivo);
    assert.strictEqual(stat.size, meta.tamanho, `tamanho divergente ${archPasta}`);
    assert.strictEqual(hash, meta.sha256, `SHA-256 divergente ${archPasta}`);
    relatorio[archPasta] = {
      arquivo,
      tamanho: stat.size,
      sha256: hash,
      peMachine: meta.peMachine,
      origem: meta.origem
    };
  }
  return relatorio;
}

console.log('=== TEF-DESTAXA-02 — REAL DLL TEST ===\n');

const runtime = coletarRuntime();
console.log('Runtime:', JSON.stringify(runtime, null, 2));

const binarios = verificarBinariosCopiados();
console.log('\nBinários oficiais copiados:');
console.log(JSON.stringify(binarios, null, 2));

assert.ok(pastaArquitetura(process.arch), ERROS.DESTAXA_ARCHITECTURE_NOT_SUPPORTED);
console.log(`\nSeleção: process.arch=${process.arch} → ${pastaArquitetura(process.arch)}`);

const resolucao = destaxaDllResolver.resolverDll({});
assert.strictEqual(resolucao.dllExists, true, `DLL real não encontrada: ${resolucao.mensagem}`);
assert.ok(String(resolucao.dllPath).includes(pastaArquitetura(process.arch)), 'DLL selecionada não corresponde a process.arch');

const bridge = new DestaxaNativeBridge();
const carregado = bridge.load();

if (!carregado.sucesso) {
  destaxaLogger.registrarBlocoReal(bridge.getDiagnostics(), { iniciaClientExecutado: false });
  console.error('\nFalha ao carregar DLL REAL');
  console.error(JSON.stringify({
    codigo: carregado.codigo,
    mensagem: carregado.mensagem,
    windows: bridge.getDiagnostics().ultimoErro?.windows || null
  }, null, 2));
  process.exit(1);
}

const diagLoad = bridge.getDiagnostics();
assert.strictEqual(diagLoad.dllLoaded, true);
assert.strictEqual(diagLoad.exportsValid, true);
for (const nome of EXPORTS_OBRIGATORIOS) {
  assert.strictEqual(diagLoad.exports[nome], true, `export real ausente: ${nome}`);
}
console.log('\n4 exports reais encontrados.');
assert.notStrictEqual(diagLoad.estado, ESTADOS.CLIENT_INITIALIZED, 'DLL carregada ainda não inicializa o Client');

const client = bridge.iniciarClient();
destaxaLogger.registrarBlocoReal(bridge.getDiagnostics(), {
  iniciaClientExecutado: true,
  codigoDestaxa: client.codigoDestaxa,
  duracaoMs: client.duracaoMs
});

console.log('\nDiagnóstico:');
console.log(JSON.stringify(bridge.getDiagnostics(), null, 2));
console.log('\niniciaClientDestaxa REAL:');
console.log(JSON.stringify({
  executado: true,
  codigoDestaxa: client.codigoDestaxa,
  descricaoCodigo: client.descricaoCodigo,
  estado: client.estado,
  duracaoMs: client.duracaoMs,
  entrada: client.entrada,
  tamanhoEntrada: client.tamanhoEntrada
}, null, 2));

assert.ok(client.codigoDestaxa, 'código real não capturado');
assert.ok(
  client.estado === ESTADOS.CLIENT_INITIALIZED || client.estado === ESTADOS.CLIENT_ERROR,
  `estado inesperado: ${client.estado}`
);

if (client.estado === ESTADOS.CLIENT_INITIALIZED) {
  assert.strictEqual(client.codigoDestaxa, '00');
  console.log('\nRESULTADO: CLIENT_INITIALIZED (00)');
} else {
  console.log(`\nRESULTADO VÁLIDO DESTA SPRINT: CLIENT_ERROR código=${client.codigoDestaxa}`);
  console.log('DLL e exports OK. O Client Destaxa pode não estar instalado/iniciado.');
}

bridge.unload();
console.log('\nREAL DLL TEST encerrado sem transação financeira.');
process.exit(0);
