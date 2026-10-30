'use strict';

/**
 * MRT-13 — Continuidade da identidade do adapter no ciclo TEF
 * (sem INIT real / pagamento / estorno real / migration).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CICLO_CODES,
  normalizarProvedorCiclo,
  extrairIdentidadeTransacao,
  montarIdentidadeAdapterPersistencia,
  obterAdapterDaTransacao,
  capacidadeOperacaoDocumental
} = require('../../backend/services/tef/tefAdapterCiclo');

const { selecionarAdapterPorRouteDecision } = require('../../backend/services/tef/tefAdapterSelection');
const { criarRouteDecision, MODOS_ROUTER } = require('../../backend/services/tef/terminalRouter/contracts');
const { FINANCIAL_STATES } = require('../../backend/services/tef/tefFinancialSafetyPolicy');

function test(nome, fn) {
  const ret = fn();
  if (ret && typeof ret.then === 'function') {
    return ret.then(() => console.log(`  OK  ${nome}`)).catch((err) => {
      console.error(`  FAIL ${nome}`);
      throw err;
    });
  }
  console.log(`  OK  ${nome}`);
  return Promise.resolve();
}

function ler(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

function decisionDestaxa() {
  return criarRouteDecision({
    sucesso: true,
    codigo: 'SINGLETON_FALLBACK',
    modo: MODOS_ROUTER.COMPAT_SINGLETON,
    provedor: 'destaxa',
    ambiente: 'simulacao',
    terminalTefId: 'singleton:instalacao',
    adapterBinding: {
      fonte: 'tef_configuracao_singleton',
      modo: 'COMPAT_SINGLETON',
      registro: { provedor: 'destaxa', ambiente: 'simulacao', empresa_codigo: 'E1' },
      executionMode: 'native-host',
      terminalTefId: null
    },
    executionContext: { topologia: 'ESTACAO_UNICA_PDV_UNICO' }
  });
}

console.log('=== MRT-13 — Ciclo / identidade do adapter ===\n');

(async () => {
  await test('1) Autorização e consulta — mesma identidade de provedor', async () => {
    const sel = selecionarAdapterPorRouteDecision(decisionDestaxa());
    const identidade = montarIdentidadeAdapterPersistencia(sel, sel.adapter);
    assert.strictEqual(identidade.provedor, 'destaxa');

    const tx = {
      id: 101,
      provedor: identidade.provedor,
      codigo_transacao: 'NSU-101',
      payload_retorno: {
        identidadeAdapter: identidade,
        roteamento: { terminalTefId: sel.terminalTefId }
      }
    };

    const ciclo = await obterAdapterDaTransacao(tx, {
      registroBase: { provedor: 'destaxa', ambiente: 'simulacao' }
    });
    assert.strictEqual(ciclo.provedor, 'destaxa');
    assert.strictEqual(String(ciclo.adapter.nome).toLowerCase(), 'destaxa');
    assert.strictEqual(ciclo.fonte, 'tef_transacao');
    assert.strictEqual(ciclo.terminalTefId, 'singleton:instalacao');
  });

  await test('2) Autorização e cancelamento preservam provedor original', async () => {
    const tx = {
      id: 202,
      provedor: 'Destaxa', // legado display name
      nsu: '9',
      autorizacao: 'A',
      payload_retorno: {
        identidadeAdapter: {
          provedor: 'destaxa',
          adapterNome: 'Destaxa',
          terminalTefId: 'tef-1',
          ambiente: 'simulacao',
          registro: { provedor: 'destaxa', ambiente: 'simulacao' }
        }
      }
    };
    const id = extrairIdentidadeTransacao(tx);
    assert.strictEqual(id.provedor, 'destaxa');

    const ciclo = await obterAdapterDaTransacao(tx, {
      registroBase: { provedor: 'paygo', ambiente: 'simulacao' } // config global diferente
    });
    // Força provedor da TX — não herda paygo do LIMIT 1 simulado
    assert.strictEqual(ciclo.provedor, 'destaxa');
    assert.strictEqual(String(ciclo.adapter.nome).toLowerCase(), 'destaxa');

    const tm = ler('backend/services/tef/TefManager.js');
    assert.match(tm, /obterAdapterDaTransacao\(transacao\)/);
    const iCancel = tm.indexOf('async cancelar(');
    const iConsult = tm.indexOf('async consultar(');
    assert.ok(!/await obterAdapter\(\)/.test(tm.slice(iCancel, iConsult)));
  });

  await test('3) Recuperação de pendência sem troca de adapter (identidade persistida)', () => {
    const linha = {
      id: 303,
      provedor: 'destaxa',
      tipo: 'credito',
      payload_retorno: {
        identidadeAdapter: { provedor: 'destaxa', adapterNome: 'Destaxa' },
        resultadoTardio: { financialState: FINANCIAL_STATES.UNKNOWN }
      }
    };
    const id = extrairIdentidadeTransacao(linha);
    assert.strictEqual(id.provedor, 'destaxa');
    assert.strictEqual(id.ok, true);

    const tm = ler('backend/services/tef/TefManager.js');
    assert.match(tm, /recarregarPendencias/);
    assert.match(tm, /provedor: linha\.provedor/);
    assert.match(tm, /TRAVADO_RESULTADO_TARDIO/);
    assert.ok(!/obterAdapter\(\)/.test(
      tm.slice(tm.indexOf('async recarregarPendencias'), tm.indexOf('_abrirTravaResultadoTardio'))
    ));
  });

  await test('4) Resultado tardio vinculado à transação original', () => {
    const tm = ler('backend/services/tef/TefManager.js');
    assert.match(tm, /_registrarResultadoTardio\(transacaoId,/);
    assert.match(tm, /_abrirTravaResultadoTardio\(transacaoEmCursoId/);
    assert.ok(FINANCIAL_STATES.UNKNOWN);
    // Não transforma timeout em cancelamento
    assert.ok(!/STATUS\.CANCELADO.*timeout/i.test(tm));
    assert.match(tm, /contratoTimeout\?\.resultadoTardio/);
  });

  await test('5) Provedor ausente → erro explícito', async () => {
    const tx = { id: 404, provedor: null, payload_retorno: {} };
    const id = extrairIdentidadeTransacao(tx);
    assert.strictEqual(id.ok, false);
    assert.strictEqual(id.codigo, CICLO_CODES.PROVEDOR_AUSENTE);
    await assert.rejects(
      () => obterAdapterDaTransacao(tx, { registroBase: { provedor: 'destaxa', ambiente: 'simulacao' } }),
      (e) => e.codigo === CICLO_CODES.PROVEDOR_AUSENTE && /sem fallback/i.test(e.message)
    );
  });

  await test('6) Adapter/provedor indisponível sem fallback arbitrário', async () => {
    const tx = {
      id: 505,
      provedor: 'provedor_fantasma',
      payload_retorno: { identidadeAdapter: { provedor: 'provedor_fantasma' } }
    };
    const id = extrairIdentidadeTransacao(tx);
    assert.strictEqual(id.ok, false);
    assert.strictEqual(id.codigo, CICLO_CODES.PROVEDOR_NAO_RECONHECIDO);

    await assert.rejects(
      () => obterAdapterDaTransacao(
        {
          id: 506,
          provedor: 'destaxa',
          payload_retorno: {
            identidadeAdapter: { provedor: 'destaxa', ambiente: 'ambiente_invalido_xyz' }
          }
        },
        { registroBase: { provedor: 'destaxa', ambiente: 'ambiente_invalido_xyz' } }
      ),
      (e) => e.tefAdapterCiclo === true && e.codigo === 'DESTAXA_AMBIENTE_INVALIDO'
    );
  });

  await test('7) Compatibilidade Destaxa singleton + aliases legados', () => {
    assert.strictEqual(normalizarProvedorCiclo('Destaxa'), 'destaxa');
    assert.strictEqual(normalizarProvedorCiclo('destaxa'), 'destaxa');
    assert.strictEqual(normalizarProvedorCiclo('CliSiTef'), 'sitef');
    assert.strictEqual(normalizarProvedorCiclo('SITEF'), 'sitef');
    assert.strictEqual(normalizarProvedorCiclo('PayGo'), 'paygo');

    const sel = selecionarAdapterPorRouteDecision(decisionDestaxa());
    assert.strictEqual(sel.fonte, 'tef_configuracao_singleton');
    assert.strictEqual(sel.provedor, 'destaxa');
  });

  await test('8) Segurança inconclusivos + TEF-17 / reversão por ciclo', () => {
    const tm = ler('backend/services/tef/TefManager.js');
    assert.match(tm, /forcarInconclusivo/);
    assert.match(tm, /cancelamentoConfirmado/);
    assert.match(tm, /FINANCIAL_STATES\.UNKNOWN/);

    const rev = ler('backend/services/tef/tefReversalService.js');
    assert.match(rev, /obterAdapterDaTransacao/);
    assert.ok(!/obterAdapter\(\)/.test(rev));
    assert.match(rev, /cancelamentoConfirmado/);
    assert.match(rev, /financialState: 'UNCHANGED'/);

    const cap = capacidadeOperacaoDocumental('sitef', 'cancelar');
    assert.strictEqual(cap.suportado, 'sdk_pendente');
  });

  await test('9) status() instalação permanece singleton; consultar/reimprimir usam ciclo', () => {
    const tm = ler('backend/services/tef/TefManager.js');
    const iStatus = tm.indexOf('async status()');
    assert.match(tm.slice(iStatus, iStatus + 250), /obterAdapter\(\)/);
    assert.match(tm, /identidadeAdapter: montarIdentidadeAdapterPersistencia/);
    assert.match(tm, /provedor: selecao\.provedor/);
  });

  console.log('\nMRT-13 testes OK — sem INIT/TX/estorno real.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
