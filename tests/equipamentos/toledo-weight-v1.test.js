/**
 * Sprint 14.9 — Testes Motor de Pesagem Toledo V1.0
 */
'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const parser = require('../../backend/motores/equipamentos/drivers/toledo/weight/ToledoWeightParser');
const validator = require('../../backend/motores/equipamentos/drivers/toledo/weight/ToledoWeightValidator');
const ToledoWeightRepository = require('../../backend/motores/equipamentos/drivers/toledo/weight/ToledoWeightRepository');
const ToledoWeightOperation = require('../../backend/motores/equipamentos/drivers/toledo/weight/ToledoWeightOperation');
const { ToledoWeightEngine } = require('../../backend/motores/equipamentos/drivers/toledo/weight/ToledoWeightEngine');
const WeightController = require('../../backend/motores/equipamentos/drivers/toledo/weight/WeightController');
const { WeightService } = require('../../backend/motores/equipamentos/services/WeightService');
const { CODES } = require('../../backend/motores/equipamentos/drivers/toledo/weight/ToledoWeightErrors');
const OperationContext = require('../../backend/motores/equipamentos/drivers/toledo/operations/OperationContext');
const frameBuilder = require('../../backend/motores/equipamentos/drivers/toledo/ToledoFrameBuilder');
const { COMMANDS, RESPONSES } = require('../../backend/motores/equipamentos/drivers/toledo/ToledoProtocol');

function buildPesoFrame(dados = {}) {
  return frameBuilder.buildAck({
    peso: 1.235,
    unidade: 'kg',
    estabilidade: true,
    ...dados
  });
}

function mockDriverOk(peso = 1.235) {
  return {
    host: '10.0.0.170',
    porta: 9000,
    _online: true,
    isOnline() { return true; },
    async connect() { return { status: 'CONNECTED', handshake: true, latencia: 1 }; },
    async sendFrame(buf) { this._lastTx = buf; return buf.length; },
    async receiveFrame() {
      return buildPesoFrame({ peso, unidade: 'kg', estabilidade: true });
    }
  };
}

describe('Weight V1 — Parser', () => {
  it('converte frame Lab V1 em domínio', () => {
    const r = parser.parse(buildPesoFrame());
    assert.equal(r.peso, 1.235);
    assert.equal(r.unidade, 'kg');
    assert.equal(r.estabilidade, true);
    assert.equal(parser.getProtocolProfile().source, 'lab-v1-framing');
  });
});

describe('Weight V1 — Validator', () => {
  it('aceita peso válido e rejeita inválido', () => {
    assert.equal(validator.validate({ peso: 1.2, unidade: 'kg' }).ok, true);
    assert.equal(validator.validate({ peso: -1, unidade: 'kg' }).ok, false);
    assert.equal(validator.validate({ peso: 'x', unidade: 'kg' }).ok, false);
    assert.equal(validator.validate({ peso: 1, unidade: 'lb' }).ok, false);
    assert.throws(() => validator.assertValid({ peso: -0.1, unidade: 'kg' }));
  });

  it('valida checksum / frame completo', () => {
    const ok = buildPesoFrame();
    assert.equal(validator.validateFrame(ok), true);

    const broken = Buffer.from(ok);
    broken[broken.length - 3] = broken[broken.length - 3] ^ 0xff;
    assert.throws(
      () => validator.validateFrame(broken),
      (err) => err.code === CODES.CHECKSUM_ERROR || err.code === CODES.FRAME_INVALID
    );
  });
});

describe('Weight V1 — Operation', () => {
  it('solicita peso e retorna WeightResult', async () => {
    const driver = mockDriverOk(2.5);
    const op = new ToledoWeightOperation({ timeout: 1000 });
    const ctx = new OperationContext({ host: '10.0.0.170', porta: 9000, driver });
    const result = await op.execute(ctx);
    assert.equal(result.success, true);
    assert.equal(result.data.peso, 2.5);
    assert.equal(driver._lastTx.toString('ascii', 1, 3), COMMANDS.READ_WEIGHT);
  });
});

