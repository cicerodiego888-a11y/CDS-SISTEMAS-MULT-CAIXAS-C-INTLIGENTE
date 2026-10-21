'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const sqlite3 = require('sqlite3').verbose();

const reportPath = path.resolve(__dirname, '../../docs/build/tef-destaxa-07e-monitor-consistencia-report.json');
const databaseModulePath = require.resolve('../../backend/database');
require.cache[databaseModulePath] = {
  id: databaseModulePath,
  filename: databaseModulePath,
  loaded: true,
  exports: {
    get(sql, params, callback) {
      if (sql.includes('SELECT c.provedor, c.ambiente')) {
        callback(null, monitorDatabaseConfig);
        return;
      }
      if (sql.includes('SELECT p.*')) {
        callback(null, monitorPinpadConfig);
        return;
      }
      throw new Error('Diagnóstico de teste não pode acessar o banco de aplicação.');
    },
    all() {
      throw new Error('Diagnóstico de teste não pode acessar o banco de aplicação.');
    }
  }
};

const repository = require('../../backend/repositories/tefConfigRepository');
const configService = require('../../backend/services/tef/tefConfigService');
const diagnosticService = require('../../backend/services/tef/tefDiagnosticoService');
const monitorService = require('../../backend/services/tef/tefMonitorService');
const tefEvents = require('../../backend/services/tef/tefEvents');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');

const results = [];
const expectedTests = 12;
let database;
let monitorDatabaseConfig = {
  provedor: 'destaxa',
  ambiente: 'homologacao',
  base_url: null,
  ip: null,
  porta: null,
  client_id: null,
  access_token: null
};
let monitorPinpadConfig = null;

function registrarTeste(nome, executar) {
  test(nome, async () => {
    await executar();
    results.push({ nome, sucesso: true });
  });
}

function executarSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, (error) => (error ? reject(error) : resolve()));
  });
}

