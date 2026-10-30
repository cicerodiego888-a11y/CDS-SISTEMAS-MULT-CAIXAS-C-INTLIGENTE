'use strict';

/**
 * MRT-14 — Persistência / durabilidade da identidade do provedor (diagnóstico + merge).
 * Sem INIT real / pagamento / cancelamento / estorno reais / migration.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CICLO_CODES,
  mesclarPayloadPreservandoIdentidade,
  extrairIdentidadeTransacao,
  hidratarTransacaoParaCiclo,
  obterAdapterDaTransacao,
  montarIdentidadeAdapterPersistencia,
  CHAVES_IDENTIDADE_PAYLOAD
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

function identidadeDestaxa(terminalTefId = 'singleton:instalacao') {
  const sel = selecionarAdapterPorRouteDecision(criarRouteDecision({
    sucesso: true,
    modo: MODOS_ROUTER.COMPAT_SINGLETON,
    provedor: 'destaxa',
    ambiente: 'simulacao',
    terminalTefId,
    adapterBinding: {
      fonte: 'tef_configuracao_singleton',
      modo: 'COMPAT_SINGLETON',
      registro: { provedor: 'destaxa', ambiente: 'simulacao', empresa_codigo: 'E1' },
      executionMode: 'native-host',
      terminalTefId: null
    }
  }));
  return {
    sel,
    identidade: montarIdentidadeAdapterPersistencia(sel, sel.adapter)
  };
}

/** Simula linha após reinício (só o que está no banco — sem Map _pendencias). */
function linhaAposReinicio({ status, provedor, payload }) {
  return hidratarTransacaoParaCiclo({
    id: 9001,
    status,
    provedor,
    nsu: 'NSU-1',
    autorizacao: 'AUT-1',
    codigo_transacao: 'CTX-1',
    payload_retorno: payload
  });
}

console.log('=== MRT-14 — Persistência identidade provedor ===\n');

