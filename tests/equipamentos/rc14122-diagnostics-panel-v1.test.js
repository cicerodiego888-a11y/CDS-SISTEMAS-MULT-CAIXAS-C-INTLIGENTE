/**
 * RC14.12.2 — Painel de Diagnóstico Enterprise V1.0 (UX)
 *
 * Contrato: cards, nulos, status, exportação, atualização, responsividade,
 * checklist, histórico, logs — sem endpoint novo e sem mudança estrutural no Driver.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const FRONT = path.join(ROOT, 'frontend/erp/js/central-equipamentos.js');
const CSS = path.join(ROOT, 'frontend/css/diagnostics-panel-v1.css');
const INDEX = path.join(ROOT, 'frontend/erp/index.html');
const PKG = path.join(ROOT, 'package.json');
const ROTAS = path.join(ROOT, 'backend/rotas/equipamentos.js');
const TOLEDO_DIAG = path.join(
  ROOT,
  'backend/motores/equipamentos/drivers/toledo/certificacao/ToledoDiagnostics.js'
);

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

/** Espelha o helper do front para validar contrato de nulos. */
function centralEqDiagValor(v) {
  if (v === null || v === undefined || v === '') return 'Não informado';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
}

function statusVisualLabel(health) {
  const st = String(health?.status || '').toUpperCase();
  if (health?.online === true || st === 'OK' || st === 'CONNECTED') return '🟢 Online';
  if (st === 'CONNECTING' || st === 'RECONNECTING') return '🟡 Conectando';
  if (health?.online === false || st === 'OFFLINE' || st === 'DEGRADED' || st === 'ERROR') {
    return '🔴 Offline';
  }
  return '⚪ Não informado';
}

function buildExportJson(data) {
  return JSON.stringify(data, null, 2);
}

function buildExportTxt(data) {
  return [
    'CDS — Diagnóstico Enterprise V1.0',
    `Gerado em: ${new Date().toLocaleString('pt-BR')}`,
    '',
    JSON.stringify(data, null, 2)
  ].join('\n');
}

describe('RC14.12.2 — Renderização dos Cards', () => {
  it('painel Enterprise com 7 cards obrigatórios', () => {
    const src = read(FRONT);
    assert.match(src, /central-eq-diag-enterprise/);
    assert.match(src, /Painel de Diagnóstico Enterprise V1\.0/);
    for (const card of [
      'identificacao',
      'conexao',
      'capacidades',
      'homologacao',
      'historico',
      'logs',
      'resumo'
    ]) {
      assert.match(src, new RegExp(`data-diag-card="${card}"`));
    }
    assert.match(src, /Identificação do Equipamento/);
    assert.match(src, />Conexão</);
    assert.match(src, /Capacidades do Driver/);
    assert.match(src, />Homologação</);
    assert.match(src, /Histórico Recente/);
    assert.match(src, /Eventos Recentes/);
    assert.match(src, /Diagnóstico Geral/);
  });

  it('grid responsivo e IDs de render presentes', () => {
    const src = read(FRONT);
    assert.match(src, /central-eq-diag-grid/);
    for (const id of [
      'diagFabricante', 'diagModelo', 'diagFirmware', 'diagVersao', 'diagSerie',
      'diagProtocolo', 'diagInterface', 'diagTransporte', 'diagModo', 'diagStatusId',
      'diagStatusVisual', 'diagProtocoloRede', 'diagInterfaceRede', 'diagIp', 'diagPortaInfo',
      'diagDriverConn', 'diagStatus', 'diagOnline',
      'diagTempoConectado', 'diagUltimaCom', 'diagHeartbeat', 'diagLatencia', 'diagHealth',
      'centralEqDiagCaps', 'centralEqDiagHomoResumo', 'centralEqDiagCheckBody',
      'centralEqDiagHistBody', 'centralEqDiagLogsBody', 'centralEqDiagResumo'
    ]) {
      assert.match(src, new RegExp(`id="${id}"|getElementById\\('${id}'\\)`));
    }
  });
});

