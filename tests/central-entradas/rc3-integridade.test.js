/**
 * Testes — Integridade RC3 da Central Inteligente de Entradas
 * Sem HTTP real / sem SEFAZ.
 *
 * Executar: npm run test:central-integridade
 *           node tests/central-entradas/rc3-integridade.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const orchestrator = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');
const { CentralEntradasOrchestrator, VERSAO_MODULO } = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');
const CentralEntradasService = require('../../backend/motores/central-entradas/CentralEntradasService');
const { DocumentoFiscalStatus } = require('../../backend/motores/central-entradas/core/DocumentoFiscalStatus');
const {
  TRANSICOES_PERMITIDAS,
  podeTransicionar,
  validarTransicao
} = require('../../backend/motores/central-entradas/core/MaquinaEstadosDocumento');
const { TIPOS_EVENTO, ORIGENS } = require('../../backend/motores/central-entradas/config/centralEventosTipos');
const { normalizarEvento, emitirEvento } = require('../../backend/motores/central-entradas/utils/centralEventosEmitter');
const { logCentral } = require('../../backend/motores/central-entradas/utils/centralLog');

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error.message}`);
    });
}

async function main() {
  console.log('\n=== Testes Integridade RC3 — Central de Entradas ===\n');

  await test('versão do módulo é RC3+', async () => {
    assert.ok(/^1\.0\.0-rc[3-9]/.test(VERSAO_MODULO), `esperava rc3+, obteve ${VERSAO_MODULO}`);
    assert.strictEqual(orchestrator.obterMetadados().versao, VERSAO_MODULO);
  });

  await test('existe apenas um Orchestrator exportado (singleton)', async () => {
    const a = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');
    const b = require('../../backend/motores/central-entradas/CentralEntradasOrchestrator');
    assert.strictEqual(a, b);
    assert.ok(a instanceof CentralEntradasOrchestrator || typeof a.vincularCompra === 'function');
  });

  await test('Facade delega exclusivamente ao Orchestrator', async () => {
    const facade = new CentralEntradasService({ orchestrator });
    assert.strictEqual(typeof facade.obterInteligenciaOperacional, 'function');
    assert.strictEqual(typeof facade.vincularCompra, 'function');
    assert.strictEqual(typeof facade.processarDocumento, 'function');
  });

  await test('máquina: EM_PROCESSAMENTO não vai direto para REVISADA', async () => {
    assert.strictEqual(
      podeTransicionar(DocumentoFiscalStatus.EM_PROCESSAMENTO, DocumentoFiscalStatus.REVISADA),
      false
    );
  });

  await test('máquina: REVISADA → EM_COMPRA alinhada ao bridge', async () => {
    assert.strictEqual(
      podeTransicionar(DocumentoFiscalStatus.REVISADA, DocumentoFiscalStatus.EM_COMPRA),
      true
    );
  });

  await test('máquina: fluxo feliz Sync → Processamento → Pronta → Compra → Gravada', async () => {
    const fluxo = [
      [DocumentoFiscalStatus.SINCRONIZADA, DocumentoFiscalStatus.EM_PROCESSAMENTO],
      [DocumentoFiscalStatus.EM_PROCESSAMENTO, DocumentoFiscalStatus.PRONTA_PARA_COMPRA],
      [DocumentoFiscalStatus.PRONTA_PARA_COMPRA, DocumentoFiscalStatus.EM_COMPRA],
      [DocumentoFiscalStatus.EM_COMPRA, DocumentoFiscalStatus.GRAVADA]
    ];
    for (const [de, para] of fluxo) {
      const r = validarTransicao(de, para);
      assert.strictEqual(r.valido, true, `${de} → ${para}`);
    }
  });

  await test('TRANSICOES_PERMITIDAS sem duplicatas por origem', async () => {
    for (const [status, destinos] of Object.entries(TRANSICOES_PERMITIDAS)) {
      const unique = new Set(destinos);
      assert.strictEqual(unique.size, destinos.length, status);
    }
  });

  await test('eventos possuem contrato normalizado RC3', async () => {
    const n = normalizarEvento({
      tipo: TIPOS_EVENTO.DOCUMENTO_PROCESSADO,
      origem: ORIGENS.API,
      descricao: 'teste',
      resultado: 'PRONTA_PARA_COMPRA',
      sucesso: true,
      documentoId: 10,
      usuarioId: 7,
      tempo: 123
    });
    assert.strictEqual(n.tipo, TIPOS_EVENTO.DOCUMENTO_PROCESSADO);
    assert.strictEqual(n.origem, ORIGENS.API);
    assert.strictEqual(n.documentoId, 10);
    assert.strictEqual(n.duracaoMs, 123);
    assert.strictEqual(n.detalhe.usuarioId, 7);
    assert.ok(ORIGENS.DIAGNOSTICO);
    assert.ok(ORIGENS.COMPRAS);
    assert.ok(ORIGENS.UPLOAD);
  });

  await test('logCentral não lança', async () => {
    logCentral('TESTE', { ok: true });
  });

  await test('arquivos oficiais do pipeline existem', async () => {
    const base = path.join(__dirname, '../../backend/motores/central-entradas');
    const obrigatorios = [
      'CentralEntradasOrchestrator.js',
      'CentralEntradasService.js',
      'services/CentralProcessamentoService.js',
      'services/CentralDfePersistenciaService.js',
      'services/CentralComprasBridgeService.js',
      'services/DocumentoTransitionService.js',
      'core/MaquinaEstadosDocumento.js',
      'utils/centralEventosEmitter.js',
      'utils/centralLog.js'
    ];
    for (const rel of obrigatorios) {
      assert.ok(fs.existsSync(path.join(base, rel)), rel);
    }
  });

  await test('docs de arquitetura RC3/RC4 existem', async () => {
    const doc = path.join(__dirname, '../../docs/fiscal/CENTRAL_ENTRADAS_ARQUITETURA.md');
    const txt = fs.readFileSync(doc, 'utf8');
    assert.ok(/RC[34]/.test(txt));
    assert.ok(txt.includes('CentralEntradasOrchestrator'));
    assert.ok(txt.includes('/inteligencia') || txt.includes('CentralConfiguracaoService'));
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  if (falhou > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