describe('Weight V1 — Repository', () => {
  it('persiste e lista histórico', async () => {
    const repo = new ToledoWeightRepository();
    const id = await repo.registrar({
      equipamento_id: 1,
      peso: 1.235,
      unidade: 'kg',
      estavel: true,
      duracao_ms: 42,
      host: '10.0.0.170',
      porta: 9000
    });
    assert.ok(id);
    const row = await repo.buscarPorId(id);
    assert.equal(Number(row.peso), 1.235);
    const hist = await repo.historico({ limite: 5, host: '10.0.0.170' });
    assert.ok(hist.some((h) => h.id === id));
  });
});

describe('Weight V1 — Engine / Timeout / API', () => {
  it('readOnce com ACK', async () => {
    const engine = new ToledoWeightEngine({
      persistir: false,
      driverFactory: () => mockDriverOk(1.235),
      repository: { async registrar() { return 7; }, async historico() { return []; } }
    });
    const r = await engine.readOnce({ host: '10.0.0.170', porta: 9000, persistir: false });
    assert.equal(r.success, true);
    assert.equal(r.peso, 1.235);
    assert.equal(r.estavel, true);
  });

  it('timeout na leitura', async () => {
    const engine = new ToledoWeightEngine({
      persistir: false,
      driverFactory: () => ({
        host: '10.0.0.170',
        porta: 9000,
        isOnline() { return true; },
        async connect() { return { status: 'CONNECTED' }; },
        async sendFrame() { return 1; },
        async receiveFrame() {
          await new Promise((r) => setTimeout(r, 80));
          return buildPesoFrame();
        }
      }),
      repository: { async registrar() { return null; } }
    });
    await assert.rejects(
      () => engine.readOnce({ host: '10.0.0.170', porta: 9000, timeout: 30, persistir: false }),
      (err) => err.code === CODES.WEIGHT_TIMEOUT || err.code === 'TIMEOUT' || err.statusCode === 408
    );
  });

  it('peso inválido (negativo)', async () => {
    const engine = new ToledoWeightEngine({
      persistir: false,
      driverFactory: () => ({
        isOnline() { return true; },
        async connect() { return {}; },
        async sendFrame() { return 1; },
        async receiveFrame() {
          return buildPesoFrame({ peso: -2, unidade: 'kg', estabilidade: true });
        }
      }),
      repository: { async registrar() { return null; } }
    });
    await assert.rejects(
      () => engine.readOnce({ host: '10.0.0.170', porta: 9000, persistir: false }),
      (err) => err.code === CODES.WEIGHT_NEGATIVE || err.code === CODES.WEIGHT_INVALID
    );
  });

  it('controller API exportado', () => {
    assert.equal(typeof WeightController.read, 'function');
    assert.equal(typeof WeightController.status, 'function');
    assert.equal(typeof WeightController.history, 'function');
  });
});

describe('Weight V1 — WeightService PDV', () => {
  it('prepara quantidade sem auto-read por padrão', async () => {
    const svc = new WeightService({
      config: { autoReadOnPesavel: false },
      engine: {
        async readOnce() {
          return { success: true, peso: 1.1, unidade: 'kg', estabilidade: true };
        }
      }
    });
    const pendente = await svc.prepararQuantidade({ vendido_por_peso: 1 });
    assert.equal(pendente.pesavel, true);
    assert.equal(pendente.pendente, true);
    assert.equal(pendente.quantidade, null);

    const explicito = await svc.prepararQuantidade(
      { vendido_por_peso: 1 },
      { solicitar: true, host: '10.0.0.170', porta: 9000 }
    );
    assert.equal(explicito.quantidade, 1.1);
  });
});

describe('Weight V1 — Checksum no parser', () => {
  it('rejeita frame com checksum inválido', () => {
    const ok = buildPesoFrame();
    const broken = Buffer.from(ok);
    broken[broken.length - 3] ^= 0xaa;
    assert.throws(
      () => parser.parse(broken),
      (err) => err.code === CODES.CHECKSUM_ERROR || err.code === CODES.FRAME_INVALID
    );
    // NAK
    assert.throws(
      () => parser.parse(frameBuilder.build(RESPONSES.NAK, { erro: 'peso' })),
      (err) => err.code === CODES.NACK
    );
  });
});
