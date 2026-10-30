'use strict';

/**
 * MRT-15 — Diagnóstico real DLL Destaxa 1.83 + V$Pague Client
 * LOAD + STATUS + diagnosticar() + detectarVsPagueClient
 * PROIBIDO: INIT_CLIENT / iniciaClientDestaxa / TX financeira
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-15-dll-diagnostico-real-report.json');

const sdkDetector = require('../../backend/services/tef/sdkDetector');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { obterClienteCompartilhado } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');

const INIT_BLOCK = 'MRT15_INIT_BLOQUEADO';

function bloquearInit(bridge, client) {
  const originalIniciar = bridge.iniciarClient.bind(bridge);
  bridge.iniciarClient = async function iniciarClientBloqueado() {
    const err = new Error('MRT-15: INIT_CLIENT / iniciaClientDestaxa bloqueado — não executar nesta sprint');
    err.codigo = INIT_BLOCK;
    err.code = INIT_BLOCK;
    throw err;
  };
  bridge._iniciarClientOriginal = originalIniciar;

  if (client && typeof client.enviar === 'function') {
    const enviarOriginal = client.enviar.bind(client);
    client.enviar = async function enviarGuard(operacao, payload, opcoes) {
      if (operacao === OPERACOES_HOST.INIT_CLIENT
        || operacao === 'INIT_CLIENT'
        || String(operacao || '').toUpperCase().includes('INIT_CLIENT')) {
        const err = new Error('MRT-15: tentativa de INIT_CLIENT interceptada — execução abortada');
        err.codigo = INIT_BLOCK;
        err.code = INIT_BLOCK;
        throw err;
      }
      if (String(operacao || '').toUpperCase().includes('TX_')) {
        const err = new Error('MRT-15: operação transacional bloqueada');
        err.codigo = 'MRT15_TX_BLOQUEADO';
        throw err;
      }
      return enviarOriginal(operacao, payload, opcoes);
    };
  }
}

function serializarErro(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    codigo: error.codigo || error.code || null,
    stack: error.stack ? String(error.stack).split('\n').slice(0, 8) : null,
    detalhes: error.detalhes || error.windows || null
  };
}

async function main() {
  const geradoEm = new Date().toISOString();
  const evidencias = {
    sprint: 'MRT-15',
    title: 'Diagnóstico real DLL Destaxa e V$Pague Client',
    generatedAt: geradoEm,
    restricoes: {
      initExecutado: false,
      pagamento: false,
      cancelamento: false,
      estorno: false,
      configAlterada: false,
      bancoAlterado: false,
      migrations: false
    },
    auditoriaFluxo: {
      diagnosticarChamaInit: false,
      testarConexaoChamaInit: true,
      nota: 'Usar somente diagnosticar/LOAD/STATUS; NÃO chamar testarConexao()'
    },
    detectarVsPagueClient: null,
    load: null,
    status: null,
    diagnosticar: null,
    dllCarregada: null,
    comunicacaoFuncionalComClient: null,
    proximoBloqueio: null,
    erros: []
  };

  console.log('=== MRT-15 — Diagnóstico DLL Destaxa (sem INIT) ===\n');

  // 1) Detecção do Client
  let vspague;
  try {
    vspague = sdkDetector.detectarVsPagueClient();
    evidencias.detectarVsPagueClient = {
      ok: true,
      detectado: vspague.detectado === true,
      executando: vspague.executando === true,
      responding: vspague.responding,
      pid: vspague.pid || null,
      caminho: vspague.caminho || null,
      commandLine: vspague.commandLine ? String(vspague.commandLine).slice(0, 240) : null,
      erro: vspague.erro || null,
      bruto: vspague
    };
    console.log('  detectarVsPagueClient:', JSON.stringify(evidencias.detectarVsPagueClient, null, 2));
  } catch (error) {
    evidencias.detectarVsPagueClient = { ok: false, erro: serializarErro(error) };
    evidencias.erros.push({ etapa: 'detectarVsPagueClient', ...serializarErro(error) });
    console.error('  FAIL detectarVsPagueClient', error.message);
  }

  // 2–5) LOAD + STATUS + diagnosticar com guarda anti-INIT
  const client = obterClienteCompartilhado();
  const bridge = new DestaxaHostBridge({
    client,
    config: { provedor: 'destaxa', ambiente: 'homologacao' }
  });
  bloquearInit(bridge, client);

  const adapter = new DestaxaRealAdapter(
    { provedor: 'destaxa', ambiente: 'homologacao' },
    { bridge, executionMode: 'native-host' }
  );

  // LOAD
  try {
    console.log('\n  LOAD...');
    const carga = await bridge.load();
    evidencias.load = {
      ok: carga && carga.sucesso !== false,
      bruto: carga,
      sucesso: carga?.sucesso,
      codigo: carga?.codigo || carga?.code || null,
      mensagem: carga?.mensagem || null,
      dllPath: carga?.dllPath || carga?.diagnostico?.dllPath || null
    };
    console.log('  LOAD resultado:', JSON.stringify({
      sucesso: evidencias.load.sucesso,
      codigo: evidencias.load.codigo,
      mensagem: evidencias.load.mensagem,
      dllPath: evidencias.load.dllPath
    }, null, 2));
  } catch (error) {
    if (error.codigo === INIT_BLOCK) {
      evidencias.erros.push({ etapa: 'LOAD', abortadoPorInit: true, ...serializarErro(error) });
      evidencias.restricoes.initExecutado = false;
      console.error('  ABORT: INIT tentado durante LOAD');
    } else {
      evidencias.load = { ok: false, erro: serializarErro(error) };
      evidencias.erros.push({ etapa: 'LOAD', ...serializarErro(error) });
      console.error('  FAIL LOAD', error.message);
    }
  }

  // STATUS
  try {
    console.log('\n  STATUS...');
    const st = await bridge.getHostStatus();
    evidencias.status = {
      ok: st?.disponivel === true || st?.diagnostics != null,
      disponivel: st?.disponivel,
      pid: st?.pid || null,
      processType: st?.processType || null,
      diagnostics: st?.diagnostics || null,
      erro: st?.erro || null,
      brutoResumo: {
        disponivel: st?.disponivel,
        pid: st?.pid,
        processType: st?.processType,
        dllLoaded: st?.diagnostics?.dllLoaded,
        exportsValid: st?.diagnostics?.exportsValid,
        clientInitialized: st?.diagnostics?.clientInitialized,
        estado: st?.diagnostics?.estado,
        dllPath: st?.diagnostics?.dllPath,
        ultimoErro: st?.diagnostics?.ultimoErro || null
      }
    };
    console.log('  STATUS resumo:', JSON.stringify(evidencias.status.brutoResumo, null, 2));
  } catch (error) {
    if (error.codigo === INIT_BLOCK) {
      evidencias.erros.push({ etapa: 'STATUS', abortadoPorInit: true, ...serializarErro(error) });
      console.error('  ABORT: INIT tentado durante STATUS');
    } else {
      evidencias.status = { ok: false, erro: serializarErro(error) };
      evidencias.erros.push({ etapa: 'STATUS', ...serializarErro(error) });
      console.error('  FAIL STATUS', error.message);
    }
  }

  // diagnosticar() — auditado: só load + getDiagnostics
  try {
    console.log('\n  diagnosticar()...');
    const diag = await adapter.diagnosticar();
    evidencias.diagnosticar = {
      ok: true,
      sucesso: diag?.sucesso === true,
      mensagem: diag?.mensagem || null,
      detalhes: diag?.detalhes || null,
      // campos críticos
      dllLoaded: diag?.detalhes?.dllLoaded,
      exportsValid: diag?.detalhes?.exportsValid,
      clientInitialized: diag?.detalhes?.clientInitialized,
      clientResultCode: diag?.detalhes?.clientResultCode,
      estado: diag?.detalhes?.estado,
      dllPath: diag?.detalhes?.dllPath,
      ultimoErro: diag?.detalhes?.ultimoErro || null,
      transactionCommunicationValidated: diag?.detalhes?.transactionCommunicationValidated,
      authorizationAvailable: diag?.detalhes?.authorizationAvailable
    };
    console.log('  diagnosticar resumo:', JSON.stringify({
      sucesso: evidencias.diagnosticar.sucesso,
      mensagem: evidencias.diagnosticar.mensagem,
      dllLoaded: evidencias.diagnosticar.dllLoaded,
      exportsValid: evidencias.diagnosticar.exportsValid,
      clientInitialized: evidencias.diagnosticar.clientInitialized,
      estado: evidencias.diagnosticar.estado,
      dllPath: evidencias.diagnosticar.dllPath,
      ultimoErro: evidencias.diagnosticar.ultimoErro
    }, null, 2));
  } catch (error) {
    if (error.codigo === INIT_BLOCK) {
      evidencias.erros.push({ etapa: 'diagnosticar', abortadoPorInit: true, ...serializarErro(error) });
      console.error('  ABORT: INIT tentado durante diagnosticar — não executado');
    } else {
      evidencias.diagnosticar = { ok: false, erro: serializarErro(error) };
      evidencias.erros.push({ etapa: 'diagnosticar', ...serializarErro(error) });
      console.error('  FAIL diagnosticar', error.message);
    }
  }

  // Shutdown host (sem INIT)
  try {
    if (client && typeof client.encerrar === 'function') {
      await client.encerrar();
    } else if (client && typeof client.shutdown === 'function') {
      await client.shutdown();
    }
  } catch (_) { /* best-effort */ }

  const dllLoaded = evidencias.diagnosticar?.dllLoaded === true
    || evidencias.status?.brutoResumo?.dllLoaded === true
    || evidencias.load?.sucesso === true;
  evidencias.dllCarregada = dllLoaded === true;

  // Sem INIT, comunicação funcional com Client NÃO pode ser afirmada
  const clientProcessoOk = evidencias.detectarVsPagueClient?.detectado
    && evidencias.detectarVsPagueClient?.executando
    && evidencias.detectarVsPagueClient?.responding !== false;

  evidencias.comunicacaoFuncionalComClient = {
    comprovada: false,
    motivo: 'INIT_CLIENT não executado (proibido nesta sprint). LOAD/STATUS validam DLL, não Identificar/Background channel.',
    processoClientDetectado: clientProcessoOk === true,
    dllCarregada: evidencias.dllCarregada,
    clientInitializedNaDll: evidencias.diagnosticar?.clientInitialized === true
      || evidencias.status?.brutoResumo?.clientInitialized === true
  };

  if (!clientProcessoOk) {
    evidencias.proximoBloqueio = {
      codigo: 'VSPAGUE_CLIENT_NAO_DETECTADO_OU_NAO_RESPONDENDO',
      mensagem: 'VSPagueClient não detectado/respondendo pelo sdkDetector'
    };
  } else if (!evidencias.dllCarregada) {
    evidencias.proximoBloqueio = {
      codigo: evidencias.load?.codigo
        || evidencias.diagnosticar?.ultimoErro?.codigo
        || evidencias.status?.brutoResumo?.ultimoErro?.codigo
        || 'DESTAXA_DLL_LOAD_FAILED',
      mensagem: evidencias.load?.mensagem
        || evidencias.diagnosticar?.ultimoErro?.mensagem
        || evidencias.diagnosticar?.mensagem
        || 'DLL Destaxa não carregou',
      detalhe: evidencias.load?.erro || evidencias.diagnosticar?.ultimoErro || null
    };
  } else if (evidencias.diagnosticar?.exportsValid !== true
    && evidencias.status?.brutoResumo?.exportsValid !== true) {
    evidencias.proximoBloqueio = {
      codigo: 'DESTAXA_EXPORT_MISSING',
      mensagem: 'DLL carregada sem exports obrigatórios validados'
    };
  } else {
    evidencias.proximoBloqueio = {
      codigo: 'AGUARDANDO_INIT_CONTROLADO',
      mensagem: 'DLL OK e Client em processo. Próximo passo (fora desta sprint): INIT_CLIENT controlado para comprovar canal DLL↔Client Background — ainda sem pagamento.'
    };
  }

  evidencias.resultadoFinal = evidencias.dllCarregada
    ? 'MRT-15 CONCLUÍDA — DLL DIAGNOSTICADA (SEM INIT)'
    : 'MRT-15 CONCLUÍDA — BLOQUEIO NO LOAD/DIAGNÓSTICO (SEM INIT)';

  evidencias.criterioConclusao = {
    evidenciaObjetivaLoadDiagnostico: true,
    initExecutado: false,
    operacaoFinanceira: false
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(evidencias, null, 2), 'utf8');
  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  ${evidencias.resultadoFinal}`);
  console.log(`  dllCarregada=${evidencias.dllCarregada}`);
  console.log(`  comunicacaoFuncionalComClient.comprovada=${evidencias.comunicacaoFuncionalComClient.comprovada}`);
  console.log(`  proximoBloqueio=${evidencias.proximoBloqueio?.codigo}\n`);

  // Assertions mínimas da sprint: evidência objetiva gerada (não exige LOAD ok em CI sem DLL)
  assert.ok(evidencias.detectarVsPagueClient, 'deve registrar detecção');
  assert.strictEqual(evidencias.restricoes.initExecutado, false);
  assert.ok(fs.existsSync(REPORT_PATH));
}

main().catch((err) => {
  console.error(err);
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify({
      sprint: 'MRT-15',
      fatal: true,
      erro: { message: err.message, stack: err.stack, codigo: err.codigo || err.code }
    }, null, 2));
  } catch (_) { /* ignore */ }
  process.exit(1);
});
