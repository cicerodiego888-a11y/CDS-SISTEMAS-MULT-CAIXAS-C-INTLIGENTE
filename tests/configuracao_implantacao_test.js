const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'configuracoes.json');
const BACKUP_PATH = CONFIG_PATH + '.test-backup';

function backupConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
  }
}

function restoreConfig() {
  if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, CONFIG_PATH);
    fs.unlinkSync(BACKUP_PATH);
  }
}

function loadServiceFresh() {
  delete require.cache[require.resolve('../backend/services/configuracaoService')];
  return require('../backend/services/configuracaoService');
}

function testCenario(nome, payload, expect) {
  const service = loadServiceFresh();
  const validation = service.validateConfig(payload);
  assert.strictEqual(validation.valid, expect.valid, `${nome}: validação`);

  if (!expect.valid) {
    return;
  }

  const saved = service.saveConfig(payload);
  const recursos = service.getRecursos(saved).recursos;
  const rede = service.getModoRedeElectron(saved);

  Object.entries(expect.recursos).forEach(([key, value]) => {
    assert.strictEqual(recursos[key], value, `${nome}: recurso ${key}`);
  });

  if (expect.modoRede) {
    assert.strictEqual(rede.modo, expect.modoRede.modo, `${nome}: modo rede`);
    if (expect.modoRede.ipServidor) {
      assert.strictEqual(rede.ipServidor, expect.modoRede.ipServidor, `${nome}: ip rede`);
    }
  }
}

function run() {
  backupConfig();

  try {
    testCenario('ERP Sem Fiscal + Banco Local', {
      tipoImplantacao: 'ERP_SEM_FISCAL',
      modoOperacao: 'LOCAL',
      ipServidor: '',
      porta: 3001
    }, {
      valid: true,
      recursos: {
        fiscal: false,
        multiCaixa: false,
        clienteServidor: false
      },
      modoRede: { modo: 'local' }
    });

    testCenario('ERP Fiscal + Banco Local', {
      tipoImplantacao: 'ERP_FISCAL',
      modoOperacao: 'LOCAL',
      ipServidor: '',
      porta: 3001
    }, {
      valid: true,
      recursos: {
        fiscal: true,
        multiCaixa: false,
        clienteServidor: false
      },
      modoRede: { modo: 'local' }
    });

    testCenario('ERP Multi-Caixa + Cliente/Servidor', {
      tipoImplantacao: 'ERP_MULTICAIXA',
      modoOperacao: 'CLIENTE_SERVIDOR',
      ipServidor: '192.168.0.100',
      porta: 3001
    }, {
      valid: true,
      recursos: {
        fiscal: true,
        multiCaixa: true,
        clienteServidor: true
      },
      modoRede: { modo: 'cliente', ipServidor: '192.168.0.100' }
    });

    const service = loadServiceFresh();
    const invalido = service.validateConfig({
      tipoImplantacao: 'ERP_FISCAL',
      modoOperacao: 'CLIENTE_SERVIDOR',
      ipServidor: '10.0.0.1',
      porta: 3001
    });
    assert.strictEqual(invalido.valid, false, 'ERP Fiscal + Cliente/Servidor deve falhar');

    console.log('OK - todos os cenários de implantação passaram.');
  } finally {
    restoreConfig();
    loadServiceFresh();
  }
}

run();
