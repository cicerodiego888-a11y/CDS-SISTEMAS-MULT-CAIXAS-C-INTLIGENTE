'use strict';

/**
 * MRT-16 — Primeira inicialização real Destaxa (INIT controlado)
 * UMA chamada iniciaClientDestaxa. Sem pagamento / TX / retry automático.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-16-init-controlado-destaxa-report.json');

const sdkDetector = require('../../backend/services/tef/sdkDetector');
const DestaxaRealAdapter = require('../../backend/services/tef/adapters/DestaxaRealAdapter');
const DestaxaHostBridge = require('../../backend/services/tef/destaxa/DestaxaHostBridge');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { obterClienteCompartilhado } = require('../../backend/services/tef/destaxa/DestaxaNativeHostClient');
const { projetarEntradaIniciaClient } = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');
const { APLICACAO, REAL_TRANSACTION_ENV } = require('../../backend/services/tef/destaxa/destaxaConstantes');

function serializarErro(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    codigo: error.codigo || error.code || null,
    detalhes: error.detalhes || null
  };
}

function bloquearFinanceiro(client) {
  const enviarOriginal = client.enviar.bind(client);
  let initCount = 0;
  client.enviar = async function enviarGuard(operacao, payload, opcoes) {
    const op = String(operacao || '');
    if (op === OPERACOES_HOST.TX_START
      || op === OPERACOES_HOST.TX_CONTINUE
      || op === OPERACOES_HOST.TX_FINALIZE
      || op === OPERACOES_HOST.ENABLE_REAL) {
      const err = new Error(`MRT-16: operação financeira/transacional bloqueada (${op})`);
      err.codigo = 'MRT16_TX_BLOQUEADO';
      throw err;
    }
    if (op === OPERACOES_HOST.INIT_CLIENT) {
      initCount += 1;
      if (initCount > 1) {
        const err = new Error('MRT-16: segunda chamada INIT_CLIENT bloqueada — sem retry automático');
        err.codigo = 'MRT16_INIT_REPETIDO_BLOQUEADO';
        throw err;
      }
    }
    return enviarOriginal(operacao, payload, opcoes);
  };
  return () => initCount;
}

async function carregarConfigSomenteLeitura() {
  try {
    const tefConfigService = require('../../backend/services/tef/tefConfigService');
    const config = await tefConfigService.obterConfiguracao();
    return {
      ok: true,
      provedor: config.tefProvedor || null,
      ambiente: config.tefAmbiente || null,
      empresaCodigo: config.empresaCodigo || null,
      lojaCodigo: config.lojaCodigo || null,
      terminalCodigo: config.terminalCodigo || null,
      pdvCodigo: config.pdvCodigo || null,
      caixaCodigo: config.caixaCodigo || null,
      defaults: config._defaultsAplicados === true
    };
  } catch (error) {
    return { ok: false, erro: serializarErro(error) };
  }
}

async function main() {
  const inicioSprint = new Date().toISOString();
  const pkg = require('../../package.json');
  const versao = String(pkg.version || '').trim();

  // Gate financeiro deve permanecer OFF
  const gateAntes = String(process.env[REAL_TRANSACTION_ENV] || '').trim();
  if (gateAntes === '1') {
    delete process.env[REAL_TRANSACTION_ENV];
  }

  const rel = {
    sprint: 'MRT-16',
    title: 'Primeira inicialização real Destaxa (INIT controlado)',
    generatedAt: inicioSprint,
    restricoes: {
      pagamento: false,
      debitoCreditoPix: false,
      cancelamentoEstorno: false,
      operacaoFinanceiraHomologacao: false,
      initRepetidoAutomatico: false,
      configProvedorAlterada: false,
      bancoProducaoAlterado: false,
      gateFinanceiroForcadoOff: gateAntes === '1',
      gateFinanceiroValor: String(process.env[REAL_TRANSACTION_ENV] || '') || '(vazio)'
    },
    etapa1_preValidacao: {},
    etapa2_init: {},
    etapa3_verificacao: {},
    erros: [],
    resultadoFinal: null
  };

  console.log('=== MRT-16 — INIT Destaxa controlado (sem pagamento) ===\n');

  // ——— ETAPA 1 ———
  console.log('ETAPA 1 — Pré-validação');

  const vspague = sdkDetector.detectarVsPagueClient();
  rel.etapa1_preValidacao.vspague = {
    detectado: vspague.detectado === true,
    executando: vspague.executando === true,
    responding: vspague.responding,
    pid: vspague.pid || null,
    caminho: vspague.caminho || null,
    commandLine: vspague.commandLine ? String(vspague.commandLine).slice(0, 280) : null
  };
  console.log('  Client:', JSON.stringify(rel.etapa1_preValidacao.vspague, null, 2));

  if (!rel.etapa1_preValidacao.vspague.detectado
    || !rel.etapa1_preValidacao.vspague.executando
    || rel.etapa1_preValidacao.vspague.responding === false) {
    rel.resultadoFinal = 'MRT-16 BLOQUEADA — V$PAGUE CLIENT INDISPONÍVEL';
    rel.etapa1_preValidacao.interrompido = true;
    rel.etapa1_preValidacao.motivo = 'Client não ativo/Responding';
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2));
    console.error('  INTERROMPIDO:', rel.etapa1_preValidacao.motivo);
    process.exit(1);
  }

  if (!versao) {
    rel.resultadoFinal = 'MRT-16 BLOQUEADA — VERSAO APLICACAO AUSENTE';
    rel.etapa1_preValidacao.interrompido = true;
    rel.etapa1_preValidacao.motivo = 'package.json.version ausente — iniciaClientDestaxa exige versao';
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2));
    console.error('  INTERROMPIDO:', rel.etapa1_preValidacao.motivo);
    process.exit(1);
  }

  const configRo = await carregarConfigSomenteLeitura();
  rel.etapa1_preValidacao.configSomenteLeitura = configRo;

  const configInit = {
    provedor: 'destaxa',
    ambiente: (configRo.ambiente && configRo.ambiente !== 'simulacao') ? configRo.ambiente : 'homologacao',
    empresa_codigo: configRo.empresaCodigo || null,
    loja_codigo: configRo.lojaCodigo || null,
    terminal_codigo: configRo.terminalCodigo || null,
    // pdv/caixa NÃO entram na DLL
    pdv_codigo: configRo.pdvCodigo || null,
    caixa_codigo: configRo.caixaCodigo || null
  };

  const projecao = projetarEntradaIniciaClient(configInit, { versao, aplicacao: APLICACAO });
  rel.etapa1_preValidacao.parametrosEnviadosADll = {
    texto: projecao.texto,
    chaves: projecao.chaves,
    incluiPdvOuCaixa: projecao.incluiPdvOuCaixa,
    camposDestaxaEnviados: projecao.camposDestaxaEnviados,
    nota: 'iniciaClientDestaxa(resultado, entrada, tamanho) — NÃO iniciaTransacaoDestaxa'
  };
  console.log('  Entrada projetada:', projecao.texto);

  rel.etapa1_preValidacao.arquitetura = {
    processArch: process.arch,
    esperado: 'x64',
    ok: process.arch === 'x64'
  };
  if (!rel.etapa1_preValidacao.arquitetura.ok) {
    rel.resultadoFinal = 'MRT-16 BLOQUEADA — ARQUITETURA INCOMPATIVEL';
    rel.etapa1_preValidacao.interrompido = true;
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2));
    process.exit(1);
  }

  rel.etapa1_preValidacao.initNaoDisparaFinanceiro = {
    comprovadoPorCodigo: true,
    evidencia: 'DestaxaNativeBridge.iniciarClient chama apenas export iniciaClientDestaxa; TX exige OPERACOES_HOST.TX_* + gate DESTAXA_REAL_TRANSACTION_ENABLED',
    gateFinanceiro: rel.restricoes.gateFinanceiroValor
  };

  const client = obterClienteCompartilhado();
  const getInitCount = bloquearFinanceiro(client);
  const bridge = new DestaxaHostBridge({ client, config: configInit });
  const adapter = new DestaxaRealAdapter(configInit, { bridge, executionMode: 'native-host' });

  // LOAD + STATUS pré-INIT
  const carga = await bridge.load();
  rel.etapa1_preValidacao.load = {
    sucesso: carga?.sucesso === true,
    estado: carga?.estado || carga?.diagnostico?.estado || null,
    dllPath: carga?.diagnostico?.dllPath || carga?.dllPath || null,
    dllLoaded: carga?.diagnostico?.dllLoaded,
    exportsValid: carga?.diagnostico?.exportsValid,
    clientInitializedAntes: carga?.diagnostico?.clientInitialized === true,
    codigo: carga?.codigo || null,
    mensagem: carga?.mensagem || null
  };
  console.log('  LOAD pré-INIT:', JSON.stringify({
    sucesso: rel.etapa1_preValidacao.load.sucesso,
    estado: rel.etapa1_preValidacao.load.estado,
    clientInitializedAntes: rel.etapa1_preValidacao.load.clientInitializedAntes
  }));

  if (!rel.etapa1_preValidacao.load.sucesso) {
    rel.resultadoFinal = 'MRT-16 BLOQUEADA — LOAD FALHOU';
    rel.etapa1_preValidacao.interrompido = true;
    rel.etapa1_preValidacao.motivo = carga?.mensagem || 'DLL não carregou';
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2));
    console.error('  INTERROMPIDO:', rel.etapa1_preValidacao.motivo);
    process.exit(1);
  }

  const statusAntes = await bridge.getHostStatus();
  rel.etapa1_preValidacao.statusAntes = {
    disponivel: statusAntes?.disponivel === true,
    hostPid: statusAntes?.pid || null,
    processType: statusAntes?.processType || null,
    operacaoAtiva: statusAntes?.operacaoAtiva || null,
    clientInitialized: statusAntes?.diagnostics?.clientInitialized === true,
    estado: statusAntes?.diagnostics?.estado || null
  };

  if (statusAntes?.operacaoAtiva) {
    rel.resultadoFinal = 'MRT-16 BLOQUEADA — OPERACAO NATIVA CONCORRENTE';
    rel.etapa1_preValidacao.interrompido = true;
    rel.etapa1_preValidacao.motivo = 'Native Host já possui operação ativa';
    fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2));
    console.error('  INTERROMPIDO:', rel.etapa1_preValidacao.motivo);
    process.exit(1);
  }

  rel.etapa1_preValidacao.estadoAnterior = {
    horario: new Date().toISOString(),
    dllLoaded: true,
    clientInitialized: rel.etapa1_preValidacao.load.clientInitializedAntes === true,
    vspaguePid: rel.etapa1_preValidacao.vspague.pid
  };

  console.log('  Pré-validação OK — iniciando INIT único\n');

  // ——— ETAPA 2 ———
  console.log('ETAPA 2 — INIT controlado (única chamada)');
  const horarioInit = new Date().toISOString();
  const t0 = Date.now();
  let initResultado = null;
  let initErro = null;
  try {
    // timeout generoso: Client Background + Partner Cloud podem demorar; SEM retry
    initResultado = await bridge.iniciarClient(configInit);
  } catch (error) {
    initErro = error;
  }
  const duracaoWallMs = Date.now() - t0;

  rel.etapa2_init = {
    horarioInicio: horarioInit,
    horarioFim: new Date().toISOString(),
    duracaoWallMs,
    chamadasInitContadas: getInitCount(),
    repetiuAutomaticamente: false,
    retornoOriginal: initResultado || null,
    erro: initErro ? serializarErro(initErro) : null,
    codigoDestaxa: initResultado?.codigoDestaxa || null,
    codigoCds: initResultado?.codigo || null,
    descricaoCodigo: initResultado?.descricaoCodigo || null,
    sucesso: initResultado?.sucesso === true,
    estado: initResultado?.estado || null,
    mensagem: initResultado?.mensagem || null,
    entradaEnviada: initResultado?.entrada || projecao.texto,
    tamanhoEntrada: initResultado?.tamanhoEntrada || projecao.texto.length,
    duracaoMsDll: initResultado?.duracaoMs ?? null,
    diagnosticoPosInitImediato: initResultado?.diagnostico || null
  };

  console.log('  INIT retorno:', JSON.stringify({
    sucesso: rel.etapa2_init.sucesso,
    codigoDestaxa: rel.etapa2_init.codigoDestaxa,
    codigoCds: rel.etapa2_init.codigoCds,
    estado: rel.etapa2_init.estado,
    mensagem: rel.etapa2_init.mensagem,
    entrada: rel.etapa2_init.entradaEnviada,
    duracaoMsDll: rel.etapa2_init.duracaoMsDll,
    duracaoWallMs: rel.etapa2_init.duracaoWallMs,
    erro: rel.etapa2_init.erro
  }, null, 2));

  if (getInitCount() !== 1 && !initErro) {
    // Se falhou antes de enviar, count pode ser 0
  }
  if (getInitCount() > 1) {
    rel.erros.push({ codigo: 'MRT16_INIT_REPETIDO', message: 'Mais de um INIT detectado' });
  }

  const inconclusivo = Boolean(initErro)
    || (initResultado && initResultado.sucesso !== true && !initResultado.codigoDestaxa)
    || (initErro && /HOST_TIMEOUT|timeout/i.test(initErro.message || ''));

  if (inconclusivo) {
    rel.etapa2_init.inconclusivo = true;
    rel.etapa2_init.politica = 'SEM RETRY — preservar evidências';
    console.warn('  INIT inconclusivo/timeout — sem nova tentativa');
  }

  // ——— ETAPA 3 ———
  console.log('\nETAPA 3 — Verificação pós-INIT');
  try {
    const statusDepois = await bridge.getHostStatus();
    rel.etapa3_verificacao.status = {
      disponivel: statusDepois?.disponivel === true,
      hostPid: statusDepois?.pid || null,
      clientInitialized: statusDepois?.diagnostics?.clientInitialized === true,
      clientResultCode: statusDepois?.diagnostics?.clientResultCode || null,
      estado: statusDepois?.diagnostics?.estado || null,
      dllLoaded: statusDepois?.diagnostics?.dllLoaded === true,
      ultimoErro: statusDepois?.diagnostics?.ultimoErro || null
    };
    console.log('  STATUS:', JSON.stringify(rel.etapa3_verificacao.status, null, 2));
  } catch (error) {
    rel.etapa3_verificacao.status = { ok: false, erro: serializarErro(error) };
    rel.erros.push({ etapa: 'status', ...serializarErro(error) });
  }

  try {
    const diag = await adapter.diagnosticar();
    rel.etapa3_verificacao.diagnosticar = {
      sucesso: diag?.sucesso === true,
      mensagem: diag?.mensagem || null,
      clientInitialized: diag?.detalhes?.clientInitialized === true,
      clientResultCode: diag?.detalhes?.clientResultCode || null,
      estado: diag?.detalhes?.estado || null,
      dllLoaded: diag?.detalhes?.dllLoaded === true,
      exportsValid: diag?.detalhes?.exportsValid === true,
      transactionCommunicationValidated: diag?.detalhes?.transactionCommunicationValidated,
      authorizationAvailable: diag?.detalhes?.authorizationAvailable,
      ultimoErro: diag?.detalhes?.ultimoErro || null
    };
    console.log('  diagnosticar:', JSON.stringify(rel.etapa3_verificacao.diagnosticar, null, 2));
  } catch (error) {
    rel.etapa3_verificacao.diagnosticar = { ok: false, erro: serializarErro(error) };
    rel.erros.push({ etapa: 'diagnosticar', ...serializarErro(error) });
  }

  const vspagueDepois = sdkDetector.detectarVsPagueClient();
  rel.etapa3_verificacao.vspague = {
    detectado: vspagueDepois.detectado === true,
    executando: vspagueDepois.executando === true,
    responding: vspagueDepois.responding,
    pid: vspagueDepois.pid || null
  };

  const sessaoInicializada = rel.etapa2_init.sucesso === true
    && (rel.etapa2_init.codigoDestaxa === '00'
      || rel.etapa3_verificacao.status?.clientInitialized === true
      || rel.etapa3_verificacao.diagnosticar?.clientInitialized === true);

  rel.sessaoDestaxaInicializada = sessaoInicializada === true;
  rel.comunicacaoDllClient = {
    comprovadaPorInit: sessaoInicializada === true,
    codigoDestaxa: rel.etapa2_init.codigoDestaxa,
    clientInitialized: rel.etapa3_verificacao.diagnosticar?.clientInitialized === true
      || rel.etapa3_verificacao.status?.clientInitialized === true
  };

  if (sessaoInicializada) {
    rel.resultadoFinal = 'MRT-16 CONCLUÍDA — INIT DESTAXA OK (SEM PAGAMENTO)';
  } else if (rel.etapa2_init.inconclusivo) {
    rel.resultadoFinal = 'MRT-16 CONCLUÍDA — INIT INCONCLUSIVO (SEM RETRY / SEM PAGAMENTO)';
  } else {
    rel.resultadoFinal = 'MRT-16 CONCLUÍDA — INIT NÃO ESTABELECEU SESSÃO (SEM PAGAMENTO)';
  }

  try {
    if (typeof client.encerrar === 'function') await client.encerrar();
  } catch (_) { /* best-effort */ }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  ${rel.resultadoFinal}`);
  console.log(`  sessaoDestaxaInicializada=${rel.sessaoDestaxaInicializada}`);
  console.log(`  codigoDestaxa=${rel.etapa2_init.codigoDestaxa}\n`);

  assert.strictEqual(getInitCount() <= 1, true, 'no máximo 1 INIT');
  assert.ok(fs.existsSync(REPORT_PATH));
}

main().catch((err) => {
  console.error(err);
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify({
      sprint: 'MRT-16',
      fatal: true,
      erro: serializarErro(err),
      stack: err.stack
    }, null, 2));
  } catch (_) { /* ignore */ }
  process.exit(1);
});
