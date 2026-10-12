/**
 * Sprint 3.5 — Tratamento amigável do aviso SEFAZ "Consumo Indevido" (656).
 * Somente apresentação: evento, notificação interna, Gate e cooldown permanecem.
 *
 * Executar: node --test tests/central-entradas/sprint35-aviso-consumo-indevido.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
  writable: true
});

const root = path.join(__dirname, '../..');
const UX = require(path.join(root, 'frontend/erp/js/central-entradas-ux.js'));
const mainSrc = fs.readFileSync(path.join(root, 'frontend/erp/js/central-entradas.js'), 'utf8');
const { CentralSyncExecucaoService } = require(
  path.join(root, 'backend/motores/central-entradas/services/CentralSyncExecucaoService')
);
const CentralNotificacoesService = require(
  path.join(root, 'backend/motores/central-entradas/services/CentralNotificacoesService')
);
const gate = require(path.join(root, 'backend/motores/central-entradas/services/CentralSefazOperationalGate'));
const { TIPOS_EVENTO } = require(path.join(root, 'backend/motores/central-entradas/config/centralEventosTipos'));

const MSG_656 = 'Rejeição: Consumo Indevido';
const MSG_OUTRO = 'Rejeição: Certificado digital inválido';
const TEXTO_TECNICO = /Consumo Indevido|Rejei[cç][aã]o|656|Erro na sincroniza/i;

function extrairFuncao(nome) {
  const inicio = mainSrc.search(new RegExp(`(async )?function ${nome}\\(`));
  assert.ok(inicio >= 0, `função ${nome} não encontrada`);
  const fim = mainSrc.slice(inicio).search(/\r?\n\}\r?\n/);
  return mainSrc.slice(inicio, inicio + fim) + '\n}\n';
}

function criarContexto(extra = {}) {
  const toasts = [];
  const chamadas = [];
  const ctx = {
    toasts,
    chamadas,
    UX,
    document: { getElementById: () => ({}) },
    centralEntradasState: { notificacoesVistas: new Set(), eventosRodape: [], ...(extra.state || {}) },
    showNotification: (msg, tipo) => toasts.push({ msg, tipo }),
    centralUx: () => UX,
    escapeHtmlCentralEntradas: (v) => String(v == null ? '' : v),
    renderCabecalhoUx1Central: () => {},
    atualizarIndicadorSyncBotao: () => {},
    carregarDashboardCentral: async () => {},
    carregarDocumentosCentral: async () => {},
    carregarStatusServicoCentral: async () => {},
    centralEntradasFetch: async (p, opts = {}) => {
      chamadas.push({ path: p, method: opts.method || 'GET' });
      if (extra.fetch) return extra.fetch(p, opts);
      return {};
    }
  };
  vm.createContext(ctx);
  return ctx;
}

function carregar(ctx, nome) {
  vm.runInContext(`${extrairFuncao(nome)}\nthis.__fn = ${nome};`, ctx);
  return ctx.__fn;
}

describe('Sprint 3.5 — detecção de consumo indevido', () => {
  it('reconhece xMotivo, código interno e cStat 656', () => {
    assert.equal(UX.ehConsumoIndevidoSefazUx(MSG_656), true);
    assert.equal(UX.ehConsumoIndevidoSefazUx('CONSUMO_INDEVIDO'), true);
    assert.equal(UX.ehConsumoIndevidoSefazUx('', '656'), true);
  });

  it('não confunde outros erros (nem NSU com dígitos 656)', () => {
    assert.equal(UX.ehConsumoIndevidoSefazUx(MSG_OUTRO), false);
    assert.equal(UX.ehConsumoIndevidoSefazUx('Falha de comunicação NSU 000000000000656'), false);
    assert.equal(UX.ehConsumoIndevidoSefazUx('', '137'), false);
  });
});

describe('Sprint 3.5 — painel de status do serviço', () => {
  it('656 sem cooldown ativo: indicação discreta, sem erro e sem prazo fixo', () => {
    const est = UX.resolverEstadoServicoCentral({
      servicoStatus: {
        syncAutomaticaHabilitada: true,
        ultimoResultado: { sucesso: false, cStat: '656', mensagem: MSG_656 }
      }
    });
    assert.equal(est.codigo, 'sefaz_retomada');
    assert.equal(est.descricao, 'Sincronização automática será retomada quando disponível.');
    assert.notEqual(est.classe, 'central-ux-servico--erro');
    assert.doesNotMatch(`${est.label} ${est.descricao}`, TEXTO_TECNICO);
    assert.doesNotMatch(est.descricao, /\d/);
  });

  it('656 apenas no texto (sem cStat) também é amigável', () => {
    const est = UX.resolverEstadoServicoCentral({
      servicoStatus: { ultimoResultado: { sucesso: false, erros: [MSG_656] } }
    });
    assert.equal(est.codigo, 'sefaz_retomada');
  });

  it('cooldown ativo continua prevalecendo (proteção preservada)', () => {
    const restante = 30 * 60 * 1000;
    const ate = new Date(Date.now() + restante).toISOString();
    const est = UX.resolverEstadoServicoCentral({
      sincronizacaoNsu: { ultNsu: '000000000000428', ultimoCstat: '656', cooldownAte: ate },
      sefazOperacional: {
        ultimoCStat: '656',
        proximaConsulta: ate,
        tempoRestanteMs: restante,
        bloqueio656: { ativo: true, cStat: '656', bloqueadoAte: ate }
      },
      servicoStatus: { ultimoResultado: { sucesso: false, cStat: '656', mensagem: MSG_656 } }
    });
    assert.equal(est.codigo, 'cooldown_656');
  });

  it('outros erros continuam como "Erro na última execução" com a mensagem original', () => {
    const est = UX.resolverEstadoServicoCentral({
      servicoStatus: { ultimoResultado: { sucesso: false, mensagem: MSG_OUTRO } }
    });
    assert.equal(est.codigo, 'erro');
    assert.equal(est.label, 'Erro na última execução');
    assert.equal(est.descricao, MSG_OUTRO);
    assert.equal(est.classe, 'central-ux-servico--erro');
  });
});

describe('Sprint 3.5 — toast de notificações (pollNotificacoesCentral)', () => {
  function notificacoes() {
    return [
      { id: 1, tipo: 'SYNC_ERRO', titulo: 'Erro na sincronização', mensagem: MSG_656 },
      { id: 2, tipo: 'SYNC_ERRO', titulo: 'Erro na sincronização', mensagem: MSG_OUTRO }
    ];
  }

  it('consumo indevido não gera toast; outro erro segue vermelho como antes', async () => {
    const ctx = criarContexto({
      fetch: (p) => (p.startsWith('/notificacoes?') ? { notificacoes: notificacoes(), total: 2 } : {})
    });
    await carregar(ctx, 'pollNotificacoesCentral')();

    assert.equal(ctx.toasts.length, 1);
    assert.equal(ctx.toasts[0].tipo, 'danger');
    assert.equal(ctx.toasts[0].msg, `Erro na sincronização: ${MSG_OUTRO}`);
    assert.ok(ctx.toasts.every((t) => !/Consumo Indevido/i.test(t.msg)));

    const lidas = ctx.chamadas.filter((c) => c.method === 'PATCH').map((c) => c.path).sort();
    assert.deepEqual(lidas, ['/notificacoes/1/lida', '/notificacoes/2/lida']);
  });
});

describe('Sprint 3.5 — feed de atividade', () => {
  it('evento SYNC_ERRO 656 aparece com texto amigável; demais inalterados', () => {
    const ctx = criarContexto({
      state: {
        eventosRodape: [
          { tipo: 'SYNC_ERRO', descricao: MSG_656, detalhe: { cStat: '656' }, createdAt: '2026-10-10T10:00:00Z' },
          { tipo: 'SYNC_ERRO', descricao: MSG_OUTRO, createdAt: '2026-10-10T09:00:00Z' }
        ]
      }
    });
    const html = carregar(ctx, 'renderAtividadeRodapeUx1')();
    assert.doesNotMatch(html, /Consumo Indevido/i);
    assert.match(html, /Sincronização automática será retomada quando disponível\./);
    assert.match(html, /fa-clock/);
    assert.match(html, new RegExp(MSG_OUTRO));
    assert.match(html, /fa-exclamation-triangle/);
  });
});

describe('Sprint 3.5 — sincronização manual', () => {
  it('retorno 656 mostra aviso informativo sem texto técnico', async () => {
    const ctx = criarContexto({
      fetch: (p) => (p === '/sincronizar'
        ? { sucesso: false, cStat: '656', mensagem: MSG_656, mensagemAmigavel: MSG_656 }
        : {})
    });
    await carregar(ctx, 'sincronizarCentralEntradas')();
    assert.equal(ctx.toasts.length, 1);
    assert.equal(ctx.toasts[0].tipo, 'info');
    assert.doesNotMatch(ctx.toasts[0].msg, TEXTO_TECNICO);
  });

  it('exceção com consumo indevido também é amigável; outra exceção segue "danger"', async () => {
    const ctx656 = criarContexto({ fetch: () => { throw new Error(MSG_656); } });
    await carregar(ctx656, 'sincronizarCentralEntradas')();
    assert.equal(ctx656.toasts[0].tipo, 'info');
    assert.doesNotMatch(ctx656.toasts[0].msg, TEXTO_TECNICO);

    const ctxOutro = criarContexto({ fetch: () => { throw new Error(MSG_OUTRO); } });
    await carregar(ctxOutro, 'sincronizarCentralEntradas')();
    assert.equal(ctxOutro.toasts[0].tipo, 'danger');
    assert.equal(ctxOutro.toasts[0].msg, `Erro ao sincronizar: ${MSG_OUTRO}`);
  });

  it('cooldown ativo continua bloqueando nova consulta (sem chamar /sincronizar)', async () => {
    const restante = 30 * 60 * 1000;
    const ate = new Date(Date.now() + restante).toISOString();
    const ctx = criarContexto({
      state: {
        sincronizacaoNsu: { ultNsu: '000000000000428', ultimoCstat: '656', cooldownAte: ate },
        sefazOperacional: {
          ultimoCStat: '656',
          proximaConsulta: ate,
          tempoRestanteMs: restante,
          bloqueio656: { ativo: true, cStat: '656', bloqueadoAte: ate }
        }
      }
    });
    await carregar(ctx, 'sincronizarCentralEntradas')();
    assert.equal(ctx.chamadas.filter((c) => c.path === '/sincronizar').length, 0);
  });
});

describe('Sprint 3.5 — backend: registro interno e Gate preservados', () => {
  async function executarCom(resultadoSefaz) {
    const eventos = [];
    const inseridas = [];
    const gateChamadas = [];
    const original = gate.processarRespostaSefaz;
    gate.processarRespostaSefaz = async (res) => { gateChamadas.push(res); return null; };
    try {
      const sync = new CentralSyncExecucaoService({
        sincronizacaoService: { sincronizar: async () => ({ ...resultadoSefaz }) },
        configuracaoService: {
          obterContextoOperacional: async () => ({ ok: false }),
          obterResumo: async () => ({ syncMaxDocumentos: 5, notificarNovasNotas: true }),
          verificarHorarioPermitido: async () => ({ permitido: true })
        },
        nsuRepository: { buscarPorCnpjAmbiente: async () => null },
        notificacoesService: new CentralNotificacoesService({
          notificacoesRepository: { inserir: async (d) => { inseridas.push(d); return d; } }
        }),
        emitirEvento: async (ev) => { eventos.push(ev); return null; }
      });
      const r = await sync.executar({ origem: 'background', ignorarCooldown: true, ignorarBloqueio656: true, ignorarHorario: true });
      return { r, eventos, inseridas, gateChamadas };
    } finally {
      gate.processarRespostaSefaz = original;
    }
  }

  it('656: Gate recebe a resposta, evento SYNC_ERRO e notificação interna seguem registrados', async () => {
    const { r, eventos, inseridas, gateChamadas } = await executarCom({
      sucesso: false, cStat: '656', mensagem: MSG_656, ultNsu: '428'
    });
    assert.equal(gateChamadas.length, 1);
    assert.equal(gateChamadas[0].cStat, '656');
    assert.equal(r.gateProcessado, true);

    const erro = eventos.find((e) => e.tipo === TIPOS_EVENTO.SYNC_ERRO);
    assert.ok(erro, 'evento SYNC_ERRO deve continuar registrado');
    assert.equal(erro.descricao, MSG_656);
    assert.equal(erro.detalhe.cStat, '656');

    assert.equal(inseridas.length, 1);
    assert.equal(inseridas[0].tipo, 'SYNC_ERRO');
    assert.equal(inseridas[0].mensagem, MSG_656);
  });

  it('outro erro mantém o mesmo registro de antes', async () => {
    const { eventos, inseridas } = await executarCom({ sucesso: false, cStat: '280', mensagem: MSG_OUTRO });
    assert.ok(eventos.some((e) => e.tipo === TIPOS_EVENTO.SYNC_ERRO && e.descricao === MSG_OUTRO));
    assert.equal(inseridas[0].tipo, 'SYNC_ERRO');
    assert.equal(inseridas[0].titulo, 'Erro na sincronização');
    assert.equal(inseridas[0].mensagem, MSG_OUTRO);
  });
});