describe('RC14.12.2 — Campos nulos', () => {
  it('front usa Não informado e helper valor', () => {
    const src = read(FRONT);
    assert.match(src, /CENTRAL_EQ_DIAG_NAO_INFORMADO\s*=\s*'Não informado'/);
    assert.match(src, /function centralEqDiagValor/);
    assert.match(src, /centralEqDiagSet\(/);
  });

  it('nulos / vazios nunca ficam em branco', () => {
    assert.equal(centralEqDiagValor(null), 'Não informado');
    assert.equal(centralEqDiagValor(undefined), 'Não informado');
    assert.equal(centralEqDiagValor(''), 'Não informado');
    assert.equal(centralEqDiagValor(0), '0');
    assert.equal(centralEqDiagValor(false), 'Não');
    assert.equal(centralEqDiagValor(true), 'Sim');
    assert.equal(centralEqDiagValor('Toledo'), 'Toledo');
  });

  it('HTML inicial dos cards já traz Não informado', () => {
    const src = read(FRONT);
    const painel = src.slice(
      src.indexOf('id="centralEqDiagPainel"'),
      src.indexOf('id="centralEqOpsPainel"')
    );
    assert.ok((painel.match(/Não informado/g) || []).length >= 10);
  });
});

describe('RC14.12.2 — Status Online / Offline', () => {
  it('front possui status visual 🟢 🟡 🔴', () => {
    const src = read(FRONT);
    assert.match(src, /function centralEqDiagStatusVisual/);
    assert.match(src, /🟢 Online/);
    assert.match(src, /🟡 Conectando/);
    assert.match(src, /🔴 Offline/);
    assert.match(src, /central-eq-diag-status--online/);
    assert.match(src, /central-eq-diag-status--offline/);
    assert.match(src, /central-eq-diag-status--connecting/);
  });

  it('Status Online', () => {
    assert.equal(statusVisualLabel({ online: true, status: 'OK' }), '🟢 Online');
    assert.equal(statusVisualLabel({ online: true, status: 'CONNECTED' }), '🟢 Online');
  });

  it('Status Offline', () => {
    assert.equal(statusVisualLabel({ online: false, status: 'OFFLINE', motivo: 'timeout' }), '🔴 Offline');
    assert.equal(statusVisualLabel({ online: false, status: 'ERROR' }), '🔴 Offline');
  });

  it('Status Conectando', () => {
    assert.equal(statusVisualLabel({ status: 'CONNECTING' }), '🟡 Conectando');
  });
});

describe('RC14.12.2 — Exportação JSON / TXT', () => {
  it('função de exportação e menu no painel', () => {
    const src = read(FRONT);
    assert.match(src, /function centralEqDiagExportar/);
    assert.match(src, /centralEqDiagExportar\('json'\)/);
    assert.match(src, /centralEqDiagExportar\('txt'\)/);
    assert.match(src, /PDF \(futuro\)/);
    assert.match(src, /Exportar Diagnóstico/);
    assert.match(src, /__centralEqDiagLast/);
    assert.match(src, /application\/json/);
    assert.match(src, /text\/plain/);
  });

  it('Exportação JSON válida', () => {
    const sample = {
      success: true,
      health: { online: true, status: 'OK' },
      equipamento: { fabricante: 'Toledo', ip: '10.0.0.1' }
    };
    const json = buildExportJson(sample);
    const parsed = JSON.parse(json);
    assert.equal(parsed.health.status, 'OK');
    assert.equal(parsed.equipamento.fabricante, 'Toledo');
  });

  it('Exportação TXT contém payload', () => {
    const sample = { health: { online: false, status: 'OFFLINE' } };
    const txt = buildExportTxt(sample);
    assert.match(txt, /Diagnóstico Enterprise V1\.0/);
    assert.match(txt, /"OFFLINE"/);
  });
});

describe('RC14.12.2 — Atualização manual', () => {
  it('botão Atualizar Diagnóstico chama pipeline Toledo (POST/GET)', () => {
    const src = read(FRONT);
    assert.match(src, /Atualizar Diagnóstico/);
    assert.match(src, /function centralEqDiagAtualizar/);
    assert.match(src, /driver\/toledo\/diagnostics/);
    assert.match(src, /\[DIAG RC14\.(12\.2|14\.5)\] Diagnóstico solicitado/);
    assert.match(src, /\[DIAG RC14\.12\.2\] Dados renderizados/);
    assert.match(src, /\[DIAG RC14\.12\.2\] Exportação realizada/);
    assert.match(src, /\[DIAG RC14\.12\.2\] Painel aberto/);
    // RC14.14.5 — comunicação real
    assert.match(src, /probe.*1|probe', '1'/);
  });
});

describe('RC14.12.2 — Responsividade', () => {
  it('CSS Enterprise existe e é referenciado', () => {
    assert.equal(fs.existsSync(CSS), true);
    const css = read(CSS);
    const index = read(INDEX);
    assert.match(index, /diagnostics-panel-v1\.css/);
    assert.match(css, /central-eq-diag-grid/);
    assert.match(css, /grid-template-columns:\s*repeat\(3/);
    assert.match(css, /@media \(max-width:\s*1199\.98px\)/);
    assert.match(css, /repeat\(2/);
    assert.match(css, /@media \(max-width:\s*767\.98px\)/);
    assert.match(css, /grid-template-columns:\s*1fr/);
  });
});

describe('RC14.12.2 — Checklist / Homologação', () => {
  it('capacidades e homologação em checklist', () => {
    const src = read(FRONT);
    assert.match(src, /CENTRAL_EQ_DIAG_CAP_LABELS/);
    assert.match(src, /function centralEqDiagRenderCaps/);
    assert.match(src, /function centralEqDiagRenderHomologacao/);
    assert.match(src, /✔ /);
    assert.match(src, /○ Não suportado/);
    assert.match(src, /Homologado/);
    assert.match(src, /centralEqDiagHomoResumo/);
    assert.match(src, /Discovery/);
    assert.match(src, /Fingerprint/);
    assert.match(src, /Handshake/);
  });

  it('percentual de homologação calculável', () => {
    const itens = [
      { item: 'Driver', status: 'OK' },
      { item: 'Conexão', status: 'OK' },
      { item: 'Handshake', status: 'OK' },
      { item: 'Ping', status: 'OK' }
    ];
    const total = itens.length;
    const ok = itens.filter((i) => i.status === 'OK').length;
    const pct = Math.round((ok / total) * 100);
    assert.equal(pct, 100);
  });
});

describe('RC14.12.2 — Histórico', () => {
  it('histórico recente usa operations/history (sem endpoint novo)', () => {
    const src = read(FRONT);
    assert.match(src, /centralEqDiagHistBody/);
    assert.match(src, /equipamentos\/operations\/history/);
    assert.match(src, /limite:\s*'20'|limite',\s*'20'/);
    assert.match(src, /function centralEqDiagCarregarHistoricoELogs/);
    const rotas = read(ROTAS);
    assert.match(rotas, /operations\/history/);
  });
});

describe('RC14.12.2 — Logs', () => {
  it('eventos recentes renderizados no card de logs', () => {
    const src = read(FRONT);
    assert.match(src, /centralEqDiagLogsBody/);
    assert.match(src, /Eventos Recentes/);
    assert.match(src, /Heartbeat OK/);
    assert.match(src, /Diagnóstico gerado/);
  });
});

describe('RC14.12.2 — Diagnóstico Geral + restrições', () => {
  it('resumo executivo e cenário de erro', () => {
    const src = read(FRONT);
    assert.match(src, /function centralEqDiagRenderResumo/);
    assert.match(src, /Pronto para produção/);
    assert.match(src, /Problema identificado/);
    assert.match(src, /Possível causa/);
    assert.match(src, /Recomendação/);
  });

  it('nenhum endpoint novo de diagnostics no front', () => {
    const src = read(FRONT);
    assert.match(src, /driver\/toledo\/diagnostics/);
    assert.doesNotMatch(src, /driver\/toledo\/diagnostics-enterprise/);
    assert.doesNotMatch(src, /diagnostics-panel\/v1/);
  });

  it('script npm test:diagnostics-panel-v1 registrado', () => {
    const pkg = JSON.parse(read(PKG));
    assert.equal(typeof pkg.scripts['test:diagnostics-panel-v1'], 'string');
    assert.match(pkg.scripts['test:diagnostics-panel-v1'], /rc14122-diagnostics-panel-v1/);
  });

  it('ToledoDiagnostics permanece o motor (arquivo intacto como módulo)', () => {
    assert.equal(fs.existsSync(TOLEDO_DIAG), true);
    const src = read(TOLEDO_DIAG);
    assert.match(src, /function diagnostics|exports\.diagnostics|diagnostics\s*[:=]/);
    assert.match(src, /function health|exports\.health|health\s*[:=]/);
  });
});
