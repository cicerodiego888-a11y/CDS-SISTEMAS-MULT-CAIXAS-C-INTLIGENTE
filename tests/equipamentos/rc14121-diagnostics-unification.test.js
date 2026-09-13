/**
 * RC14.12.1 — Unificação do Diagnóstico (Central → Toledo V2)
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  diagnostics,
  health,
  resetStatsForTests
} = require('../../backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics');

const FRONT = path.join(__dirname, '../../frontend/erp/js/central-equipamentos.js');
const CENTRAL_SVC = path.join(
  __dirname,
  '../../backend/motores/equipamentos/central/CentralEquipamentosService.js'
);
const CENTRAL_CTRL = path.join(
  __dirname,
  '../../backend/controllers/centralEquipamentosController.js'
);

describe('RC14.12.1 — pipeline único no código', () => {
  it('front: linha abre painel e renderiza payload (não só toast)', () => {
    const src = fs.readFileSync(FRONT, 'utf8');
    assert.match(src, /function centralEqDiagnostico/);
    assert.match(src, /centralEqDiagAbrirPainel/);
    assert.match(src, /centralEqDiagRenderizar/);
    assert.match(src, /centralEqFetch\(`\/\$\{id\}\/diagnostico`/);
    // toast genérico isolado (sem painel) não pode ser o único destino
    assert.doesNotMatch(
      src,
      /await centralEqFetch\(`\/\$\{id\}\/diagnostico`[\s\S]{0,120}showNotification\('Diagnóstico concluído'/
    );
  });

  it('front: toolbar e linha compartilham render oficial', () => {
    const src = fs.readFileSync(FRONT, 'utf8');
    assert.match(src, /function centralEqMostrarDiag/);
    assert.match(src, /centralEqDiagAtualizar/);
    assert.match(src, /driver\/toledo\/diagnostics/);
    assert.match(src, /centralEqDiagRenderizar\(body\)/);
    assert.match(src, /centralEqDiagRenderizar\(payload\)/);
  });

  it('front: painel cobre campos obrigatórios', () => {
    const src = fs.readFileSync(FRONT, 'utf8');
    for (const id of [
      'diagDriver', 'diagVersao', 'diagFabricante', 'diagModelo', 'diagFirmware',
      'diagSerie', 'diagIp', 'diagPortaInfo', 'diagStatus', 'diagOnline',
      'diagHeartbeat', 'diagLatencia', 'diagUptime', 'diagTempoConectado',
      'diagUltimaCom', 'diagErro', 'diagTimestamp', 'diagHealth',
      'centralEqDiagCaps', 'centralEqDiagCheckBody', 'centralEqDiagOffline'
    ]) {
      assert.match(src, new RegExp(id));
    }
    assert.match(src, /Não informado/);
  });

  it('CentralService delega ao ToledoDiagnostics (sem lógica própria de ping)', () => {
    const src = fs.readFileSync(CENTRAL_SVC, 'utf8');
    assert.match(src, /ToledoDiagnostics/);
    assert.match(src, /diagnostics\(/);
    assert.doesNotMatch(src, /EthernetTransport/);
    assert.doesNotMatch(src, /diagnosticarEquipamento/);
  });

  it('Controller apenas encaminha', () => {
    const src = fs.readFileSync(CENTRAL_CTRL, 'utf8');
    assert.match(src, /central\.diagnosticar/);
    assert.match(src, /RC14\.12\.1/);
  });
});

describe('RC14.12.1 — Driver Toledo diagnostics', () => {
  before(() => resetStatsForTests());

  it('payload completo (sem host)', async () => {
    const d = await diagnostics({});
    assert.equal(d.success, true);
    assert.ok(d.version?.driver);
    assert.ok(d.equipamento?.modelo);
    assert.ok(d.equipamento?.firmware);
    assert.ok(d.capabilities);
    assert.ok(d.health);
    assert.ok(d.checklist);
    assert.ok(d.generatedAt);
    assert.equal(d.health.status === 'OK' || d.health.status === 'OFFLINE', true);
  });

  it('payload parcial enriquecido com equipamento cadastrado', async () => {
    const d = await diagnostics({
      host: '10.0.0.50',
      porta: 9000,
      probe: false,
      equipamento: {
        fabricante: 'Toledo',
        modelo: 'Prix IV Uno',
        firmware: '90AX-TEST',
        numero_serie: 'SN-123',
        ultima_comunicacao: '2026-08-05T12:00:00',
        driver_codigo: 'TOLEDO_PRIX4_UNO',
        ip: '10.0.0.50',
        porta_tcp: 9000
      }
    });
    assert.equal(d.equipamento.numero_serie, 'SN-123');
    assert.equal(d.equipamento.ip, '10.0.0.50');
    assert.equal(d.equipamento.porta, 9000);
    assert.equal(d.equipamento.firmware, '90AX-TEST');
    assert.equal(d.equipamento.ultima_comunicacao, '2026-08-05T12:00:00');
  });

  it('equipamento offline / host sem conexão no pool', async () => {
    const h = health({ host: '10.255.255.1', porta: 9000 });
    assert.equal(h.online, false);
    assert.equal(h.status, 'OFFLINE');
    assert.ok(h.motivo);
    assert.match(String(h.motivo), /Sessão ausente|OFFLINE|não testado/i);
    const d = await diagnostics({ host: '10.255.255.1', porta: 9000, probe: false });
    assert.equal(d.health.status, 'OFFLINE');
    assert.ok(d.health.motivo);
  });

  it('host inválido ainda retorna relatório estruturado', async () => {
    const d = await diagnostics({ host: 'nao-e-ip', porta: 1, probe: false });
    assert.equal(d.success, true);
    assert.equal(d.equipamento.ip, 'nao-e-ip');
    assert.equal(d.health.online, false);
  });

  it('driver / versão sempre presentes', async () => {
    const d = await diagnostics({});
    assert.ok(d.version.driver);
    assert.ok(d.version.driverVersion);
    assert.ok(d.equipamento.driver || d.version.driver);
  });
});

describe('RC14.12.1 — renderização (contrato front)', () => {
  it('helper Não informado cobre nulos', () => {
    const src = fs.readFileSync(FRONT, 'utf8');
    assert.match(src, /CENTRAL_EQ_DIAG_NAO_INFORMADO\s*=\s*'Não informado'/);
    assert.match(src, /function centralEqDiagValor/);
  });

  it('offline exibe status e motivo no painel', () => {
    const src = fs.readFileSync(FRONT, 'utf8');
    assert.match(src, /centralEqDiagOffline/);
    assert.match(src, /centralEqDiagRenderEtapas|diagEtapasConexao/);
    assert.match(src, /etapaFalha|etapas_conexao/);
  });

  it('toolbar e linha não descartam payload', () => {
    const src = fs.readFileSync(FRONT, 'utf8');
    assert.match(src, /centralEqDiagRenderizar\(body\)/);
    assert.match(src, /centralEqDiagRenderizar\(payload\)/);
  });
});
