/**
 * TEF-14 — Gestão segura de pendências órfãs (sem TX real / sem banco oficial).
 * Executar: node tests/tef/tef-14-pendencias-orfas.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const svc = require('../../backend/services/tef/tefPendenciasService');

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

function criarManagerMock(opcoes = {}) {
  const pendencias = new Map(opcoes.travas || []);
  return {
    async garantirRecuperacao() {
      return true;
    },
    obterTravaResultadoTardio() {
      const [primeira] = pendencias.values();
      if (!primeira) return null;
      return {
        ...primeira,
        pendentes: [...pendencias.keys()]
      };
    },
    listarTravasPendencias() {
      return [...pendencias.entries()].map(([id, t]) => ({
        transacaoId: String(id),
        ...t
      }));
    },
    reconciliarResultadoTardio(transacaoId, dados) {
      const trava = pendencias.get(String(transacaoId));
      if (!trava) {
        const e = new Error('sem trava');
        e.code = 'TEF_RECONCILIACAO_SEM_TRAVA';
        throw e;
      }
      if (trava.estado === 'AGUARDANDO_RESULTADO_TARDIO') {
        const e = new Error('prematura');
        e.code = 'TEF_RECONCILIACAO_PREMATURA';
        throw e;
      }
      if (!dados.usuario || !dados.observacao) {
        const e = new Error('usuario/obs');
        e.code = 'TEF_RECONCILIACAO_INVALIDA';
        throw e;
      }
      pendencias.delete(String(transacaoId));
      return {
        transacaoId: String(transacaoId),
        status: dados.financialState === 'CONFIRMED_SUCCESS' ? 'aprovado' : 'negado',
        financialState: dados.financialState,
        travaLiberada: true
      };
    },
    _pendencias: pendencias
  };
}

async function main() {
  console.log('\n=== TEF-14 pendências órfãs ===\n');

  await test('pendência identificada e listada com tags', async () => {
    const manager = criarManagerMock({
      travas: [[
        '10',
        {
          transacaoId: '10',
          estado: 'RECONCILIACAO_PENDENTE',
          codigo: 'TIMEOUT',
          resultadoTardio: { codigo: 'TIMEOUT' }
        }
      ]]
    });
    const rel = await svc.listarPendenciasOperacionais({
      tefManager: manager,
      cryptoService: null,
      linhasPendentes: [
        {
          id: 10,
          venda_id: 55,
          tipo: 'credito',
          valor: 1.0,
          status: 'pendente',
          provedor: 'DESTAXA',
          idempotency_key: 'pdv-op-a',
          criado_em: '2026-10-29',
          payload_retorno: { resultadoTardio: { codigo: 'TIMEOUT' } }
        }
      ]
    });
    assert.strictEqual(rel.quantidade, 1);
    assert.strictEqual(rel.bloqueioGlobalAtivo, true);
    assert.strictEqual(rel.pendencias[0].estadoOperacional, 'RECONCILIACAO_PENDENTE');
    assert.ok(rel.pendencias[0].tags.includes('TIMEOUT_DESCONHECIDO'));
    assert.strictEqual(rel.pendencias[0].podeReconciliarExplicitamente, true);
    assert.strictEqual(rel.pendencias[0].liberacaoAutomaticaProibida, true);
  });

  await test('pendência sem venda_id marcada como órfã', async () => {
    const manager = criarManagerMock({ travas: [] });
    const rel = await svc.listarPendenciasOperacionais({
      tefManager: manager,
      cryptoService: null,
      linhasPendentes: [{
        id: 3,
        venda_id: null,
        tipo: 'debito',
        valor: 20,
        status: 'pendente',
        provedor: 'DESTAXA',
        payload_retorno: null
      }]
    });
    assert.strictEqual(rel.pendencias[0].orfaSemVenda, true);
    assert.ok(rel.pendencias[0].tags.includes('ORFA_SEM_VENDA'));
    assert.strictEqual(rel.pendencias[0].bloqueiaNovasAutorizacoes, true);
  });

  await test('timeout com resultado desconhecido não é cancelamento', async () => {
    const c = svc.classificarPendencia(
      {
        id: 1,
        venda_id: 1,
        status: 'pendente',
        payload_retorno: { resultadoTardio: { codigo: 'TIMEOUT' } }
      },
      { estado: 'RECONCILIACAO_PENDENTE', codigo: 'TIMEOUT' }
    );
    assert.strictEqual(c.timeoutNaoECancelamento, true);
    assert.ok(c.tags.includes('TIMEOUT_DESCONHECIDO'));
  });

  await test('resultado tardio após timeout → reconciliável só com confirmação', async () => {
    const manager = criarManagerMock({
      travas: [[
        '8',
        { transacaoId: '8', estado: 'RECONCILIACAO_PENDENTE', codigo: '00' }
      ]]
    });
    assert.throws(
      () => svc.reconciliarExplicita({
        tefManager: manager,
        transacaoId: 8,
        financialState: 'CONFIRMED_SUCCESS',
        usuario: 'op',
        observacao: 'ok',
        confirmacao_explicita: false
      }),
      (e) => e.code === 'TEF_RECONCILIACAO_SEM_CONFIRMACAO'
    );
    const logs = [];
    const ok = svc.reconciliarExplicita({
      tefManager: manager,
      repository: {
        registrarLog(id, tipo, msg, payload) {
          logs.push({ id, tipo, msg, payload });
        }
      },
      transacaoId: 8,
      financialState: 'CONFIRMED_SUCCESS',
      usuario: 'op',
      observacao: 'confirmado no comprovante',
      confirmacao_explicita: true
    });
    assert.strictEqual(ok.travaLiberada, true);
    assert.strictEqual(ok.historicoRegistrado, true);
    assert.strictEqual(logs[0].tipo, 'TEF14_RECONCILIACAO_EXPLICITA');
  });

  await test('tentativa de liberar inconclusiva é recusada', () => {
    const r = svc.tentarLiberarInconclusiva();
    assert.strictEqual(r.liberada, false);
    assert.strictEqual(r.codigo, 'TEF_LIBERACAO_INCONCLUSIVA_PROIBIDA');
  });

  await test('AGUARDANDO_RESULTADO → reconciliação prematura', () => {
    const manager = criarManagerMock({
      travas: [[
        '2',
        { transacaoId: '2', estado: 'AGUARDANDO_RESULTADO_TARDIO' }
      ]]
    });
    assert.throws(
      () => svc.reconciliarExplicita({
        tefManager: manager,
        transacaoId: 2,
        financialState: 'CANCELLED',
        usuario: 'op',
        observacao: 'x',
        confirmacao_explicita: true
      }),
      (e) => e.code === 'TEF_RECONCILIACAO_PREMATURA'
    );
  });

  await test('recuperação após reinício: listagem chama garantirRecuperacao', async () => {
    let recuperou = false;
    const manager = criarManagerMock({ travas: [] });
    manager.garantirRecuperacao = async () => {
      recuperou = true;
      return true;
    };
    await svc.listarPendenciasOperacionais({
      tefManager: manager,
      cryptoService: null,
      linhasPendentes: []
    });
    assert.strictEqual(recuperou, true);
  });

  await test('lote automático rejeitado — pendência não descartada silenciosamente', () => {
    const r = svc.rejeitarReconcilicaoEmLoteAutomatica();
    assert.strictEqual(r.sucesso, false);
    assert.strictEqual(r.reconciliadas, 0);
    assert.strictEqual(r.codigo, 'TEF_RECONCILIACAO_LOTE_PROIBIDA');
  });

  await test('rota perigosa antiga substituída e nova rota explícita presente', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../backend/rotas/tef.js'), 'utf8');
    assert.ok(src.includes('tefPendenciasService'));
    assert.ok(src.includes('/transacao/:id/reconciliar'));
    assert.ok(src.includes('rejeitarReconcilicaoEmLoteAutomatica'));
    assert.ok(!/UPDATE tef_transacoes\s+SET status = \?[\s\S]*reconciliar-pendentes/.test(src));
    assert.ok(src.includes('pendencias/liberar-inconclusiva'));
  });

  await test('TefManager expõe listarTravasPendencias readonly', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/TefManager.js'), 'utf8');
    assert.ok(src.includes('listarTravasPendencias'));
  });

  await test('política de bloqueio global documentada (não multi-PDV)', async () => {
    const rel = await svc.listarPendenciasOperacionais({
      tefManager: criarManagerMock({ travas: [] }),
      cryptoService: null,
      linhasPendentes: []
    });
    assert.strictEqual(rel.politicaBloqueio.escopo, 'instalacao_global');
    assert.strictEqual(rel.politicaBloqueio.multiPdv, false);
    assert.strictEqual(rel.regras.nuncaAprovarAutomaticamente, true);
    assert.strictEqual(rel.regras.naoAssociarPorValorOuOrdem, true);
  });

  console.log(`\nResultado: ${passou} ok, ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