(async () => {
  await test('campos persistidos vs memória (estático)', () => {
    const repo = ler('backend/services/tef/tefRepository.js');
    assert.match(repo, /provedor,/);
    assert.match(repo, /payload_retorno/);
    // atualizarTransacao NÃO altera coluna provedor
    const updateBlock = repo.slice(repo.indexOf('function atualizarTransacao'), repo.indexOf('function registrarLog'));
    assert.ok(!/provedor\s*=/.test(updateBlock), 'UPDATE não deve sobrescrever provedor');

    const tm = ler('backend/services/tef/TefManager.js');
    assert.match(tm, /this\._pendencias = new Map/);
    assert.match(tm, /mesclarPayloadPreservandoIdentidade/);
    assert.match(tm, /hidratarTransacaoParaCiclo/);
    assert.ok(CHAVES_IDENTIDADE_PAYLOAD.includes('identidadeAdapter'));
  });

  await test('1) TX aprovada — identidade sobrevive rewrite de payload (pós-desfecho)', async () => {
    const { identidade } = identidadeDestaxa();
    const payloadInicial = {
      execucao: { instancia: 'i1', pid: 1 },
      identidadeAdapter: identidade,
      roteamento: { terminalTefId: 'singleton:instalacao', modo: 'COMPAT_SINGLETON' }
    };
    // Simula atualizarTransacao após aprovação (antes do fix perdia identidade)
    const aposDesfecho = mesclarPayloadPreservandoIdentidade(
      { financialState: 'CONFIRMED_SUCCESS', nsu: 'NSU-1' },
      payloadInicial,
      identidade
    );
    assert.ok(aposDesfecho.identidadeAdapter);
    assert.strictEqual(aposDesfecho.identidadeAdapter.provedor, 'destaxa');
    assert.ok(aposDesfecho.roteamento);
    assert.ok(aposDesfecho.execucao);

    const linha = linhaAposReinicio({
      status: 'aprovado',
      provedor: 'destaxa',
      payload: aposDesfecho
    });
    const id = extrairIdentidadeTransacao(linha);
    assert.strictEqual(id.ok, true);
    assert.strictEqual(id.provedor, 'destaxa');
    const ciclo = await obterAdapterDaTransacao(linha, {
      registroBase: { provedor: 'paygo', ambiente: 'simulacao' }
    });
    assert.strictEqual(ciclo.provedor, 'destaxa');
  });

  await test('2) TX inconclusiva — provedor da coluna + merge após timeout pré-envio', async () => {
    const { identidade } = identidadeDestaxa('tef-inc');
    const aposTimeout = mesclarPayloadPreservandoIdentidade(
      { codigo: 'TEF_TIMEOUT_ANTES_DO_ENVIO', transactionAttempted: false },
      { identidadeAdapter: identidade, roteamento: { terminalTefId: 'tef-inc' } },
      identidade
    );
    const linha = linhaAposReinicio({
      status: 'erro',
      provedor: 'destaxa',
      payload: aposTimeout
    });
    const id = extrairIdentidadeTransacao(linha);
    assert.strictEqual(id.provedor, 'destaxa');
    assert.strictEqual(id.terminalTefId, 'tef-inc');
    assert.ok(linha.payload_retorno.identidadeAdapter);
  });

  await test('3) Pendente reconciliação — identidade preservada no resultado tardio', () => {
    const { identidade } = identidadeDestaxa();
    const anterior = {
      identidadeAdapter: identidade,
      roteamento: { terminalTefId: 'singleton:instalacao' },
      execucao: { instancia: 'old', pid: 99 }
    };
    const aposTardio = mesclarPayloadPreservandoIdentidade(
      {
        resultadoTardio: {
          financialState: FINANCIAL_STATES.UNKNOWN,
          reconciliationRequired: true
        }
      },
      anterior
    );
    assert.strictEqual(aposTardio.identidadeAdapter.provedor, 'destaxa');
    assert.strictEqual(aposTardio.execucao.pid, 99);
    assert.ok(aposTardio.resultadoTardio.reconciliationRequired);
  });

  await test('4) Resultado tardio / reconciliação — merge não apaga identidade', () => {
    const { identidade } = identidadeDestaxa();
    const aposRec = mesclarPayloadPreservandoIdentidade(
      {
        resultadoTardio: { financialState: FINANCIAL_STATES.UNKNOWN },
        reconciliacao: { financialState: 'CONFIRMED_DENIED', usuario: 'op', observacao: 'teste' }
      },
      { identidadeAdapter: identidade, roteamento: { terminalTefId: 't1' } }
    );
    assert.strictEqual(aposRec.identidadeAdapter.provedor, 'destaxa');
    assert.ok(aposRec.reconciliacao);
  });

  await test('5) Consulta após reinício — mesma identidade (só coluna provedor, sem payload rico)', async () => {
    // Legado: identidadeAdapter perdido, âncora = coluna provedor
    const linha = linhaAposReinicio({
      status: 'aprovado',
      provedor: 'Destaxa',
      payload: { financialState: 'CONFIRMED_SUCCESS' }
    });
    const id = extrairIdentidadeTransacao(linha);
    assert.strictEqual(id.provedor, 'destaxa');
    const ciclo = await obterAdapterDaTransacao(linha, {
      registroBase: { provedor: 'destaxa', ambiente: 'simulacao' }
    });
    assert.strictEqual(ciclo.provedor, 'destaxa');
  });

  await test('6) Cancelamento após reinício — provedor original (não LIMIT 1)', async () => {
    const { identidade } = identidadeDestaxa('tef-cancel');
    const linha = linhaAposReinicio({
      status: 'aprovado',
      provedor: 'destaxa',
      payload: { identidadeAdapter: identidade }
    });
    const ciclo = await obterAdapterDaTransacao(linha, {
      registroBase: { provedor: 'sitef', ambiente: 'simulacao' }
    });
    assert.strictEqual(ciclo.provedor, 'destaxa');
    assert.ok(!/sitef/i.test(String(ciclo.adapter.nome)));
  });

  await test('7) Adapter original indisponível após reinício — erro explícito', async () => {
    const linha = linhaAposReinicio({
      status: 'aprovado',
      provedor: 'destaxa',
      payload: {
        identidadeAdapter: {
          provedor: 'destaxa',
          ambiente: 'ambiente_morto_xyz',
          registro: { provedor: 'destaxa', ambiente: 'ambiente_morto_xyz' }
        }
      }
    });
    await assert.rejects(
      () => obterAdapterDaTransacao(linha, {
        registroBase: { provedor: 'destaxa', ambiente: 'ambiente_morto_xyz' }
      }),
      (e) => e.tefAdapterCiclo === true && e.codigo === 'DESTAXA_AMBIENTE_INVALIDO'
    );
  });

  await test('integridade: ausência / incompleta / sem troca / sem pagamento automático', async () => {
    const semProv = extrairIdentidadeTransacao({ id: 1, provedor: null, payload_retorno: {} });
    assert.strictEqual(semProv.codigo, CICLO_CODES.PROVEDOR_AUSENTE);

    await assert.rejects(
      () => obterAdapterDaTransacao({ id: 1, provedor: null, payload_retorno: {} }, { registroBase: {} }),
      (e) => /sem fallback/i.test(e.message)
    );

    // Rewrite sem merge → perda (cenário reprovado documentado); com merge → OK
    const perdido = { financialState: 'X' }; // sem mesclar
    assert.ok(!perdido.identidadeAdapter);
    const salvo = mesclarPayloadPreservandoIdentidade(
      { financialState: 'X' },
      { identidadeAdapter: { provedor: 'destaxa' } }
    );
    assert.strictEqual(salvo.identidadeAdapter.provedor, 'destaxa');

    const tm = ler('backend/services/tef/TefManager.js');
    assert.match(tm, /TRAVADO_RESULTADO_TARDIO/);
    assert.match(tm, /forcarInconclusivo/);
    assert.match(tm, /garantirRecuperacao/);
    assert.ok(!/autorizarPagamento[\s\S]{0,40}recuperarAposReinicio/.test(tm));
    assert.match(tm, /cancelamentoConfirmado/);
    // Timeout não vira cancelamento automático
    assert.match(tm, /TEF_TIMEOUT_ANTES_DO_ENVIO/);
    assert.ok(!/TIMEOUT_ANTES_DO_ENVIO[\s\S]{0,200}STATUS\.CANCELADO/.test(tm));
  });

  await test('compat MRT-12/13 + Destaxa singleton estático', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '../../backend/services/tef/tefAdapterSelection.js')));
    assert.ok(fs.existsSync(path.join(__dirname, '../../backend/services/tef/tefAdapterCiclo.js')));
    const ciclo = ler('backend/services/tef/tefAdapterCiclo.js');
    assert.match(ciclo, /MRT-14/);
    assert.match(ciclo, /mesclarPayloadPreservandoIdentidade/);
  });

  console.log('\nMRT-14 testes OK — sem INIT/TX/migration.\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
