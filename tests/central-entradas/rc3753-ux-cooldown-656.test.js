/**
 * RC3.7.5.3 — UX do cooldown 656 (pós AUTO_SYNC_NSU).
 * Somente apresentação: não altera regras de negócio.
 *
 * Executar: node --test tests/central-entradas/rc3753-ux-cooldown-656.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const UX = require(path.join(root, 'frontend/erp/js/central-entradas-ux.js'));
const mainSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/central-entradas.js'), 'utf8');
const dashSrc = fs.readFileSync(
  path.join(root, 'backend/motores/central-entradas/services/CentralDashboardService.js'),
  'utf8'
);

const AGORA = new Date('2026-07-30T21:41:00.000Z').getTime();
const COOLDOWN_ATE = '2026-07-30T22:23:55.715Z';

function stateCooldownRecuperado(extra = {}) {
  return {
    sincronizando: false,
    sincronizacaoNsu: {
      ultNsu: '000000000000428',
      maxNsu: '000000000000000',
      ultimoCstat: '656',
      cooldownAte: COOLDOWN_ATE
    },
    sefazOperacional: {
      ultimoCStat: '656',
      proximaConsulta: COOLDOWN_ATE,
      tempoRestanteMs: new Date(COOLDOWN_ATE).getTime() - AGORA,
      bloqueio656: { ativo: true, cStat: '656', bloqueadoAte: COOLDOWN_ATE },
      estadoOperacional: { codigo: 'BLOCKED', label: 'Bloqueado', indicador: '🟠' }
    },
    servicoStatus: {
      executando: false,
      syncAutomaticaHabilitada: true,
      ultimoResultado: {
        sucesso: false,
        cStat: '656',
        mensagem: 'Consumo Indevido (656)'
      }
    },
    ...extra
  };
}

describe('RC3.7.5.3 — resolverCooldownSefaz656Ux', () => {
  it('ativo quando 656 + NSU recuperado + cooldown futuro', () => {
    const cd = UX.resolverCooldownSefaz656Ux(stateCooldownRecuperado(), AGORA);
    assert.equal(cd.ativo, true);
    assert.equal(cd.autoSyncNsu, true);
    assert.equal(cd.label, 'AGUARDANDO COOLDOWN DA SEFAZ');
    assert.equal(cd.indicador, '🟡');
    assert.equal(cd.descricao, 'Aguardando liberação da SEFAZ');
    assert.match(cd.tooltipSync, /bloqueia novas consultas/i);
    assert.ok(cd.restanteMs > 0);
    assert.match(cd.restanteLabel, /minuto/);
  });

  it('inativo quando NSU zerado (sem AUTO_SYNC efetivo)', () => {
    const state = stateCooldownRecuperado({
      sincronizacaoNsu: {
        ultNsu: '000000000000000',
        ultimoCstat: '656',
        cooldownAte: COOLDOWN_ATE
      }
    });
    const cd = UX.resolverCooldownSefaz656Ux(state, AGORA);
    assert.equal(cd.ativo, false);
  });

  it('inativo após expiração do cooldown', () => {
    const depois = new Date(COOLDOWN_ATE).getTime() + 1000;
    const cd = UX.resolverCooldownSefaz656Ux(stateCooldownRecuperado(), depois);
    assert.equal(cd.ativo, false);
  });
});

describe('RC3.7.5.3 — estado de serviço não é ERRO', () => {
  it('exibe AGUARDANDO COOLDOWN em vez de Erro na última execução', () => {
    const estado = UX.resolverEstadoServicoCentral(stateCooldownRecuperado());
    // Congela o "agora" do helper interno via state já com tempos futuros relativos a Date.now
    // Reavalia com clock controlado:
    const cd = UX.resolverCooldownSefaz656Ux(stateCooldownRecuperado(), AGORA);
    assert.equal(cd.ativo, true);

    // Simula Date.now ≈ AGORA ajustando cooldownAte relativo ao wall clock do teste
    const restante = 42 * 60 * 1000;
    const ate = new Date(Date.now() + restante).toISOString();
    const live = stateCooldownRecuperado({
      sincronizacaoNsu: {
        ultNsu: '000000000000428',
        ultimoCstat: '656',
        cooldownAte: ate
      },
      sefazOperacional: {
        ultimoCStat: '656',
        proximaConsulta: ate,
        tempoRestanteMs: restante,
        bloqueio656: { ativo: true, cStat: '656', bloqueadoAte: ate },
        estadoOperacional: { codigo: 'BLOCKED', label: 'Bloqueado', indicador: '🟠' }
      }
    });
    const est = UX.resolverEstadoServicoCentral(live);
    assert.equal(est.codigo, 'cooldown_656');
    assert.equal(est.label, 'AGUARDANDO COOLDOWN DA SEFAZ');
    assert.doesNotMatch(est.label, /Erro/i);
    assert.equal(est.classe, 'central-ux-servico--cooldown');
  });
});

describe('RC3.7.5.3 — painel SEFAZ', () => {
  it('renderiza estado de cooldown e não "Bloqueado" como erro', () => {
    const restante = 42 * 60 * 1000;
    const ate = new Date(Date.now() + restante).toISOString();
    const html = UX.renderPainelSaudeSefazCentral(
      {
        ultimoCStat: '656',
        proximaConsulta: ate,
        tempoRestanteMs: restante,
        bloqueio656: { ativo: true, cStat: '656', bloqueadoAte: ate },
        estadoOperacional: { codigo: 'BLOCKED', label: 'Bloqueado', indicador: '🟠' }
      },
      {
        sincronizacaoNsu: {
          ultNsu: '000000000000428',
          ultimoCstat: '656',
          cooldownAte: ate
        }
      }
    );
    assert.match(html, /AGUARDANDO COOLDOWN DA SEFAZ/);
    assert.match(html, /Aguardando liberação da SEFAZ/);
    assert.match(html, /Próxima tentativa/);
    assert.match(html, /Tempo restante/);
  });
});

describe('RC3.7.5.3 — wiring', () => {
  it('dashboard expõe ultimoCstat e cooldownAte para UX', () => {
    assert.match(dashSrc, /ultimoCstat/);
    assert.match(dashSrc, /cooldownAte/);
    assert.match(dashSrc, /RC3\.7\.5\.3/);
  });

  it('botão Sincronizar respeita cooldown (disabled + tooltip)', () => {
    assert.match(mainSrc, /resolverCooldownSefaz656Ux/);
    assert.match(mainSrc, /A SEFAZ bloqueia novas consultas durante o período de espera/);
    assert.match(mainSrc, /central-ux1-cooldown-banner/);
  });
});
