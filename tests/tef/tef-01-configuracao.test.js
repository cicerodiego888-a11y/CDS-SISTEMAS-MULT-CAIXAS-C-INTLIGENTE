/**
 * TEF-01 — Fundação da Configuração TEF
 * Round-trip, reinicialização, PPC930/COM4, geral, servidor, validação.
 *
 * Executar: node tests/tef/tef-01-configuracao.test.js
 */
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
      console.error(`         ${error.message}`);
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

function normalizarComparavel(valor) {
  if (valor === true || valor === 'true' || valor === 1 || valor === '1') return 'true';
  if (valor === false || valor === 'false' || valor === 0 || valor === '0') return 'false';
  if (valor === null || valor === undefined) return '';
  return String(valor);
}

function assertCamposIguais(original, recuperado, campos) {
  const divergencias = [];
  campos.forEach((campo) => {
    const a = normalizarComparavel(original[campo]);
    const b = normalizarComparavel(recuperado[campo]);
    if (a !== b) {
      divergencias.push(`${campo}: esperado="${a}" obtido="${b}"`);
    }
  });
  assert.strictEqual(divergencias.length, 0, divergencias.join('; '));
}

async function main() {
  console.log('=== TEF-01 — FUNDAÇÃO DA CONFIGURAÇÃO TEF ===\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cds-tef01-'));
  const dbPath = path.join(tempDir, 'tef01.db');
  const db = await new Promise((resolve, reject) => {
    const conn = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : resolve(conn)));
  });

  await criarSchemaTef(db);

  const repository = require('../../backend/repositories/tefConfigRepository');
  repository.setDatabase(db);

  const tefConfigService = require('../../backend/services/tef/tefConfigService');
  const RedeAdapter = require('../../backend/services/tef/adapters/redeAdapter');

  const CAMPOS_GERAL = [
    'tefHabilitado', 'tefProvedor', 'tefAmbiente', 'tefTimeout', 'tefTentativas',
    'tipoIntegracao', 'sdkPath', 'exePath', 'ipTef', 'portaTef'
  ];

  const CAMPOS_SERVIDOR = [
    'baseUrl', 'ipServidor', 'portaServidor',
    'clientId', 'clientSecret', 'accessToken', 'refreshToken',
    'chaveComunicacao', 'operador'
  ];

  const CAMPOS_PINPAD = [
    'pinpadHabilitado', 'pinpadModelo', 'pinpadCodigo',
    'fabricante', 'modelo', 'tipoConexao', 'portaCom',
    'pinpadIp', 'pinpadPorta', 'serial'
  ];

  await test('Fonte oficial expõe getConfig/saveConfig/validateConfig/getPinPadConfig/getServerConfig', async () => {
    assert.strictEqual(typeof tefConfigService.getConfig, 'function');
    assert.strictEqual(typeof tefConfigService.saveConfig, 'function');
    assert.strictEqual(typeof tefConfigService.updateConfig, 'function');
    assert.strictEqual(typeof tefConfigService.validateConfig, 'function');
    assert.strictEqual(typeof tefConfigService.getPinPadConfig, 'function');
    assert.strictEqual(typeof tefConfigService.getServerConfig, 'function');
  });

  await test('Defaults seguros apenas quando configuração não existe', async () => {
    const config = await tefConfigService.obterConfiguracao();
    assert.strictEqual(config.tefHabilitado, 'true');
    assert.strictEqual(config.tefProvedor, 'rede');
    assert.strictEqual(config.tefAmbiente, 'simulacao');
    assert.strictEqual(Number(config.tefTimeout), 60);
    assert.strictEqual(Number(config.tefTentativas), 3);
    assert.strictEqual(config._defaultsAplicados, true);

    const total = await repository.contarConfiguracoes();
    assert.strictEqual(total, 0, 'Defaults no GET não devem gravar no banco');
  });

  await test('Round-trip configuração geral (tipoIntegracao/sdk/exe/ip/porta)', async () => {
    const original = {
      tefHabilitado: true,
      tefProvedor: 'rede',
      tefAmbiente: 'simulacao',
      tefTimeout: 60,
      tefTentativas: 3,
      tipoIntegracao: 'DLL',
      sdkPath: 'TEST_SDK',
      exePath: 'TEST_EXE',
      ipTef: '192.0.2.20',
      portaTef: 4096,
      empresaCodigo: 'EMP01',
      lojaCodigo: 'LJ01',
      terminalCodigo: 'T01',
      pinpadHabilitado: false
    };

    const salva = await tefConfigService.salvarConfiguracao(original);
    const carregada = await tefConfigService.obterConfiguracao();

    assertCamposIguais(original, salva, CAMPOS_GERAL);
    assertCamposIguais(original, carregada, CAMPOS_GERAL);
    assert.strictEqual(carregada._defaultsAplicados, undefined);
  });

  await test('Round-trip configuração servidor (valores de teste controlados)', async () => {
    const original = {
      tefHabilitado: true,
      tefProvedor: 'rede',
      tefAmbiente: 'simulacao',
      tefTimeout: 60,
      tefTentativas: 3,
      empresaCodigo: 'EMP01',
      lojaCodigo: 'LJ01',
      terminalCodigo: 'T01',
      baseUrl: 'TEST_BASE_URL',
      ipServidor: '192.0.2.10',
      portaServidor: 4096,
      clientId: 'TEST_CLIENT_ID',
      clientSecret: 'TEST_CLIENT_SECRET',
      accessToken: 'TEST_ACCESS_TOKEN',
      refreshToken: 'TEST_REFRESH_TOKEN',
      chaveComunicacao: 'TEST_KEY',
      operador: 'TEST_OPERATOR',
      pinpadHabilitado: false
    };

    await tefConfigService.salvarConfiguracao(original);
    const carregada = await tefConfigService.obterConfiguracao();
    assertCamposIguais(original, carregada, CAMPOS_SERVIDOR);

    const server = await tefConfigService.getServerConfig();
    assert.strictEqual(server.baseUrl, 'TEST_BASE_URL');
    assert.strictEqual(server.clientId, 'TEST_CLIENT_ID');
    assert.strictEqual(server.clientSecret, 'TEST_CLIENT_SECRET');
  });

  await test('Round-trip PinPad GERTEC_PPC930 / serial / COM4', async () => {
    const original = {
      tefHabilitado: true,
      tefProvedor: 'rede',
      tefAmbiente: 'simulacao',
      tefTimeout: 60,
      tefTentativas: 3,
      empresaCodigo: 'EMP01',
      lojaCodigo: 'LJ01',
      terminalCodigo: 'T01',
      pinpadHabilitado: true,
      pinpadModelo: 'GERTEC_PPC930',
      pinpadCodigo: 'GERTEC_PPC930',
      fabricante: 'Gertec',
      modelo: 'PPC930',
      tipoConexao: 'serial',
      portaCom: 'COM4',
      pinpadIp: '',
      pinpadPorta: '',
      serial: ''
    };

    await tefConfigService.salvarConfiguracao(original);
    const carregada = await tefConfigService.obterConfiguracao();

    assertCamposIguais(original, carregada, CAMPOS_PINPAD);
    assert.strictEqual(carregada.pinpadModelo, 'GERTEC_PPC930');
    assert.strictEqual(carregada.tipoConexao, 'serial');
    assert.strictEqual(carregada.portaCom, 'COM4');
    assert.strictEqual(carregada.pinpadIp, '');
    assert.strictEqual(carregada.serial, '');

    const pinpad = await tefConfigService.getPinPadConfig();
    assert.strictEqual(pinpad.portaCom, 'COM4');
    assert.strictEqual(pinpad.fabricante, 'Gertec');
    assert.strictEqual(pinpad.modelo, 'PPC930');
  });

  await test('Teste de reinicialização (save → novo load = intacto)', async () => {
    const snapshot = await tefConfigService.obterConfiguracao();

    // Simula "reinício": nova leitura da mesma fonte oficial
    const aposReinicio = await tefConfigService.getConfig();

    assertCamposIguais(snapshot, aposReinicio, [
      ...CAMPOS_GERAL,
      ...CAMPOS_SERVIDOR,
      ...CAMPOS_PINPAD,
      'empresaCodigo', 'lojaCodigo', 'terminalCodigo'
    ]);
  });

  await test('Validação individual empresa/loja/terminal', async () => {
    const resultado = tefConfigService.validarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'rede',
      tefAmbiente: 'simulacao',
      empresaCodigo: 'EMP01',
      lojaCodigo: '',
      terminalCodigo: ''
    });

    assert.strictEqual(resultado.valida, false);
    assert.ok(resultado.pendencias.includes('Código da loja não configurado'));
    assert.ok(resultado.pendencias.includes('Código do terminal não configurado'));
    assert.ok(!resultado.pendencias.includes('Códigos empresa/loja não configurados'));
  });

  await test('Validação em simulação não exige SDK/credenciais', async () => {
    const resultado = tefConfigService.validarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'rede',
      tefAmbiente: 'simulacao',
      empresaCodigo: 'EMP01',
      lojaCodigo: 'LJ01',
      terminalCodigo: 'T01',
      pinpadHabilitado: true,
      pinpadModelo: 'GERTEC_PPC930',
      tipoConexao: 'serial',
      portaCom: 'COM4',
      sdkPath: '',
      clientId: '',
      clientSecret: ''
    });

    assert.strictEqual(resultado.valida, true, resultado.pendencias.join('; '));
    assert.strictEqual(resultado.modoAdapter, 'simulacao');
  });

  await test('Serial físico é opcional (não bloqueia PinPad configurado)', async () => {
    const resultado = tefConfigService.validarConfiguracao({
      tefHabilitado: true,
      tefProvedor: 'rede',
      tefAmbiente: 'simulacao',
      empresaCodigo: 'EMP01',
      lojaCodigo: 'LJ01',
      terminalCodigo: 'T01',
      pinpadHabilitado: true,
      pinpadModelo: 'GERTEC_PPC930',
      tipoConexao: 'serial',
      portaCom: 'COM4',
      serial: ''
    });

    assert.strictEqual(resultado.valida, true, resultado.pendencias.join('; '));
  });

  await test('Adapter Rede continua em modo simulação', async () => {
    const config = await tefConfigService.obterConfiguracao();
    const adapter = RedeAdapter({
      provedor: config.tefProvedor,
      ambiente: config.tefAmbiente
    });
    assert.ok(adapter);
    assert.strictEqual(String(adapter.modo || 'simulacao').toLowerCase(), 'simulacao');
    assert.ok(/rede/i.test(adapter.nome || adapter.adquirente || 'Rede'));
  });

  await test('Defaults não sobrescrevem configuração existente', async () => {
    await tefConfigService.salvarConfiguracao({
      tefHabilitado: false,
      tefProvedor: 'stone',
      tefAmbiente: 'homologacao',
      tefTimeout: 90,
      tefTentativas: 5,
      empresaCodigo: 'X',
      lojaCodigo: 'Y',
      terminalCodigo: 'Z',
      pinpadHabilitado: false
    });

    const carregada = await tefConfigService.obterConfiguracao();
    assert.strictEqual(carregada.tefHabilitado, 'false');
    assert.strictEqual(carregada.tefProvedor, 'stone');
    assert.strictEqual(carregada.tefAmbiente, 'homologacao');
    assert.strictEqual(Number(carregada.tefTimeout), 90);
    assert.strictEqual(Number(carregada.tefTentativas), 5);
  });

  await test('Limpeza: remover dados de teste do banco isolado', async () => {
    const limpou = await repository.limparConfiguracaoCompleta();
    assert.strictEqual(limpou, true);
    const total = await repository.contarConfiguracoes();
    assert.strictEqual(total, 0);
  });

  await new Promise((resolve) => db.close(resolve));

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log(`\n=== RESULTADO TEF-01: ${passou} passou, ${falhou} falhou ===`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal TEF-01:', error);
  process.exit(1);
});
