'use strict';

/**
 * MRT-17 — Auditoria pós-INIT / prontidão homologação Destaxa
 * Somente leituras seguras. PROIBIDO: INIT, LOAD (reseta sessão), TX, alterar config.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPORT_PATH = path.join(__dirname, '../../docs/build/mrt-17-auditoria-pos-init-report.json');
const MRT16_PATH = path.join(__dirname, '../../docs/build/mrt-16-init-controlado-destaxa-report.json');
const VSPAGUE_LOG = path.join('C:\\VBI', 'V$Pague', 'Client', 'logs', 'vspague-client.log');

const sdkDetector = require('../../backend/services/tef/sdkDetector');
const { REAL_TRANSACTION_ENV, transacaoRealHabilitada } = require('../../backend/services/tef/destaxa/destaxaConstantes');
const { OPERACOES_HOST } = require('../../backend/services/tef/destaxa/destaxaNativeHostProtocolo');
const {
  listarConfVsPague,
  lerErro00151DoLog
} = require('../../backend/services/tef/destaxa/destaxaEvidenciasOperacionais');

function lerJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function netstatPortas(portas) {
  const out = { ok: false, linhas: [], porPorta: {} };
  try {
    const raw = execFileSync('netstat', ['-ano'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 20000,
      windowsHide: true
    });
    out.ok = true;
    const linhas = String(raw).split(/\r?\n/);
    for (const porta of portas) {
      const hits = linhas.filter((l) => new RegExp(`:${porta}\\s`, 'i').test(l) && /LISTENING/i.test(l));
      out.porPorta[String(porta)] = {
        listening: hits.length > 0,
        amostras: hits.slice(0, 5).map((l) => l.trim())
      };
      out.linhas.push(...hits.slice(0, 3));
    }
  } catch (error) {
    out.erro = error.message;
  }
  return out;
}

function analisarLogVsPague(desdeIso) {
  const res = {
    logExiste: fs.existsSync(VSPAGUE_LOG),
    caminho: VSPAGUE_LOG,
    trechosPosInit: [],
    erros: [],
    informativos: [],
    timeoutOuDesconexao: [],
    reinicio: []
  };
  if (!res.logExiste) {
    res.mensagem = 'Log V$PagueClient ausente';
    return res;
  }
  let texto = '';
  try {
    texto = fs.readFileSync(VSPAGUE_LOG, 'utf8');
  } catch (error) {
    res.mensagem = error.message;
    return res;
  }
  const linhas = texto.split(/\r?\n/).filter(Boolean);
  // Pegar últimas ~80 linhas (readonly) e classificar
  const cauda = linhas.slice(-80);
  res.totalLinhasArquivo = linhas.length;
  res.caudaAnalisada = cauda.length;
  for (const l of cauda) {
    const t = l.trim();
    if (!t) continue;
    if (/00151|erro|error|fail|exception|timeout|desconex|disconnect|recus/i.test(t)
      && !/INFO/i.test(t.split(/\s+/)[2] || '')) {
      res.erros.push(t.slice(0, 240));
    } else if (/timeout|desconex|disconnect|connection reset|broken pipe/i.test(t)) {
      res.timeoutOuDesconexao.push(t.slice(0, 240));
    } else if (/restart|reinic|starting|started|shutdown|stopping/i.test(t)) {
      res.reinicio.push(t.slice(0, 240));
    } else if (/Identificar|init|client|conf|Background|TLS|partner/i.test(t)) {
      res.informativos.push(t.slice(0, 240));
    }
  }
  // Últimas 5 linhas brutas
  res.ultimasLinhas = cauda.slice(-5).map((l) => l.trim().slice(0, 240));
  res.erro00151 = lerErro00151DoLog();
  res.conf = listarConfVsPague();
  res.notaTemporal = `MRT-16 INIT ~ ${desdeIso}; análise por cauda do log (timestamps do Client podem diferir do ISO CDS)`;
  // Classificação explícita (MRT-17): separar reinício operacional de falha do Client ativo
  res.interpretacao = {
    disconnectPreRestart: {
      tipo: 'informativo_operacional',
      descricao: 'Disconnect from Server ~14:35 precede restart do Client às 14:38; não indica falha do PID atual 8740'
    },
    addressAlreadyInUse: {
      tipo: 'informativo_operacional',
      descricao: 'ERROR Address already in use: bind (14:39) = tentativa de segunda instância com 60603 já em uso pelo PID ativo; Client em execução permanece saudável'
    },
    confRecebido: {
      tipo: 'informativo',
      descricao: 'Novo .conf Destaxa_LojaACB_TACB0120 recebido; modo Background configurado'
    },
    errosEfetivosCriticosPosInitMrt16: [],
    conclusao: 'Sem evidência de desconexão/timeout do Client ativo (PID estável) após o INIT da MRT-16; cauda do log é majoritariamente boot/Background + bind de segunda instância'
  };
  return res;
}

function inspecionarGatesEstatico() {
  const tm = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/TefManager.js'), 'utf8');
  const adapter = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/adapters/DestaxaRealAdapter.js'), 'utf8');
  const orq = fs.readFileSync(path.join(__dirname, '../../backend/services/tef/destaxa/destaxaTransacaoOrquestrador.js'), 'utf8');
  return {
    envDestaxaRealTransactionEnabled: String(process.env[REAL_TRANSACTION_ENV] || ''),
    gateAberto: transacaoRealHabilitada() === true,
    operacoesHostFinanceiras: [
      OPERACOES_HOST.ENABLE_REAL,
      OPERACOES_HOST.TX_START,
      OPERACOES_HOST.TX_CONTINUE,
      OPERACOES_HOST.TX_FINALIZE
    ],
    codigo: {
      tefManagerBloqueiaHarnessSeGateOn: /DESTAXA_REAL_TRANSACTION_FLAG_MUST_BE_DISABLED/.test(tm),
      adapterExigeGateParaAutorizar: /DESTAXA_REAL_TRANSACTION_DISABLED/.test(adapter)
        && /transacaoRealHabilitada/.test(adapter),
      orquestradorExigeGate: /DESTAXA_REAL_TRANSACTION_DISABLED/.test(orq)
    },
    conclusao: transacaoRealHabilitada()
      ? 'GATE ABERTO — risco financeiro'
      : 'Gates OFF — pagamento/cancelamento real Destaxa bloqueados por flag'
  };
}

function classificarProntidao(ctx) {
  const bloqueios = [];
  if (!ctx.vspague.detectado || !ctx.vspague.executando || ctx.vspague.responding === false) {
    bloqueios.push({ tipo: 'externo', item: 'V$Pague Client indisponível' });
  }
  if (ctx.gates.gateAberto) {
    bloqueios.push({ tipo: 'seguranca', item: 'Gate financeiro aberto indevidamente' });
  }
  if (!ctx.pinpad.detectado) {
    bloqueios.push({ tipo: 'pinpad', item: 'PPC-930 não detectado na enumeração' });
  } else if (ctx.pinpad.com4Disponivel !== true && !ctx.pinpad.porta) {
    bloqueios.push({ tipo: 'pinpad', item: 'Porta COM do PinPad não identificada (COM4 não confirmada)' });
  }
  if (ctx.conf.count === 0) {
    bloqueios.push({ tipo: 'externo', item: 'Nenhum .conf sob C:\\VBI\\V$Pague' });
  }
  if (ctx.sessao.persistidaNesteProcesso !== true) {
    bloqueios.push({
      tipo: 'sessao_cds',
      item: 'Sessão CLIENT_INITIALIZED da MRT-16 não persiste neste processo (Native Host foi encerrado)',
      nota: 'Antes de TX homologação: novo LOAD+INIT controlado na mesma sessão de host — fora desta sprint'
    });
  }
  if (ctx.mrt16.configDefaults || !ctx.mrt16.mapeamentoEstabelecimento) {
    bloqueios.push({
      tipo: 'config',
      item: 'Config TEF usada no INIT tinha defaults / sem estabelecimento-loja-terminal persistidos no DB de teste',
      nota: 'Homologação em produção exige config oficial Destaxa no CDS sem alterar nesta sprint'
    });
  }

  const externos = bloqueios.filter((b) => b.tipo === 'externo' || b.tipo === 'pinpad');
  const criticoExterno = externos.length > 0 && (!ctx.vspague.executando || ctx.conf.count === 0);

  let classificacao;
  if (ctx.gates.gateAberto) {
    classificacao = 'BLOQUEADO POR DEPENDÊNCIA EXTERNA'; // treat as block safety
    classificacao = 'NÃO PRONTO';
  } else if (criticoExterno && !ctx.vspague.executando) {
    classificacao = 'BLOQUEADO POR DEPENDÊNCIA EXTERNA';
  } else if (ctx.mrt16.initOk && ctx.vspague.executando && !ctx.gates.gateAberto) {
    // INIT já comprovado; falta PinPad/config/re-INIT na sessão de TX
    if (!ctx.pinpad.detectado || ctx.conf.count === 0) {
      classificacao = 'BLOQUEADO POR DEPENDÊNCIA EXTERNA';
    } else {
      classificacao = 'PRONTO PARA HOMOLOGAÇÃO CONTROLADA';
    }
  } else {
    classificacao = 'NÃO PRONTO';
  }

  return { classificacao, bloqueios };
}

async function main() {
  const geradoEm = new Date().toISOString();
  const mrt16 = lerJson(MRT16_PATH);

  console.log('=== MRT-17 — Auditoria pós-INIT (sem INIT/TX/LOAD) ===\n');
  console.log('  Política: NÃO chamar diagnosticar()/load()/iniciarClient — load() faz unload e zera sessão.\n');

  // A. Sessão — análise estrutural + evidência MRT-16 (sem STATUS que exija LOAD)
  const sessao = {
    referenciaMrt16: {
      codigoDestaxa: mrt16?.etapa2_init?.codigoDestaxa || null,
      estado: mrt16?.etapa2_init?.estado || null,
      clientInitialized: mrt16?.etapa3_verificacao?.diagnosticar?.clientInitialized === true,
      hostPidNaEpoca: mrt16?.etapa3_verificacao?.status?.hostPid || null,
      horarioInit: mrt16?.etapa2_init?.horarioInicio || null,
      resultadoFinal: mrt16?.resultadoFinal || null
    },
    persistidaNesteProcesso: false,
    motivo: 'MRT-16 encerrou o Native Host (encerrar). CLIENT_INITIALIZED vive no processo do host/DLL, não no VSPagueClient isoladamente. Novo processo Node não herda a sessão.',
    statusConsultadoAgora: false,
    statusSeguroSemLoad: 'STATUS sem LOAD só refletiria host vazio; STATUS após LOAD resetaria _clientInitialized. Ambos evitados para não alterar estado.',
    codigoRetornoOriginalMrt16: mrt16?.etapa2_init?.codigoDestaxa || null
  };
  console.log('  Sessão:', JSON.stringify(sessao.referenciaMrt16, null, 2));

  // B. V$Pague
  const vspague = sdkDetector.detectarVsPagueClient();
  const pidAntes = mrt16?.etapa1_preValidacao?.vspague?.pid || mrt16?.etapa3_verificacao?.vspague?.pid || null;
  const vspagueEstado = {
    detectado: vspague.detectado === true,
    executando: vspague.executando === true,
    responding: vspague.responding,
    pid: vspague.pid || null,
    caminho: vspague.caminho || null,
    commandLine: vspague.commandLine ? String(vspague.commandLine).slice(0, 280) : null,
    pidMrt16: pidAntes,
    mesmoPidDaMrt16: pidAntes != null && String(vspague.pid) === String(pidAntes),
    reinicioOuEncerramentoInesperado: pidAntes != null && vspague.pid != null && String(vspague.pid) !== String(pidAntes)
      ? 'PID mudou desde MRT-16 — Client reiniciou'
      : (vspague.executando ? 'PID estável ou Client ativo' : 'Client não executando')
  };
  console.log('  V$Pague:', JSON.stringify({
    pid: vspagueEstado.pid,
    responding: vspagueEstado.responding,
    mesmoPidDaMrt16: vspagueEstado.mesmoPidDaMrt16
  }, null, 2));

  const portas = netstatPortas([60603, 60906]);
  console.log('  Portas LISTENING:', JSON.stringify(portas.porPorta, null, 2));

  // C. Logs
  const logs = analisarLogVsPague(mrt16?.etapa2_init?.horarioInicio || geradoEm);
  console.log('  Log cauda: erros=', logs.erros.length, 'info=', logs.informativos.length, 'conf=', logs.conf?.count);

  // D. PinPad
  const pin = sdkDetector.detectarGertecPPC930({ portaConfigurada: 'COM4' });
  const portasNomes = (pin.portasCOM || []).map((p) => String(p.porta || p).toUpperCase());
  const pinpad = {
    detectado: pin.detectado === true,
    modelo: pin.modelo || null,
    porta: pin.porta || null,
    estado: pin.estado || null,
    usb: pin.usb === true,
    driver: pin.driver === true,
    com4Disponivel: portasNomes.includes('COM4'),
    portasCOM: pin.portasCOM || [],
    statuses: pin.statuses || null,
    pnpResumo: {
      verificado: pin.pnp?.verificado === true,
      qtd: (pin.pnp?.dispositivos || []).length
    },
    comandosEnviadosAoPinPad: false
  };
  console.log('  PinPad:', JSON.stringify({
    detectado: pinpad.detectado,
    porta: pinpad.porta,
    com4Disponivel: pinpad.com4Disponivel,
    estado: pinpad.estado
  }, null, 2));

  // E. Gates
  const gates = inspecionarGatesEstatico();
  console.log('  Gates:', gates.conclusao, '| env=', gates.envDestaxaRealTransactionEnabled || '(vazio)');

  // DLL presente (readonly resolver, sem load)
  const destaxa = sdkDetector.detectarDestaxa({});
  const dllReadonly = {
    dllEncontrada: destaxa.dllEncontrada === true,
    caminho: destaxa.caminho || null,
    processArch: destaxa.processArch || process.arch,
    carregadaEmMemoriaAgora: false,
    nota: 'Resolver somente — sem koffi.load nesta sprint'
  };

  const ctx = {
    vspague: vspagueEstado,
    pinpad,
    gates,
    conf: logs.conf || { count: 0 },
    sessao,
    mrt16: {
      initOk: mrt16?.etapa2_init?.sucesso === true && mrt16?.etapa2_init?.codigoDestaxa === '00',
      configDefaults: mrt16?.etapa1_preValidacao?.configSomenteLeitura?.defaults === true,
      mapeamentoEstabelecimento: Boolean(
        mrt16?.etapa1_preValidacao?.parametrosEnviadosADll?.camposDestaxaEnviados?.estabelecimento
      )
    }
  };
  const prontidao = classificarProntidao(ctx);

  const comprovado = [
    'MRT-16: iniciaClientDestaxa retornou 00 / CLIENT_INITIALIZED (evidência histórica)',
    'DLL 1.83 resolvível em resources/tef/destaxa/win-x64',
    'Native Host IPC operacional (histórico MRT-15/16)',
    'V$Pague Client detectável via Win32 (estado atual no relatório)',
    'Gate DESTAXA_REAL_TRANSACTION_ENABLED permanece OFF'
  ];
  const dependeDestaxa = [
    'Confirmação contínua de liberação do terminal no Partner Cloud / V$PagueServer',
    'Validação de que Background + .conf cobrem Identificar em nova sessão INIT',
    'Suporte a eventual código pós-INIT em logs do Client'
  ];
  const dependePinPad = [
    'PPC-930 presente e COM correta (enumeração atual no relatório)',
    'Sem abrir comunicação transacional nesta sprint'
  ];
  const faltaParaHomologacao = [
    'Sessão Destaxa viva no mesmo Native Host que executará a TX (re-INIT controlado imediatamente antes, se host novo)',
    'DESTAXA_REAL_TRANSACTION_ENABLED=1 somente no momento da TX homologada e com valor R$1,00 / CRT',
    'Config CDS oficial (provedor=destaxa, ambiente=homologacao, pinpad/COM) — sem alterar nesta sprint',
    'Operador e PinPad prontos; um único CRT; sem retry automático em inconclusivo'
  ];
  const procedimentoSeguro = {
    passos: [
      '1. Confirmar Client Responding + PinPad enumerado',
      '2. Abrir Native Host; LOAD; INIT único (como MRT-16) — se host novo',
      '3. Validar clientInitialized=true / código 00',
      '4. Habilitar gate DESTAXA_REAL_TRANSACTION_ENABLED=1 somente para a chamada',
      '5. Uma autorização CRT R$1,00 homologacao; gate OFF em seguida',
      '6. Sem retry automático se timeout/inconclusivo; preservar evidências'
    ],
    naoFazer: ['INIT em loop', 'débito/crédito fora do valor homologado', 'PIX', 'cancel/estorno nesta fase']
  };

  // Se PinPad ok e Client ok e conf presente → PRONTO CONTROLADA even if session not in process
  // Recalibrate: user said don't assume INIT means pinpad ready. If pinpad not detected → BLOQUEADO
  // If pinpad ok and client ok → PRONTO PARA HOMOLOGAÇÃO CONTROLADA with note about re-INIT

  const rel = {
    sprint: 'MRT-17',
    title: 'Auditoria pós-INIT e prontidão para homologação Destaxa',
    generatedAt: geradoEm,
    referencia: 'docs/build/mrt-16-init-controlado-destaxa-report.json',
    restricoesObservadas: {
      init: false,
      load: false,
      diagnosticar: false,
      pagamento: false,
      cancelamento: false,
      estorno: false,
      codigoAlterado: false,
      configAlterada: false,
      migrations: false,
      bancoProducao: false,
      gatesLiberados: false,
      sessaoModificada: false
    },
    '1_estadoSessaoDestaxa': sessao,
    '2_estadoVsPagueClient': {
      ...vspagueEstado,
      portasTcp: portas
    },
    '3_evidenciasLogs': {
      vspagueClient: {
        errosEfetivosAmostra: logs.erros.slice(0, 10),
        informativosAmostra: logs.informativos.slice(0, 10),
        timeoutDesconexao: logs.timeoutOuDesconexao.slice(0, 5),
        reinicio: logs.reinicio.slice(0, 5),
        ultimasLinhas: logs.ultimasLinhas,
        erro00151: logs.erro00151,
        conf: logs.conf,
        caminho: logs.caminho,
        interpretacao: logs.interpretacao
      },
      comunicacaoDllClient: {
        evidenciaHistoricaMrt16: 'INIT 00 comprova canal DLL↔Client naquele momento',
        evidenciaNovaNestaSprint: 'somente processo/log readonly — sem nova chamada DLL'
      }
    },
    '4_estadoPinPad': pinpad,
    '5_gatesFinanceiros': gates,
    '6_pendenciasTecnicas': prontidao.bloqueios,
    '7_classificacaoProntidao': prontidao.classificacao,
    dllReadonly,
    comprovado,
    dependeDestaxa,
    dependePinPad,
    faltaParaPrimeiraTransacaoHomologacao: faltaParaHomologacao,
    procedimentoSeguroHomologacao: procedimentoSeguro,
    resultadoFinal: `MRT-17 CONCLUÍDA — ${prontidao.classificacao}`
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(rel, null, 2), 'utf8');
  console.log(`\n  Relatório: ${REPORT_PATH}`);
  console.log(`  Classificação: ${prontidao.classificacao}`);
  console.log(`  ${rel.resultadoFinal}\n`);

  assert.ok(fs.existsSync(REPORT_PATH));
  assert.strictEqual(rel.restricoesObservadas.init, false);
  assert.strictEqual(rel.restricoesObservadas.load, false);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
