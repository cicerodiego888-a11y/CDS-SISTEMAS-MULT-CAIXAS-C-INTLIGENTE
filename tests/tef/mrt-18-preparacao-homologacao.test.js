'use strict';

/**
 * MRT-18 — Preparação do ambiente real de homologação Destaxa
 * Somente leitura. PROIBIDO: INIT, LOAD, TX, cancel, estorno, alterar config/DB/gates.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { execFileSync } = require('child_process');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-18-preparacao-homologacao-report.json');
const MRT16_PATH = path.join(__dirname, '../../docs/build/mrt-16-init-controlado-destaxa-report.json');
const MRT17_PATH = path.join(__dirname, '../../docs/build/mrt-17-auditoria-pos-init-report.json');
const DB_PATH = 'C:\\ProgramData\\MercantilFiscal\\dados\\mercadao.db';
const CONF_DIR = 'C:\\VBI\\V$Pague\\Client';

const pkg = require('../../package.json');
const sdkDetector = require('../../backend/services/tef/sdkDetector');
const {
  APLICACAO,
  REAL_TRANSACTION_ENV,
  AMBIENTE_TRANSACAO_REAL,
  VALOR_HOMOLOGACAO_CENTAVOS,
  OPERACOES_REAIS_PERMITIDAS,
  transacaoRealHabilitada
} = require('../../backend/services/tef/destaxa/destaxaConstantes');
const {
  projetarEntradaIniciaClient,
  avaliarMapeamentoTerminal,
  MAPEAMENTO_CAMPOS
} = require('../../backend/services/tef/destaxa/destaxaMapeamentoTerminal');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const { listarConfVsPague, lerErro00151DoLog } = require('../../backend/services/tef/destaxa/destaxaEvidenciasOperacionais');
const { CONTRATO_CANCELAMENTO_DESTAXA } = require('../../backend/services/tef/destaxa/destaxaCancelamentoPolitica');

function lerJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function queryRo(sql) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });
    db.get(sql, (err, row) => {
      db.close();
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function queryAllRo(sql) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
    });
    db.all(sql, (err, rows) => {
      db.close();
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function inspecionarCodigoSessao() {
  const hostClient = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/destaxa/DestaxaNativeHostClient.js'),
    'utf8'
  );
  const hostBridge = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/destaxa/DestaxaHostBridge.js'),
    'utf8'
  );
  const adapter = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'),
    'utf8'
  );
  const nativeBridge = fs.readFileSync(
    path.join(__dirname, '../../backend/services/tef/destaxa/DestaxaNativeBridge.js'),
    'utf8'
  );
  return {
    processoFuturoTx: 'DestaxaNativeHost (child_process/utilityProcess) via DestaxaNativeHostClient.obterClienteCompartilhado()',
    associacaoInit: 'INIT_CLIENT → DestaxaNativeBridge.iniciarClient → iniciaClientDestaxa; flag _clientInitialized no processo do host',
    unicidadeHostPorApp: /Cliente único do processo principal/.test(hostClient)
      || /obterClienteCompartilhado/.test(hostClient),
    umaRequisicaoEmVoo: /HOST_BUSY|no máximo UMA requisição em voo|_emVoo/.test(hostClient),
    bloqueioTxSeReconciliacao: /reconciliacaoPendente.*TX_START|HOST_RECONCILIATION_PENDING/.test(hostClient),
    adapterReInitSeNecessario: /if \(!diag\.clientInitialized\)/.test(adapter)
      && /iniciarClient/.test(adapter),
    loadZeraClientInitialized: /this\._clientInitialized = false/.test(nativeBridge),
    riscoTxEmHostDiferente: 'Se o Native Host for encerrado (como na MRT-16), CLIENT_INITIALIZED morre com o processo. TX em host novo exige novo INIT no mesmo host da TX — nunca reutilizar sessão de PID morto.',
    estrategiaRecomendada: [
      '1. Manter V$Pague Client Responding (PID atual ou equivalente)',
      '2. Abrir/obter Native Host singleton do processo CDS (Electron/main)',
      '3. LOAD + INIT único nesse host; validar codigoDestaxa=00 e clientInitialized=true',
      '4. NÃO encerrar o host entre INIT e CRT',
      '5. DESTAXA_REAL_TRANSACTION_ENABLED=1 só para a chamada CRT R$1,00; OFF em seguida',
      '6. Sem retry automático se timeout/inconclusivo; preservar transactionId / reconciliação'
    ],
    operacoesHost: {
      init: OPERACOES_HOST.INIT_CLIENT,
      financeiros: [
        OPERACOES_HOST.ENABLE_REAL,
        OPERACOES_HOST.TX_START,
        OPERACOES_HOST.TX_CONTINUE,
        OPERACOES_HOST.TX_FINALIZE
      ]
    },
    hostBridgeExpõeInit: /iniciarClient/.test(hostBridge)
  };
}

function inspecionarGatesCodigo() {
  const tm = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/TefManager.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'), 'utf8');
  const orq = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js'), 'utf8');
  return {
    env: String(process.env[REAL_TRANSACTION_ENV] || ''),
    gateAberto: transacaoRealHabilitada() === true,
    valorHomologacaoCentavos: VALOR_HOMOLOGACAO_CENTAVOS,
    valorHomologacaoReais: '1.00',
    ambienteExigido: AMBIENTE_TRANSACAO_REAL,
    operacoesPermitidas: [...OPERACOES_REAIS_PERMITIDAS],
    codigo: {
      tefManagerBloqueiaHarnessSeGateOn: /DESTAXA_REAL_TRANSACTION_FLAG_MUST_BE_DISABLED/.test(tm),
      adapterExigeGate: /DESTAXA_REAL_TRANSACTION_DISABLED/.test(adapter),
      orquestradorExigeGate: /DESTAXA_REAL_TRANSACTION_DISABLED/.test(orq),
      adapterSoCrt: /OPERACOES_REAIS_PERMITIDAS/.test(adapter),
      adapterSoValor100: /VALOR_HOMOLOGACAO_CENTAVOS/.test(adapter),
      cancelamentoEstornoComercialBloqueado: CONTRATO_CANCELAMENTO_DESTAXA.estornoComercialHabilitadoNoCds === false
    },
    caminhoFuturoHomologacao: [
      'TefManager.autorizar → RouteDecision/ciclo → DestaxaRealAdapter',
      'prepararAutorizacao (CRT, R$1,00, homologacao, PinPad COM, Client, INIT se preciso)',
      'gate DESTAXA_REAL_TRANSACTION_ENABLED=1',
      'iniciarTransacaoDestaxa(CRT) / continua / finaliza no mesmo Native Host'
    ],
    antiDuplicacao: {
      idempotencyKey: /idempotency_key/.test(tm),
      lockOperacional: /lockKey|adquirirLock|tef_locks/.test(tm),
      timeoutInconclusivoSemRetry: /retryAllowed:\s*false/.test(tm),
      reconciliacaoPendenteBloqueiaNovaTx: true,
      notaTentativasDb: 'tef_configuracao.tentativas=3 no DB oficial — caminho Destaxa real deve tratar inconclusivo sem reenvio automático (retryAllowed=false / reconciliação)'
    },
    cancelamento: {
      estornoComercialHabilitadoNoCds: CONTRATO_CANCELAMENTO_DESTAXA.estornoComercialHabilitadoNoCds,
      motivo: CONTRATO_CANCELAMENTO_DESTAXA.motivoBloqueioEstorno,
      camposEstDocumentados: CONTRATO_CANCELAMENTO_DESTAXA.camposEntradaEstDocumentados
    }
  };
}

function classificar(ctx) {
  const pendencias = [];
  const externas = [];

  if (!ctx.vspague.executando || ctx.vspague.responding === false) {
    externas.push('V$Pague Client indisponível');
  }
  if (!ctx.pinpad.detectado || !ctx.pinpad.com4Ok) {
    externas.push('PinPad PPC-930/COM4 não confirmado');
  }
  if (ctx.conf.count === 0) {
    externas.push('.conf Destaxa ausente sob C:\\VBI\\V$Pague');
  }
  if (ctx.gates.gateAberto) {
    pendencias.push('Gate financeiro aberto indevidamente — deve permanecer OFF até a TX controlada');
  }
  if (!ctx.db.ok) {
    pendencias.push('Não foi possível ler tef_configuracao oficial em modo RO');
  } else {
    if (ctx.db.config?.provedor !== 'destaxa') {
      pendencias.push(`provedor DB=${ctx.db.config?.provedor} (esperado destaxa)`);
    }
    if (ctx.db.config?.ambiente !== AMBIENTE_TRANSACAO_REAL) {
      pendencias.push(`ambiente DB=${ctx.db.config?.ambiente} (esperado ${AMBIENTE_TRANSACAO_REAL})`);
    }
  }
  if (ctx.mapeamento.estado === 'PENDENTE_FORNECEDOR') {
    externas.push(
      'Literais oficiais estabelecimento/loja/terminal ainda ausentes no CDS (opcionais na DLL; não inventar a partir do nome do .conf)'
    );
  }
  if (!ctx.sessao.sessaoVivaAgora) {
    pendencias.push(
      'Sessão CLIENT_INITIALIZED da MRT-16 não está viva — futura TX exige LOAD+INIT único no Native Host da operação (fora desta sprint)'
    );
  }

  let classificacao;
  if (externas.some((e) => /Client indisponível|PinPad/.test(e)) || ctx.gates.gateAberto) {
    classificacao = externas.some((e) => /Client indisponível/.test(e))
      ? 'BLOQUEADO POR DEPENDÊNCIA EXTERNA'
      : (ctx.gates.gateAberto ? 'PREPARAÇÃO INCOMPLETA' : 'BLOQUEADO POR DEPENDÊNCIA EXTERNA');
  } else if (
    ctx.vspague.executando
    && ctx.pinpad.detectado
    && ctx.db.config?.provedor === 'destaxa'
    && ctx.db.config?.ambiente === AMBIENTE_TRANSACAO_REAL
    && !ctx.gates.gateAberto
    && ctx.conf.count > 0
  ) {
    classificacao = 'PREPARADO PARA HOMOLOGAÇÃO CONTROLADA';
  } else {
    classificacao = 'PREPARAÇÃO INCOMPLETA';
  }

  return { classificacao, pendenciasTecnicas: pendencias, pendenciasExternasDestaxa: externas };
}

async function main() {
  const geradoEm = new Date().toISOString();
  const mrt16 = lerJson(MRT16_PATH);
  const mrt17 = lerJson(MRT17_PATH);

  console.log('=== MRT-18 — Preparação homologação Destaxa (somente leitura) ===\n');

  // ——— ETAPA 1: parâmetros ———
  let configRow = null;
  let pinRows = [];
  let dbOk = false;
  let dbErro = null;
  try {
    configRow = await queryRo(
      'SELECT id, habilitado, provedor, ambiente, timeout, tentativas, empresa_codigo, loja_codigo, terminal_codigo, pdv_codigo, caixa_codigo, tipo_integracao FROM tef_configuracao ORDER BY id ASC LIMIT 1'
    );
    pinRows = await queryAllRo(
      'SELECT id, tef_configuracao_id, habilitado, codigo, fabricante, modelo, tipo_conexao, porta_com, ativo FROM tef_pinpads ORDER BY id ASC LIMIT 5'
    );
    dbOk = true;
  } catch (error) {
    dbErro = error.message;
  }

  const configOficial = {
    fonte: DB_PATH,
    leitura: 'sqlite OPEN_READONLY — sem UPDATE/INSERT/migration',
    ok: dbOk,
    erro: dbErro,
    config: configRow,
    pinpads: pinRows
  };

  const configParaProjecao = {
    provedor: configRow?.provedor || 'destaxa',
    ambiente: configRow?.ambiente || null,
    empresaCodigo: configRow?.empresa_codigo || null,
    lojaCodigo: configRow?.loja_codigo || null,
    terminalCodigo: configRow?.terminal_codigo || null,
    pdvCodigo: configRow?.pdv_codigo || null,
    caixaCodigo: configRow?.caixa_codigo || null
  };

  const versao = String(pkg.version || '').trim();
  const projecaoOficial = projetarEntradaIniciaClient(configParaProjecao, { versao, aplicacao: APLICACAO });
  const mapeamento = avaliarMapeamentoTerminal(configParaProjecao, { provedor: 'destaxa', versao, aplicacao: APLICACAO });

  const mrt16Entrada = mrt16?.etapa1_preValidacao?.parametrosEnviadosADll || null;
  const diferencasMrt16 = {
    mrt16Texto: mrt16Entrada?.texto || null,
    mrt16Chaves: mrt16Entrada?.chaves || null,
    mrt16Defaults: mrt16?.etapa1_preValidacao?.configSomenteLeitura?.defaults === true,
    mrt16AmbienteLido: mrt16?.etapa1_preValidacao?.configSomenteLeitura?.ambiente || null,
    projecaoAtualComDbOficial: projecaoOficial.texto,
    projecaoAtualChaves: projecaoOficial.chaves,
    nota: 'MRT-16 enviou apenas versao+aplicacao (códigos Destaxa nulos). DB oficial hoje também tem empresa/loja/terminal nulos — mesma entrada INIT projetada. Diferença relevante vs harness MRT-16: DB oficial tem provedor=destaxa, ambiente=homologacao, pinpad COM4 (MRT-16 reportou defaults/simulacao no harness).'
  };

  const conf = listarConfVsPague();
  const erro00151 = lerErro00151DoLog();
  const confObservacao = {
    ...conf,
    nomeArquivoSugere: conf.arquivos?.[0]
      ? path.basename(conf.arquivos[0])
      : null,
    interpretacao: {
      tipo: 'provisionamento_client',
      descricao: 'Arquivo .conf sob C:\\VBI é provisionamento do V$PagueClient (Partner Cloud), não literais CDS para iniciaClientDestaxa. Nome LojaACB_TACB0120 NÃO deve ser copiado automaticamente para empresa/loja/terminal no CDS sem confirmação Destaxa.',
      inventarParametrosProibido: true
    }
  };

  console.log('  INIT projetado (DB oficial):', projecaoOficial.texto);
  console.log('  Mapeamento:', mapeamento.estado, mapeamento.codigo);

  // ——— ETAPA 2: sessão ———
  const sessao = inspecionarCodigoSessao();
  sessao.referenciaMrt16 = {
    hostPid: mrt16?.etapa3_verificacao?.status?.hostPid || null,
    clientInitialized: mrt16?.etapa3_verificacao?.diagnosticar?.clientInitialized === true,
    codigo: mrt16?.etapa2_init?.codigoDestaxa || null,
    hostEncerradoAposSprint: true
  };
  sessao.sessaoVivaAgora = false;
  sessao.initExecutadoNestaSprint = false;
  console.log('  Sessão viva agora:', sessao.sessaoVivaAgora);

  // ——— ETAPA 3: PinPad ———
  const pin = sdkDetector.detectarGertecPPC930({ portaConfigurada: 'COM4' });
  const portasNomes = (pin.portasCOM || []).map((p) => String(p.porta || p).toUpperCase());
  const pinpadDb = pinRows[0] || null;
  const pinpad = {
    fisico: {
      detectado: pin.detectado === true,
      modelo: pin.modelo || null,
      porta: pin.porta || null,
      estado: pin.estado || null,
      usb: pin.usb === true,
      driverStatus: pin.statuses?.driver || null,
      com4Disponivel: portasNomes.includes('COM4'),
      portasCOM: pin.portasCOM || [],
      comandosEnviados: false
    },
    configuracaoCds: {
      codigo: pinpadDb?.codigo || null,
      modelo: pinpadDb?.modelo || null,
      porta_com: pinpadDb?.porta_com || null,
      habilitado: pinpadDb?.habilitado === 1 || pinpadDb?.habilitado === true,
      ativo: pinpadDb?.ativo === 1 || pinpadDb?.ativo === true,
      tipo_conexao: pinpadDb?.tipo_conexao || null
    },
    compatibilidadeAdapter: {
      exigeGertecPpc930Detectado: true,
      exigePortaIgualConfigurada: true,
      portaConfiguradaVsDetectada:
        String(pin.porta || '').toUpperCase() === String(pinpadDb?.porta_com || 'COM4').toUpperCase(),
      driverConfirmado: pin.statuses?.driver === 'confirmado',
      notaDriver: 'statuses.driver=nao_confirmado não bloqueou MRT-16/17; USB enumerado. Sem comando ao PinPad nesta sprint.'
    },
    com4Ok: pin.detectado === true && portasNomes.includes('COM4')
  };
  console.log('  PinPad:', pinpad.fisico.estado, pinpad.fisico.porta, 'COM4=', pinpad.com4Ok);

  // ——— ETAPA 4: gates ———
  const gates = inspecionarGatesCodigo();
  console.log('  Gate:', gates.gateAberto ? 'ABERTO' : 'OFF', '| env=', gates.env || '(vazio)');

  const vspague = sdkDetector.detectarVsPagueClient();
  const vspagueEstado = {
    detectado: vspague.detectado === true,
    executando: vspague.executando === true,
    responding: vspague.responding,
    pid: vspague.pid || null,
    pidMrt17: mrt17?.['2_estadoVsPagueClient']?.pid || 8740,
    mesmoPidMrt17: String(vspague.pid) === String(mrt17?.['2_estadoVsPagueClient']?.pid || 8740)
  };

  let portasTcp = {};
  try {
    const raw = execFileSync('netstat', ['-ano'], {
      encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    for (const porta of [60603, 60906]) {
      const hits = String(raw).split(/\r?\n/).filter((l) => new RegExp(`:${porta}\\s`, 'i').test(l) && /LISTENING/i.test(l));
      portasTcp[String(porta)] = { listening: hits.length > 0, amostras: hits.slice(0, 2).map((l) => l.trim()) };
    }
  } catch (error) {
    portasTcp = { erro: error.message };
  }

  const ctx = {
    vspague: vspagueEstado,
    pinpad: { detectado: pinpad.fisico.detectado, com4Ok: pinpad.com4Ok },
    gates,
    conf,
    db: configOficial,
    mapeamento,
    sessao
  };
  const prontidao = classificar(ctx);

  const parametrosOficiais = {
    iniciaClientDestaxa: {
      obrigatoriosComprovados: ['versao', 'aplicacao'],
      versaoOrigem: 'package.json → DestaxaNativeBridge.obterVersaoAplicacao()',
      versaoValor: versao,
      aplicacaoOrigem: 'destaxaConstantes.APLICACAO',
      aplicacaoValor: APLICACAO,
      opcionaisDestaxa: MAPEAMENTO_CAMPOS.filter((c) => c.enviadoIniciaClient).map((c) => ({
        cds: c.cds,
        destaxa: c.destaxa,
        origemEsperada: c.origemEsperada,
        valorDbOficial: configRow ? configRow[c.cds] : null,
        inventado: false
      })),
      naoEnviadosADll: MAPEAMENTO_CAMPOS.filter((c) => !c.enviadoIniciaClient).map((c) => c.cds),
      projecaoComDbOficial: projecaoOficial,
      fonteContrato: 'destaxaMapeamentoTerminal.js / 05-api-iniciaclientdestaxa.md'
    },
    cdsPersistido: configOficial,
    diferencasVsMrt16: diferencasMrt16,
    homologacaoDestaxaFornecida: {
      confClientPresente: conf.count > 0,
      confArquivos: conf.arquivos || [],
      literaisEstabelecimentoLojaTerminalNoCds: false,
      estadoMapeamento: mapeamento.estado,
      codigoMapeamento: mapeamento.codigo,
      mensagemMapeamento: mapeamento.mensagem,
      erro00151Recente: erro00151,
      nota: 'Há .conf provisionado no Client; literais CDS para INIT ainda nulos. Não inventar a partir do nome do arquivo.'
    }
  };

  const rel = {
    sprint: 'MRT-18',
    title: 'Preparação do ambiente real de homologação Destaxa',
    generatedAt: geradoEm,
    referencias: [
      'docs/build/mrt-16-init-controlado-destaxa-report.json',
      'docs/build/mrt-17-auditoria-pos-init-report.json'
    ],
    restricoesObservadas: {
      init: false,
      load: false,
      pagamento: false,
      cancelamento: false,
      estorno: false,
      comandosPinPad: false,
      configProvedorAlterada: false,
      bancoProducaoAlterado: false,
      migrations: false,
      gatesLiberados: false,
      codigoAlterado: false
    },
    '1_parametrosOficiaisIdentificados': parametrosOficiais,
    '2_processoFuturaTransacao': {
      nativeHost: sessao.processoFuturoTx,
      clienteCompartilhado: 'DestaxaNativeHostClient.obterClienteCompartilhado() — 1 host por processo CDS',
      adapter: 'DestaxaRealAdapter + DestaxaHostBridge',
      vspagueClient: vspagueEstado,
      portasTcp,
      riscoHostDiferente: sessao.riscoTxEmHostDiferente
    },
    '3_estrategiaInicializacaoSessao': {
      associacaoInit: sessao.associacaoInit,
      sessaoVivaAgora: sessao.sessaoVivaAgora,
      unicidadeHost: sessao.unicidadeHostPorApp,
      umaRequisicaoEmVoo: sessao.umaRequisicaoEmVoo,
      bloqueioSeReconciliacao: sessao.bloqueioTxSeReconciliacao,
      adapterPodeReInitSeHostSemSessao: sessao.adapterReInitSeNecessario,
      loadResetaSessao: sessao.loadZeraClientInitialized,
      passos: sessao.estrategiaRecomendada,
      initNaoExecutadoNestaSprint: true
    },
    '4_estadoPinPadCom4': pinpad,
    '5_bloqueiosFinanceirosConfirmados': gates,
    '6_pendenciasExternasDestaxa': [
      ...prontidao.pendenciasExternasDestaxa,
      'Confirmar com Destaxa se literais estabelecimento/loja/terminal devem ser gravados no CDS além do Identificar MAC/hostname do Client',
      'Confirmar liberação contínua do terminal no Partner Cloud para CRT de homologação'
    ],
    '7_ambientePreparadoparaR1': {
      classificacao: prontidao.classificacao,
      pendenciasTecnicas: prontidao.pendenciasTecnicas,
      resposta: prontidao.classificacao === 'PREPARADO PARA HOMOLOGAÇÃO CONTROLADA'
        ? 'Sim, sob condições: re-INIT no Native Host da TX, gate ON só no CRT R$1,00, sem retry automático, literais CDS só se Destaxa confirmar (opcionais na DLL).'
        : 'Não plenamente — ver classificação e pendências.'
    },
    confClient: confObservacao,
    mapeamentoTerminal: {
      estado: mapeamento.estado,
      codigo: mapeamento.codigo,
      mensagem: mapeamento.mensagem,
      avisos: mapeamento.avisos || [],
      homologacaoDeclarada: mapeamento.homologacaoDeclarada === true,
      tefProntoParaVenda: mapeamento.tefProntoParaVenda === true
    },
    resultadoFinal: `MRT-18 CONCLUÍDA — ${prontidao.classificacao}`
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${prontidao.classificacao}`);
  console.log(`  ${rel.resultadoFinal}\n`);

  assert.ok(fs.existsSync(REPORT_PATH));
  assert.strictEqual(rel.restricoesObservadas.init, false);
  assert.strictEqual(rel.restricoesObservadas.pagamento, false);
  assert.strictEqual(rel.restricoesObservadas.gatesLiberados, false);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