async function configurarBancoMemoria() {
  database = new sqlite3.Database(':memory:');
  repository.setDatabase(database);

  await executarSql(`
    CREATE TABLE tef_configuracao (
      id INTEGER PRIMARY KEY,
      habilitado INTEGER NOT NULL,
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
      atualizado_em TEXT
    )
  `);
  await executarSql(`
    CREATE TABLE tef_servidores (
      id INTEGER PRIMARY KEY,
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
  await executarSql(`
    CREATE TABLE tef_pinpads (
      id INTEGER PRIMARY KEY,
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
      ativo INTEGER,
      status TEXT,
      ultima_conexao TEXT
    )
  `);
  await executarSql(`
    CREATE TABLE tef_operacoes (
      id INTEGER PRIMARY KEY,
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
  await executarSql('CREATE TABLE tef_configuracoes (chave TEXT, valor TEXT)');
}

async function definirConfiguracao({ provedor, ambiente }) {
  await executarSql('DELETE FROM tef_servidores');
  await executarSql('DELETE FROM tef_pinpads');
  await executarSql('DELETE FROM tef_operacoes');
  await executarSql('DELETE FROM tef_configuracao');
  await executarSql(`
    INSERT INTO tef_configuracao (
      id, habilitado, provedor, ambiente, timeout, tentativas,
      empresa_codigo, loja_codigo, pdv_codigo, terminal_codigo, caixa_codigo,
      tipo_integracao, sdk_path, exe_path, ip_tef, porta_tef
    ) VALUES (1, 1, ?, ?, 60, 1, 'empresa', 'loja', 'pdv', 'terminal', 'caixa',
      'dll', 'C:\\sdk', 'C:\\sdk\\tef.exe', NULL, NULL)
  `, [provedor, ambiente]);
  await executarSql(`
    INSERT INTO tef_pinpads (id, tef_configuracao_id, habilitado)
    VALUES (1, 1, 0)
  `);
}

registrarTeste('servidor Destaxa fica não aplicável sem declarar conexão', async () => {
  const estado = configService.resolverEstadoServidorMonitor('destaxa', 'homologacao', null);
  assert.equal(estado.aplicavel, false);
  assert.equal(estado.estado, 'nao_aplicavel');
  assert.equal(estado.conectado, null);
  assert.match(estado.mensagem, /não comprova conexão transacional/i);
});

registrarTeste('SiTef, PayGo e simulação não exigem servidor HTTP legado', async () => {
  const sitef = configService.resolverEstadoServidorMonitor('sitef', 'homologacao', null);
  const paygo = configService.resolverEstadoServidorMonitor('paygo', 'homologacao', null);
  const simulacao = configService.resolverEstadoServidorMonitor('rede', 'simulacao', null);
  assert.equal(sitef.estado, 'nao_aplicavel');
  assert.equal(paygo.estado, 'nao_aplicavel');
  assert.equal(simulacao.estado, 'opcional_simulacao');
  assert.equal(sitef.conectado, null);
  assert.equal(paygo.conectado, null);
});

registrarTeste('provedores que dependem do servidor preservam estado configurado não testado', async () => {
  const estado = configService.resolverEstadoServidorMonitor('rede', 'homologacao', {
    base_url: 'https://tef.example.invalid',
    ip: null,
    porta: 443
  });
  assert.equal(estado.aplicavel, true);
  assert.equal(estado.estado, 'configurado_nao_testado');
  assert.equal(estado.conectado, null);
});

registrarTeste('teste de configuração aceita Destaxa, SiTef, PayGo e simulação sem servidor', async () => {
  await configurarBancoMemoria();
  for (const configuracao of [
    { provedor: 'destaxa', ambiente: 'homologacao' },
    { provedor: 'sitef', ambiente: 'homologacao' },
    { provedor: 'paygo', ambiente: 'homologacao' },
    { provedor: 'rede', ambiente: 'simulacao' }
  ]) {
    await definirConfiguracao(configuracao);
    const resultado = await configService.testarConexao();
    assert.equal(resultado.sucesso, true, `${configuracao.provedor}/${configuracao.ambiente}`);
    assert.equal(resultado.servidor.conectado, null);
    assert.equal(resultado.testes.find((item) => item.tipo === 'servidor').sucesso, true);
  }
});

registrarTeste('Rede em homologação mantém servidor obrigatório', async () => {
  await definirConfiguracao({ provedor: 'rede', ambiente: 'homologacao' });
  const resultado = await configService.testarConexao();
  assert.equal(resultado.sucesso, false);
  assert.equal(resultado.servidor.estado, 'nao_configurado');
  assert.equal(resultado.testes.find((item) => item.tipo === 'servidor').sucesso, false);
});

registrarTeste('estado oficial do monitor informa Destaxa como não aplicável', async () => {
  await definirConfiguracao({ provedor: 'destaxa', ambiente: 'homologacao' });
  const status = await configService.obterStatus();
  assert.equal(status.provedor, 'destaxa');
  assert.equal(status.servidor.estado, 'nao_aplicavel');
  assert.equal(status.servidor.aplicavel, false);
  assert.equal(status.servidor.conectado, null);
});

registrarTeste('monitoramento periódico usa o mesmo estado contextual do endpoint', async () => {
  monitorDatabaseConfig = {
    provedor: 'destaxa',
    ambiente: 'homologacao',
    base_url: null,
    ip: null,
    porta: null,
    client_id: null,
    access_token: null
  };
  const estado = await monitorService.verificarStatusServidor();
  assert.equal(estado.estado, 'nao_aplicavel');
  assert.equal(estado.aplicavel, false);
  assert.equal(estado.conectado, null);
});

registrarTeste('PinPad configurado não é publicado como online sem teste físico', async () => {
  monitorPinpadConfig = {
    habilitado: 1,
    porta_com: 'COM8',
    ip: null,
    serial: null,
    fabricante: 'Gertec',
    modelo: 'PPC930',
    status: 'online'
  };
  let evento;
  const capturarEvento = (payload) => {
    evento = payload;
  };
  tefEvents.once('pinpad_status', capturarEvento);

  const status = await monitorService.verificarStatusPinpad();

  assert.equal(status.configurado, true);
  assert.equal(status.status, 'configurado_nao_testado');
  assert.equal(evento.status, 'configurado_nao_testado');
  tefEvents.removeListener('pinpad_status', capturarEvento);
});

registrarTeste('Client 00 permanece consistente entre teste e diagnóstico no mesmo bridge', async () => {
  const estado = {
    dllLoaded: true,
    exportsValid: true,
    exports: { iniciaClientDestaxa: true },
    clientInitialized: false,
    clientResultCode: null,
    estado: 'DLL_LOADED'
  };
  let chamadasLoad = 0;
  const bridge = {
    async isLoaded() {
      return true;
    },
    async load() {
      chamadasLoad += 1;
      estado.clientInitialized = false;
    },
    async iniciarClient() {
      estado.clientInitialized = true;
      estado.clientResultCode = '00';
      estado.estado = 'CLIENT_INITIALIZED';
      return {
        sucesso: true,
        codigoDestaxa: '00',
        estado: 'CLIENT_INITIALIZED',
        diagnostico: { ...estado }
      };
    },
    async getDiagnostics() {
      return { ...estado };
    }
  };
  const adapter = new DestaxaRealAdapter({}, { bridge });
  const teste = await adapter.testarConexao();
  const diagnostico = await adapter.diagnosticar();
  const estados = diagnosticService.montarEstadosIntegracao({
    adapterTeste: teste,
    adapterDiag: diagnostico,
    config: {}
  });

  assert.equal(chamadasLoad, 0);
  assert.equal(teste.detalhes.codigoDestaxa, '00');
  assert.equal(estados.client.initialized, true);
  assert.equal(estados.client.snapshotsConsistent, true);
  assert.equal(estados.transactionCommunication.validated, false);
  assert.equal(estados.authorization.available, false);
});

registrarTeste('snapshots divergentes ou ausentes nunca são marcados consistentes', async () => {
  const divergentes = diagnosticService.montarEstadosIntegracao({
    adapterTeste: { detalhes: { clientInitialized: true, codigoDestaxa: '00' } },
    adapterDiag: { detalhes: { clientInitialized: false, clientResultCode: null } }
  });
  const ausentes = diagnosticService.montarEstadosIntegracao({});
  assert.equal(divergentes.client.snapshotsConsistent, false);
  assert.equal(ausentes.client.snapshotsConsistent, false);
});

registrarTeste('DLL, Client, processo e PinPad não inferem comunicação nem autorização', async () => {
  const estados = diagnosticService.montarEstadosIntegracao({
    adapterTeste: { detalhes: { clientInitialized: true, codigoDestaxa: '00' } },
    adapterDiag: {
      detalhes: { dllLoaded: true, exportsValid: true, clientInitialized: true, clientResultCode: '00' }
    },
    sdk: { vspague: { detectado: true, executando: true, responding: true } },
    pinpad: { codigo: 'GERTEC_PPC930', hardware: { detectado: true, porta: 'COM8' } },
    config: { portaCom: 'COM8' }
  });
  assert.equal(estados.dll.loaded, true);
  assert.equal(estados.dll.exportsValidated, true);
  assert.equal(estados.client.initialized, true);
  assert.equal(estados.vspague.running, true);
  assert.equal(estados.pinpad.ppc930Enumerated, true);
  assert.equal(estados.pinpad.comConsistent, true);
  assert.equal(estados.transactionCommunication.validated, false);
  assert.equal(estados.authorization.available, false);
});

registrarTeste('Monitor usa o status contextual do endpoint, sem converter parâmetros em Online', async () => {
  const frontendPath = path.resolve(__dirname, '../../frontend/erp/js/configuracao_tef.js');
  const frontend = fs.readFileSync(frontendPath, 'utf8');
  assert.match(frontend, /Não aplicável/);
  assert.match(frontend, /estadoServidor/);
  assert.match(frontend, /Snapshots do Client consistentes/);
  assert.doesNotMatch(frontend, /servidor\.configurado\s*\?\s*['"]Online['"]/);
  assert.match(frontend, /monitorInternetStatus'\)\.textContent = 'Não verificado'/);
});

function fecharBanco(db) {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }
    db.close((error) => (error ? reject(error) : resolve()));
  });
}

test.after(async () => {
  const sucesso = results.length === expectedTests;
  const report = {
    sprint: 'TEF-DESTAXA-07E',
    status: sucesso ? 'READY_FOR_07F_PRECHECK' : 'BLOCKED_WITH_FINDINGS',
    geradoEm: new Date().toISOString(),
    ambiente: {
      bancoAplicacaoAcessado: false,
      bancoTeste: ':memory:',
      configuracaoClienteAlterada: false,
      hardwareConsultado: false,
      estadoHardware: 'não consultado neste teste; deverá ser avaliado separadamente no precheck'
    },
    indicadorServidor: {
      origem: 'GET /api/tef/status → tefConfiguracaoController.getStatus → tefConfigService.obterStatus().servidor',
      monitorSecundario: 'tefMonitorService.verificarStatusServidor usa resolverEstadoServidorMonitor',
      criterio: 'Parâmetros configurados não são apresentados como conexão online; Destaxa, SiTef e PayGo não dependem do servidor HTTP legado.'
    },
    causaDivergencia: {
      origem: 'diagnosticar() chamava bridge.load() mesmo após testarConexao() inicializar Client 00; load() descarregava/recarregava a DLL e limpava o snapshot do Client.',
      correcao: 'diagnosticar() consulta isLoaded() e só chama load() quando necessário; ambos os snapshots agora são conferidos e divergência/ausência não é marcada consistente.'
    },
    causaStatusPinpad: {
      origem: 'tefMonitorService marcava online quando havia porta, IP ou serial configurados, sem enumeração física.',
      correcao: 'Monitor agora publica configurado_nao_testado ou nao_configurado; enumeração PPC930 permanece exclusiva do diagnóstico Windows.'
    },
    estadosSeparados: {
      dllCarregadaEExportsValidados: 'diagnostico.adapter.detalhes.dllLoaded/exportsValid',
      clientDestaxa: 'diagnostico.adapter.detalhes.clientInitialized/clientResultCode',
      processoVSPague: 'diagnostico.middleware.vspague.detectado/executando/responding',
      ppc930Enumerado: 'diagnostico.pinpad.hardware.detectado; monitor periódico sem enumeração reporta configurado_nao_testado',
      consistenciaCOM: 'diagnostico.estadosIntegracao.pinpad.comConsistent',
      comunicacaoTransacional: 'not_tested sem operação financeira',
      autorizacao: 'indisponível/não comprovada sem transação'
    },
    validacaoRuntime: {
      bridgeNativoOuHostInvocado: false,
      dllRealCarregada: false,
      clientRealInicializado: false,
      processoVSPagueConsultado: false,
      hardwareWindowsConsultado: false,
      observacao: 'Estados e consistência foram exercitados com bridge fake e banco SQLite em memória; confirmar runtime real no precheck 07F.'
    },
    executor: {
      chamadasFinanceirasNativas: [],
      gateFinanceiroAlterado: false,
      transacaoExecutada: false
    },
    testes: {
      total: expectedTests,
      aprovados: results.length,
      falhas: Math.max(expectedTests - results.length, 0),
      resultados: results
    },
    achados: sucesso ? [] : ['Um ou mais testes não concluíram com sucesso; não liberar transação real.']
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  await fecharBanco(database);
});
