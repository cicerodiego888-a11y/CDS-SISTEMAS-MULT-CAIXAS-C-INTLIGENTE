/**
 * TEF-DESTAXA-07C — Configuração universal e persistência
 *
 * Não executa transações financeiras nem altera o banco oficial do cliente.
 * mercadao(3).db / ZIP: quando ausentes, usa cópia isolada (VACUUM INTO) do
 * banco oficial em ProgramData apenas para leitura do snapshot.
 *
 * Executar: node tests/tef/tef-destaxa-07c-config-universal.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

let passou = 0;
let falhou = 0;

function test(nome, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passou += 1;
      console.log(`  OK  ${nome}`);
    })
    .catch((error) => {
      falhou += 1;
      console.error(`  FALHOU  ${nome}`);
      console.error(`         ${error && error.stack ? error.stack : error}`);
    });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function openDb(dbPath, mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE) {
  return new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(dbPath, mode, (err) => (err ? reject(err) : resolve(conn)));
  });
}

async function criarSchemaTef(db) {
  await run(db, `
    CREATE TABLE IF NOT EXISTS tef_configuracoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chave TEXT UNIQUE NOT NULL,
      valor TEXT,
      descricao TEXT
    )
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS tef_configuracao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      habilitado INTEGER DEFAULT 0,
      provedor TEXT,
      ambiente TEXT,
      timeout INTEGER,
      tentativas INTEGER,
      empresa_codigo TEXT,
      loja_codigo TEXT,
      pdv_codigo TEXT,
      terminal_codigo TEXT,
      caixa_codigo TEXT,
      tipo_integracao TEXT,
      sdk_path TEXT,
      exe_path TEXT,
      ip_tef TEXT,
      porta_tef INTEGER,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS tef_servidores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tef_configuracao_id INTEGER,
      base_url TEXT,
      ip TEXT,
      porta INTEGER,
      client_id TEXT,
      client_secret TEXT,
      access_token TEXT,
      refresh_token TEXT,
      chave_comunicacao TEXT,
      operador TEXT
    )
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS tef_pinpads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tef_configuracao_id INTEGER,
      habilitado INTEGER,
      codigo TEXT,
      nome TEXT,
      fabricante TEXT,
      modelo TEXT,
      tipo_conexao TEXT,
      porta_com TEXT,
      ip TEXT,
      porta INTEGER,
      serial TEXT,
      status TEXT,
      ultima_conexao TEXT,
      ativo INTEGER DEFAULT 1
    )
  `);
  await run(db, `
    CREATE TABLE IF NOT EXISTS tef_operacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tef_configuracao_id INTEGER,
      debito INTEGER,
      credito_avista INTEGER,
      credito_parcelado INTEGER,
      voucher INTEGER,
      pix INTEGER,
      cancelamento INTEGER,
      reimpressao INTEGER,
      pre_autorizacao INTEGER,
      confirmacao_manual INTEGER
    )
  `);
}

function resolverCaminhosBanco() {
  const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
  // Sempre o caminho de instalação do cliente — não usar DB_DIR de teste.
  const oficial = path.join(programData, 'MercantilFiscal', 'dados', 'mercadao.db');
  const candidatosMercadao3 = [
    path.join(programData, 'MercantilFiscal', 'dados', 'mercadao(3).db'),
    path.join(programData, 'MercantilFiscal', 'dados', 'mercadao3.db'),
    path.join(__dirname, '../../dados/mercadao(3).db'),
    path.join(__dirname, '../../backend/banco/mercadao(3).db')
  ];
  const mercadao3 = candidatosMercadao3.find((p) => fs.existsSync(p)) || null;
  return {
    oficial,
    mercadao3,
    empacotadoEsperado: oficial,
    testeIsolado: path.join(os.tmpdir(), 'cds-sistemas-test-db', 'mercadao.db'),
    dbDirTeste: process.env.DB_DIR || null
  };
}

async function snapshotTefSomenteLeitura(dbPath) {
  const db = await openDb(dbPath, sqlite3.OPEN_READONLY);
  try {
    const principal = await get(db, 'SELECT * FROM tef_configuracao ORDER BY id ASC LIMIT 1');
    const pinpad = principal
      ? await get(db, 'SELECT * FROM tef_pinpads WHERE tef_configuracao_id = ? ORDER BY id ASC LIMIT 1', [principal.id])
      : null;
    return { principal, pinpad, caminho: dbPath };
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

async function copiarBancoIsolado(origem, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (fs.existsSync(destino)) fs.unlinkSync(destino);
  const db = await openDb(origem, sqlite3.OPEN_READONLY);
  try {
    await new Promise((resolve, reject) => {
      db.run(`VACUUM INTO ?`, [destino], (err) => (err ? reject(err) : resolve()));
    });
  } finally {
    await new Promise((resolve) => db.close(resolve));
  }
}

async function main() {
  console.log('=== TEF-DESTAXA-07C — CONFIGURAÇÃO UNIVERSAL ===\n');

  // Evita abrir/migrar o banco ProgramData ao carregar o repositório.
  process.env.CDS_TEST_ISOLAR_BANCO = process.env.CDS_TEST_ISOLAR_BANCO || '1';
  process.env.DB_DIR = process.env.DB_DIR || path.join(os.tmpdir(), 'cds-tef07c-sidecar-db');
  fs.mkdirSync(process.env.DB_DIR, { recursive: true });

  const caminhos = resolverCaminhosBanco();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-tef07c-'));
  const dbPath = path.join(tempDir, 'tef07c.db');
  console.log(`DB isolado do suite: ${dbPath}`);

  const repository = require('../../backend/repositories/tefConfigRepository');
  const tefConfigService = require('../../backend/services/tef/tefConfigService');
  const tefFactory = require('../../backend/services/tef/tefFactory');
  const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
  const DestaxaAdapter = require('../../backend/services/tef/adapters/destaxaAdapter');
  const RedeAdapter = require('../../backend/services/tef/adapters/redeAdapter');

  const db = await openDb(dbPath);
  await criarSchemaTef(db);
  repository.setDatabase(db);

  let snapshotCliente = null;

  await test('Escopo documentado: instalação (singleton), sem multitenancy inventado', () => {
    assert.strictEqual(tefConfigService.ESCOPO_CONFIGURACAO_TEF.nivel, 'instalacao');
    assert.match(tefConfigService.ESCOPO_CONFIGURACAO_TEF.descricao, /Singleton/i);
  });

  await test('Configuração nova: TEF desabilitado e sem provedor inventado', async () => {
    const config = await tefConfigService.obterConfiguracao();
    assert.strictEqual(config.tefHabilitado, 'false');
    assert.strictEqual(config.tefProvedor, '');
    assert.strictEqual(config.tefAmbiente, 'simulacao');
    assert.strictEqual(config._defaultsAplicados, true);
    assert.strictEqual(await repository.contarConfiguracoes(), 0);
  });

  await test('Persistência após reinicialização (save → get)', async () => {
    await tefConfigService.salvarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'destaxa',
      tefAmbiente: 'homologacao',
      tefTimeout: 60,
      tefTentativas: 1,
      tipoIntegracao: 'dll',
      pinpadHabilitado: true,
      pinpadModelo: 'GERTEC_PPC930',
      tipoConexao: 'serial',
      portaCom: 'COM7'
    });
    const a = await tefConfigService.getConfig();
    const b = await tefConfigService.obterConfiguracao();
    assert.strictEqual(a.tefProvedor, 'destaxa');
    assert.strictEqual(b.tefAmbiente, 'homologacao');
    assert.strictEqual(b.portaCom, 'COM7');
    assert.strictEqual(a._defaultsAplicados, undefined);
  });

  await test('Troca de provedor persiste e fábrica respeita', async () => {
    await tefConfigService.salvarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'rede',
      tefAmbiente: 'simulacao',
      empresaCodigo: 'E1',
      lojaCodigo: 'L1',
      terminalCodigo: 'T1',
      pinpadHabilitado: false
    });
    const cfg = await tefConfigService.obterConfiguracao();
    assert.strictEqual(cfg.tefProvedor, 'rede');
    const adapter = tefFactory.criarAdapter(tefConfigService.configParaRegistroAdapter(cfg));
    assert.ok(adapter);
    assert.ok(/rede/i.test(adapter.nome || adapter.adquirente || 'Rede'));
  });

  await test('Troca de ambiente Destaxa: simulacao → adapter simulado', async () => {
    await tefConfigService.salvarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'destaxa',
      tefAmbiente: 'simulacao',
      pinpadHabilitado: false
    });
    const cfg = await tefConfigService.obterConfiguracao();
    const adapter = tefFactory.criarAdapter(tefConfigService.configParaRegistroAdapter(cfg));
    assert.ok(!(adapter instanceof DestaxaRealAdapter));
    assert.strictEqual(String(adapter.modo || 'simulacao').toLowerCase(), 'simulacao');
  });

  await test('Destaxa/homologação seleciona DestaxaRealAdapter quando disponível', () => {
    const adapter = tefFactory.criarAdapter(
      { provedor: 'destaxa', ambiente: 'homologacao' },
      { verificarDisponibilidadeReal: () => ({ disponivel: true, dllPath: 'X:\\fake.dll' }) }
    );
    assert.ok(adapter instanceof DestaxaRealAdapter);
    assert.strictEqual(adapter.modo, 'real');
  });

  await test('Destaxa/simulação seleciona adapter de simulação', () => {
    const adapter = tefFactory.criarAdapter({ provedor: 'destaxa', ambiente: 'simulacao' });
    assert.ok(!(adapter instanceof DestaxaRealAdapter));
    const factorySim = typeof DestaxaAdapter === 'function'
      ? DestaxaAdapter({ provedor: 'destaxa', ambiente: 'simulacao' })
      : null;
    assert.ok(adapter);
    assert.notStrictEqual(adapter.modo, 'real');
    if (factorySim) {
      assert.strictEqual(String(adapter.modo || '').toLowerCase(), String(factorySim.modo || 'simulacao').toLowerCase());
    }
  });

  await test('Adapter real Destaxa indisponível: erro explícito, sem fallback', () => {
    assert.throws(
      () => tefFactory.criarAdapter(
        { provedor: 'destaxa', ambiente: 'homologacao' },
        { verificarDisponibilidadeReal: () => ({ disponivel: false, codigo: 'DLL_AUSENTE', mensagem: 'DLL ausente' }) }
      ),
      (err) => err && err.codigo === 'DESTAXA_REAL_ADAPTER_INDISPONIVEL'
    );
  });

  await test('SiTef/PayGo em homologação sem DLL: erro explícito (sem fallback silencioso)', () => {
    const SitefRealAdapter = require('../../backend/services/tef/adapters/sitefRealAdapter');
    const PaygoRealAdapter = require('../../backend/services/tef/adapters/paygoRealAdapter');
    const sitefOk = SitefRealAdapter.podeUsarModoReal();
    const paygoOk = PaygoRealAdapter.podeUsarModoReal();

    if (!sitefOk) {
      assert.throws(
        () => tefFactory.criarAdapter({ provedor: 'sitef', ambiente: 'homologacao' }),
        (err) => err && err.codigo === 'SITEF_REAL_ADAPTER_INDISPONIVEL'
      );
    } else {
      const adapter = tefFactory.criarAdapter({ provedor: 'sitef', ambiente: 'homologacao' });
      assert.ok(adapter);
      assert.notStrictEqual(String(adapter.modo || '').toLowerCase(), 'simulacao');
    }

    if (!paygoOk) {
      assert.throws(
        () => tefFactory.criarAdapter({ provedor: 'paygo', ambiente: 'producao' }),
        (err) => err && err.codigo === 'PAYGO_REAL_ADAPTER_INDISPONIVEL'
      );
    } else {
      const adapter = tefFactory.criarAdapter({ provedor: 'paygo', ambiente: 'producao' });
      assert.ok(adapter);
      assert.notStrictEqual(String(adapter.modo || '').toLowerCase(), 'simulacao');
    }

    // Contrato: nunca cair em simulação silenciosa quando ambiente é real.
    const factorySrc = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/tefFactory.js'), 'utf8');
    assert.match(factorySrc, /SITEF_REAL_ADAPTER_INDISPONIVEL/);
    assert.match(factorySrc, /PAYGO_REAL_ADAPTER_INDISPONIVEL/);
    assert.doesNotMatch(
      factorySrc,
      /if \(usarReal && SitefRealAdapter\.podeUsarModoReal\(\)\) \{\s*return new SitefRealAdapter[\s\S]*?\}\s*return new SitefAdapter/
    );
  });

  await test('Configuração inválida: ambiente e provedor ausente com erro explícito', () => {
    const invalida = tefConfigService.validarConfiguracao({
      tefHabilitado: true,
      tefProvedor: '',
      tefAmbiente: 'lab'
    });
    assert.strictEqual(invalida.valida, false);
    assert.ok(invalida.pendencias.some((p) => /Provedor/i.test(p)));
    assert.ok(invalida.pendencias.some((p) => /Ambiente/i.test(p)));

    assert.throws(
      () => tefFactory.criarAdapter({ provedor: '', ambiente: 'simulacao' }),
      (err) => err && err.codigo === 'TEF_PROVEDOR_NAO_CONFIGURADO'
    );
  });

  await test('Destaxa não exige códigos empresa/loja/terminal nem servidor HTTP', () => {
    const ok = tefConfigService.validarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'destaxa',
      tefAmbiente: 'homologacao',
      pinpadHabilitado: false
    });
    assert.strictEqual(ok.valida, true, ok.pendencias.join('; '));
    assert.ok(!ok.pendencias.some((p) => /empresa|loja|terminal/i.test(p)));
  });

  await test('Rede/SiTef ainda exigem códigos de estabelecimento', () => {
    const rede = tefConfigService.validarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'rede',
      tefAmbiente: 'simulacao'
    });
    assert.strictEqual(rede.valida, false);
    assert.ok(rede.pendencias.includes('Código da empresa não configurado'));
  });

  await test('Preservação dos provedores existentes (Rede simulação)', () => {
    const adapter = RedeAdapter({ provedor: 'rede', ambiente: 'simulacao' });
    assert.ok(adapter);
    assert.strictEqual(String(adapter.modo || 'simulacao').toLowerCase(), 'simulacao');
    for (const p of tefFactory.PROVEDORES) {
      assert.strictEqual(tefFactory.provedorReconhecido(p), true);
    }
  });

  await test('PUT parcial não apaga provedor/ambiente/pinpad existentes', async () => {
    await tefConfigService.salvarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'destaxa',
      tefAmbiente: 'homologacao',
      pinpadHabilitado: true,
      pinpadModelo: 'GERTEC_PPC930',
      tipoConexao: 'serial',
      portaCom: 'COM9'
    });
    await tefConfigService.atualizarConfiguracao({
      tefTimeout: 120
    });
    const cfg = await tefConfigService.obterConfiguracao();
    assert.strictEqual(cfg.tefProvedor, 'destaxa');
    assert.strictEqual(cfg.tefAmbiente, 'homologacao');
    assert.strictEqual(cfg.portaCom, 'COM9');
    assert.strictEqual(Number(cfg.tefTimeout), 120);
  });

  await test('Detecção de mudança da porta do PinPad (COM salva ≠ detectada)', () => {
    const igual = tefConfigService.compararPortaPinpad('COM3', 'COM3');
    assert.strictEqual(igual.coincidem, true);
    assert.strictEqual(igual.mudou, false);

    const mudou = tefConfigService.compararPortaPinpad('COM3', 'COM4');
    assert.strictEqual(mudou.coincidem, false);
    assert.strictEqual(mudou.mudou, true);
    assert.strictEqual(mudou.salva, 'COM3');
    assert.strictEqual(mudou.detectada, 'COM4');

    const normalizada = tefConfigService.compararPortaPinpad('com 7', 'COM7');
    assert.strictEqual(normalizada.coincidem, true);
  });

  await test('Defaults não sobrescrevem configuração já salva', async () => {
    await tefConfigService.salvarConfiguracao({
      tefHabilitado: false,
      tefProvedor: 'stone',
      tefAmbiente: 'homologacao',
      tefTimeout: 90,
      empresaCodigo: 'X',
      lojaCodigo: 'Y',
      terminalCodigo: 'Z',
      pinpadHabilitado: false
    });
    const carregada = await tefConfigService.obterConfiguracao();
    assert.strictEqual(carregada.tefHabilitado, 'false');
    assert.strictEqual(carregada.tefProvedor, 'stone');
    assert.notStrictEqual(carregada.tefProvedor, tefConfigService.DEFAULTS_CONFIG.tefProvedor);
  });

  await test('Caminho do banco: ProgramData alinhado (dev/empacotado) e teste isolável', () => {
    const dbJs = fs.readFileSync(path.join(__dirname, '../../backend/database.js'), 'utf8');
    assert.match(dbJs, /PROGRAMDATA/);
    assert.match(dbJs, /MercantilFiscal/);
    assert.match(dbJs, /mercadao\.db/);
    assert.match(dbJs, /CDS_TEST_ISOLAR_BANCO|EXECUCAO_EM_TESTE/);

    const electronJs = fs.readFileSync(path.join(__dirname, '../../electron.js'), 'utf8');
    assert.match(electronJs, /DB_DIR/);
    assert.match(electronJs, /MercantilFiscal/);

    assert.strictEqual(
      caminhos.empacotadoEsperado.toLowerCase(),
      path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'MercantilFiscal', 'dados', 'mercadao.db').toLowerCase()
    );
  });

  await test('Snapshot cliente oficial (somente leitura) — não sobrescrever', async () => {
    const origem = caminhos.mercadao3 || caminhos.oficial;
    if (!fs.existsSync(origem)) {
      console.log(`         AVISO: banco cliente ausente (${origem}) — snapshot pulado`);
      return;
    }

    snapshotCliente = await snapshotTefSomenteLeitura(origem);
    console.log('         SNAPSHOT_ORIGEM', origem);
    console.log('         SNAPSHOT_TEF', JSON.stringify({
      habilitado: snapshotCliente.principal?.habilitado,
      provedor: snapshotCliente.principal?.provedor,
      ambiente: snapshotCliente.principal?.ambiente,
      porta_com: snapshotCliente.pinpad?.porta_com,
      pinpad: snapshotCliente.pinpad?.codigo
    }));

    const copia = path.join(tempDir, 'cliente-copia.db');
    await copiarBancoIsolado(origem, copia);
    repository.setDatabase(db);

    const oficialApos = await snapshotTefSomenteLeitura(origem);
    assert.strictEqual(
      oficialApos.principal?.provedor,
      snapshotCliente.principal?.provedor,
      'Banco oficial não deve ter sido alterado'
    );
    assert.strictEqual(
      oficialApos.pinpad?.porta_com,
      snapshotCliente.pinpad?.porta_com
    );
    assert.ok(fs.existsSync(copia));
  });

  await test('Consistência tela/serviço/fábrica/diagnóstico (fonte única)', async () => {
    await tefConfigService.salvarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'destaxa',
      tefAmbiente: 'simulacao',
      pinpadHabilitado: true,
      pinpadModelo: 'GERTEC_PPC930',
      tipoConexao: 'usb',
      portaCom: 'COM11'
    });
    const cfg = await tefConfigService.obterConfiguracao();
    const status = await tefConfigService.obterStatus();
    const registro = tefConfigService.configParaRegistroAdapter(cfg);
    const adapter = tefFactory.criarAdapter(registro);

    assert.strictEqual(status.provedor, 'destaxa');
    assert.strictEqual(status.ambiente, 'simulacao');
    assert.strictEqual(status.modoAdapter, 'simulacao');
    assert.strictEqual(registro.provedor, cfg.tefProvedor);
    assert.strictEqual(registro.ambiente, cfg.tefAmbiente);
    assert.notStrictEqual(adapter.modo, 'real');

    const ui = fs.readFileSync(path.join(__dirname, '../../frontend/erp/js/configuracao_tef.js'), 'utf8');
    assert.match(ui, /Selecione o provedor/);
    assert.match(ui, /value="destaxa"/);
    assert.doesNotMatch(ui, /placeholder="Ex\.: COM4"/);
  });

  await test('Isolamento de escopo: um singleton por banco (duas DBs independentes)', async () => {
    const outroPath = path.join(tempDir, 'outro-cliente.db');
    const outroDb = await openDb(outroPath);
    await criarSchemaTef(outroDb);
    repository.setDatabase(outroDb);
    await tefConfigService.salvarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'cielo',
      tefAmbiente: 'simulacao',
      empresaCodigo: 'C',
      lojaCodigo: 'C',
      terminalCodigo: 'C',
      pinpadHabilitado: false
    });
    const cfgOutro = await tefConfigService.obterConfiguracao();
    assert.strictEqual(cfgOutro.tefProvedor, 'cielo');

    repository.setDatabase(db);
    const cfgOriginal = await tefConfigService.obterConfiguracao();
    assert.notStrictEqual(cfgOriginal.tefProvedor, 'cielo');
    await new Promise((resolve) => outroDb.close(resolve));
  });

  await test('Limpeza do banco isolado de teste', async () => {
    repository.setDatabase(db);
    await repository.limparConfiguracaoCompleta();
    assert.strictEqual(await repository.contarConfiguracoes(), 0);
  });

  await new Promise((resolve) => db.close(resolve));
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  // Persist snapshot path for report generator
  const reportMeta = {
    caminhos,
    snapshotCliente: snapshotCliente
      ? {
        caminho: snapshotCliente.caminho,
        provedor: snapshotCliente.principal?.provedor || null,
        ambiente: snapshotCliente.principal?.ambiente || null,
        habilitado: snapshotCliente.principal?.habilitado ?? null,
        porta_com: snapshotCliente.pinpad?.porta_com || null,
        pinpad: snapshotCliente.pinpad?.codigo || null
      }
      : null,
    passou,
    falhou,
    mercadao3Encontrado: Boolean(caminhos.mercadao3)
  };
  const metaPath = path.join(os.tmpdir(), 'cds-tef07c-meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(reportMeta, null, 2), 'utf8');
  console.log(`\n=== RESULTADO 07C: ${passou} passou, ${falhou} falhou ===`);
  console.log(`Meta: ${metaPath}`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal 07C:', error);
  process.exit(1);
});
