/**
 * Sprint 14.11 — Testes Configuration Engine Toledo V1.0
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const mapper = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationMapper');
const validator = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationValidator');
const parser = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationParser');
const profile = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationProfile');
const ToledoConfigurationRepository = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationRepository');
const { ToledoConfigurationEngine } = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationEngine');
const ConfigurationController = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ConfigurationController');
const { CODES } = require('../../backend/motores/equipamentos/drivers/toledo/configuration/ToledoConfigurationErrors');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder');
const { COMMANDS } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol');

const CFG = {
  departamento_padrao: 1,
  casas_decimais: 3,
  unidade: 'kg',
  beep_habilitado: true,
  backlight: true,
  timeout_display_s: 30,
  modo_etiqueta: 'peso',
  serial_number: 'SN-001',
  firmware: '90AX'
};

function mockDriver(cfg = CFG) {
  return {
    host: '10.0.0.170',
    porta: 9000,
    isOnline() { return true; },
    async connect() { return { status: 'CONNECTED' }; },
    async sendFrame(buf) {
      this._lastTx = buf;
      this._lastCmd = buf.toString('ascii', 1, 3);
      return buf.length;
    },
    async receiveFrame() {
      if (this._lastCmd === COMMANDS.CONFIG_WRITE) {
        return frameBuilder.buildAck({
          parametros: { ...CFG, ...(this._writeParams || {}) },
          firmware: '90AX',
          modelo: 'Prix IV Uno'
        });
      }
      return frameBuilder.buildAck({
        parametros: cfg,
        firmware: '90AX',
        modelo: 'Prix IV Uno'
      });
    }
  };
}

describe('Configuration V1 — Profile / Validator / Parser / Mapper', () => {
  it('lista parâmetros suportados com metadados', () => {
    const list = profile.listSupportedParams();
    assert.ok(list.length >= 5);
    assert.equal(profile.isEditable('serial_number'), false);
    assert.equal(profile.isEditable('casas_decimais'), true);
  });

  it('validator aceita e rejeita', () => {
    assert.equal(validator.validate({ casas_decimais: 2, unidade: 'kg' }).ok, true);
    assert.equal(validator.validate({ casas_decimais: 9 }).ok, false);
    assert.equal(validator.validate({ unidade: 'lb' }).ok, false);
    assert.throws(() => validator.assertValid({ serial_number: 'X' }, { writing: true, onlyEditable: true }));
  });

  it('parser interpreta ACK de configuração', () => {
    const raw = frameBuilder.buildAck({ parametros: CFG, firmware: '90AX' });
    const r = parser.parse(raw);
    assert.equal(r.parametros.unidade, 'kg');
    assert.equal(parser.getProtocolProfile().source, 'lab-v1-framing');
  });

  it('mapper diff CDS × Balança', () => {
    const d = mapper.diff(CFG, { ...CFG, casas_decimais: 2, beep_habilitado: false });
    assert.ok(d.alterados.length >= 2);
    assert.ok(d.iguais >= 1);
  });
});

describe('Configuration V1 — Repository / Profiles / Histórico', () => {
  it('salva perfil e histórico', async () => {
    const repo = new ToledoConfigurationRepository();
    const id = await repo.salvarPerfil({
      equipamento_id: 1,
      nome: 'Teste',
      firmware: '90AX',
      modelo: 'Prix IV Uno',
      parametros: CFG,
      host: '10.0.0.170',
      porta: 9000,
      usuario: 'test'
    });
    assert.ok(id);
    const p = await repo.buscarPerfil(id);
    assert.equal(p.parametros.unidade, 'kg');
    await repo.registrarHistorico({
      profile_id: id,
      parametro: 'casas_decimais',
      valor_anterior: '3',
      valor_novo: '2',
      host: '10.0.0.170',
      porta: 9000
    });
    const hist = await repo.historico({ profile_id: id, limite: 10 });
    assert.ok(hist.length >= 1);
    const perfis = await repo.listarPerfis({ host: '10.0.0.170', limite: 5 });
    assert.ok(perfis.some((x) => x.id === id));
  });
});

describe('Configuration V1 — Engine Read/Write/Compare/Restore/API', () => {
  let engine;
  let driver;

  beforeEach(() => {
    driver = mockDriver();
    engine = new ToledoConfigurationEngine({
      persistir: false,
      driverFactory: () => driver,
      repository: {
        async salvarPerfil() { return 11; },
        async buscarPerfil(id) {
          return {
            id: Number(id),
            nome: 'Backup',
            firmware: '90AX',
            modelo: 'Prix IV Uno',
            parametros: { ...CFG, casas_decimais: 2 },
            host: '10.0.0.170',
            porta: 9000
          };
        },
        async registrarHistorico() { return 1; },
        async historico() {
          return [{ id: 1, parametro: 'casas_decimais', valor_novo: '2' }];
        },
        async listarPerfis() { return [{ id: 11, nome: 'Backup' }]; }
      }
    });
  });

  it('read', async () => {
    const r = await engine.read({ host: '10.0.0.170', porta: 9000, persistir: false, salvarPerfil: false });
    assert.equal(r.success, true);
    assert.equal(r.parametros.casas_decimais, 3);
    assert.equal(driver._lastTx.toString('ascii', 1, 3), COMMANDS.CONFIG_READ);
  });

  it('write', async () => {
    await engine.read({ host: '10.0.0.170', porta: 9000, persistir: false, salvarPerfil: false });
    const r = await engine.write({
      host: '10.0.0.170',
      porta: 9000,
      parametros: { casas_decimais: 2, beep_habilitado: false },
      persistir: true
    });
    assert.equal(r.success, true);
    assert.equal(r.escritos.casas_decimais, 2);
    assert.equal(driver._lastTx.toString('ascii', 1, 3), COMMANDS.CONFIG_WRITE);
  });

  it('compare', async () => {
    const r = await engine.compare({
      balanca: { parametros: CFG },
      cds: { parametros: { ...CFG, unidade: 'g' } }
    });
    assert.equal(r.success, true);
    assert.ok(r.comparacao.alterados.some((a) => a.parametro === 'unidade'));
  });

  it('restore', async () => {
    const r = await engine.restore({
      profileId: 11,
      host: '10.0.0.170',
      porta: 9000,
      persistir: false
    });
    assert.equal(r.success, true);
  });

  it('export / import / history / API', async () => {
    await engine.read({ host: '10.0.0.170', porta: 9000, persistir: false, salvarPerfil: false });
    const exp = await engine.export({});
    assert.ok(exp.perfil.parametros);
    const imp = await engine.import({ perfil: exp.perfil, persistir: true });
    assert.equal(imp.success, true);
    const hist = await engine.history({ limite: 5 });
    assert.ok(hist.length >= 1);
    assert.equal(typeof ConfigurationController.read, 'function');
    assert.equal(typeof ConfigurationController.write, 'function');
    assert.equal(typeof ConfigurationController.compare, 'function');
    assert.equal(typeof ConfigurationController.restore, 'function');
    assert.equal(typeof ConfigurationController.history, 'function');
  });

  it('rejeita parâmetro desconhecido na escrita', async () => {
    await assert.rejects(
      () => engine.write({
        host: '10.0.0.170',
        porta: 9000,
        parametros: { foo_bar: 1 },
        persistir: false
      }),
      (err) => err.code === CODES.UNKNOWN_PARAM || err.code === CODES.INVALID_INPUT
    );
  });
});
