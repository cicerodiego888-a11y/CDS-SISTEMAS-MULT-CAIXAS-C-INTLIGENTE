'use strict';

/**
 * Evidências operacionais Destaxa/V$Pague (somente leitura).
 * MRT-41 — cada indicador exige evidência da capacidade nomeada.
 * Não chama INIT_CLIENT nem funções financeiras.
 * Existência de DLL/processo/COM/dispositivo ≠ TEF pronto para venda.
 */

const fs = require('fs');
const path = require('path');
const {
  avaliarMapeamentoTerminal,
  MAPEAMENTO_CAMPOS
} = require('./destaxaMapeamentoTerminal');

const ESTADOS_INDICADOR = Object.freeze({
  CONFIRMADO: 'CONFIRMADO',
  NAO_VALIDADO: 'NAO_VALIDADO',
  INDISPONIVEL: 'INDISPONIVEL',
  BLOQUEADO: 'BLOQUEADO'
});

const VSPAGUE_CLIENT_DIR = path.join('C:\\VBI', 'V$Pague', 'Client');
const VSPAGUE_LOG = path.join(VSPAGUE_CLIENT_DIR, 'logs', 'vspague-client.log');
const INIT_HISTORICO_PPC930_05 = Object.freeze({
  fonte: 'docs/build/tef-ppc930-05-report.json',
  codigoDestaxa: '00',
  estado: 'CLIENT_INITIALIZED',
  entrada: 'versao=1.0.3;aplicacao=CDS Sistemas',
  nota: 'Último INIT_CLIENT comprovado em TEF-PPC930-05; este diagnóstico não reexecuta INIT_CLIENT nem o trata como sessão atual.'
});

/** Capacidades obrigatórias para TEF pronto para venda (todas CONFIRMADO). */
const CAPACIDADES_OBRIGATORIAS_VENDA = Object.freeze([
  'configuracao_cds',
  'adapter_destaxa',
  'banco_conectado',
  'dll_encontrada',
  'exports_dll',
  'middleware_validado',
  'driver_pinpad_validado',
  'pinpad_enumerado',
  'comunicacao_serial_validada',
  'vspague_em_execucao',
  'cadastro_terminal_vspague',
  'arquivo_conf_validado',
  'mapeamento_oficial',
  'init_client_sessao_atual',
  'comunicacao_transacional',
  'venda_autorizacao_liberada'
]);

function agoraIso() {
  return new Date().toISOString();
}

function indicador(parcial = {}) {
  return {
    id: parcial.id || null,
    nome: parcial.nome || '',
    estado: parcial.estado || ESTADOS_INDICADOR.NAO_VALIDADO,
    evidencia: parcial.evidencia != null ? parcial.evidencia : null,
    verificadoEm: parcial.verificadoEm || agoraIso(),
    motivo: parcial.motivo || null
  };
}

function listarConfVsPague() {
  const raiz = path.join('C:\\VBI', 'V$Pague');
  const encontrados = [];
  if (!fs.existsSync(raiz)) {
    return { diretorioExiste: false, arquivos: [], count: 0 };
  }
  const stack = [raiz];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'archived' || ent.name === 'logs') continue;
        stack.push(full);
      } else if (ent.isFile() && /\.conf$/i.test(ent.name)) {
        encontrados.push(full);
      }
    }
  }
  return { diretorioExiste: true, arquivos: encontrados, count: encontrados.length };
}

function lerErro00151DoLog() {
  if (!fs.existsSync(VSPAGUE_LOG)) {
    return {
      logExiste: false,
      encontrado: false,
      trecho: null,
      mensagem: 'Log V$PagueClient não encontrado para inspeção readonly.'
    };
  }
  let texto = '';
  try {
    texto = fs.readFileSync(VSPAGUE_LOG, 'utf8');
  } catch (error) {
    return {
      logExiste: true,
      encontrado: false,
      trecho: null,
      mensagem: `Falha ao ler log: ${error.message}`
    };
  }
  const linhas = texto.split(/\r?\n/);
  const hit = [...linhas].reverse().find((l) => /00151/.test(l) || /Terminal n[aã]o cadastrado/i.test(l));
  const confHit = [...linhas].reverse().find((l) => /\.conf/i.test(l) && /encontrado/i.test(l));
  return {
    logExiste: true,
    encontrado: Boolean(hit),
    trecho: hit ? hit.trim().slice(0, 240) : null,
    confMensagem: confHit ? confHit.trim().slice(0, 240) : null,
    mensagem: hit
      ? 'Erro 00151 observado no log do V$PagueClient (terminal não cadastrado ou desabilitado).'
      : 'Nenhuma ocorrência recente de 00151 no log inspecionado.'
  };
}

function estadoMapeamentoOficial(config = {}) {
  const avaliacao = avaliarMapeamentoTerminal(config, { provedor: 'destaxa' });
  const estadoUi = avaliacao.estado === 'PENDENTE_FORNECEDOR' || avaliacao.estado === 'PARCIAL_SEM_CONFIRMACAO'
    ? ESTADOS_INDICADOR.BLOQUEADO
    : ESTADOS_INDICADOR.NAO_VALIDADO;
  return {
    estado: estadoUi,
    codigo: avaliacao.codigo,
    mensagem: avaliacao.mensagem,
    avisos: avaliacao.avisos,
    homologacaoDeclarada: false,
    tefProntoParaVenda: false,
    valoresPresentes: {
      estabelecimento: Boolean(avaliacao.campos.empresa_codigo),
      loja: Boolean(avaliacao.campos.loja_codigo),
      terminal: Boolean(avaliacao.campos.terminal_codigo),
      pdv: Boolean(avaliacao.campos.pdv_codigo),
      caixa: Boolean(avaliacao.campos.caixa_codigo)
    },
    contrato: avaliacao.contratoDll,
    mapeamentoCampos: MAPEAMENTO_CAMPOS,
    avaliacao
  };
}

/**
 * Monta as 16 capacidades com status/evidência/motivo (MRT-41).
 * CONFIRMADO só com prova da capacidade nomeada — sem inferência.
 */
function montarCapacidadesOperacionais({
  config = {},
  estados = {},
  adapterDiag = null,
  conceitos = {},
  conf,
  erro00151,
  mapeamento,
  gateOn,
  verificadoEm
} = {}) {
  const ts = verificadoEm || agoraIso();
  const dllLoaded = estados.dll?.loaded === true;
  const exportsOk = estados.dll?.exportsValidated === true;
  const dllExists = adapterDiag?.detalhes?.dllExists === true
    || conceitos.dllEncontrada === true
    || dllLoaded;
  const vspagueRunning = estados.vspague?.detected === true && estados.vspague?.running === true;
  const pinpadEnum = estados.pinpad?.ppc930Enumerated === true;
  const portaIdentificada = Boolean(estados.pinpad?.configuredPort || estados.pinpad?.detectedPort);
  const comConsistent = estados.pinpad?.comConsistent === true;
  const serialValidated = estados.pinpad?.serialCommunicationValidated === true;
  const driverValidated = estados.pinpad?.driverValidated === true
    || estados.pinpad?.driverStatus === 'confirmado_operacional_tef';
  const driverWindowsHint = estados.pinpad?.driverStatus === 'confirmado'
    || conceitos.pinpadDriverWindows === true;
  const middlewareValidated = estados.middleware?.validated === true;
  const middlewarePresentHint = conceitos.middlewareInstalado === true || dllExists;
  const confCount = conf?.count ?? 0;
  const confValidated = estados.conf?.validated === true;
  const terminalCadastroConfirmed = estados.vspague?.terminalCadastradoConfirmado === true;
  const clientInitNow = estados.client?.initialized === true
    && estados.client?.initClientExecuted === 'EXECUTADO'
    && estados.client?.code === '00';
  const txValidated = estados.transactionCommunication?.validated === true;
  const authAvailable = estados.authorization?.available === true && gateOn === true;
  const configOk = conceitos.configuracaoValida === true
    || (config && Object.keys(config).length > 0 && Boolean(config.tefProvedor));
  const adapterOk = conceitos.adapterCarregado === true
    || estados.adapter?.instantiated === true;
  const bancoOk = conceitos.bancoAcessivel === true;

  const capacidades = [
    indicador({
      id: 'configuracao_cds',
      nome: 'Configuração CDS carregada',
      estado: configOk ? ESTADOS_INDICADOR.CONFIRMADO : ESTADOS_INDICADOR.INDISPONIVEL,
      evidencia: { provedor: config.tefProvedor || null, ambiente: config.tefAmbiente || null },
      verificadoEm: ts,
      motivo: configOk ? null : 'Configuração TEF ausente ou incompleta no CDS.'
    }),
    indicador({
      id: 'adapter_destaxa',
      nome: 'Adapter Destaxa carregado',
      estado: adapterOk ? ESTADOS_INDICADOR.CONFIRMADO : ESTADOS_INDICADOR.INDISPONIVEL,
      evidencia: { instantiated: adapterOk, mode: estados.adapter?.mode || null },
      verificadoEm: ts,
      motivo: adapterOk ? null : 'Adapter Destaxa não instanciado.'
    }),
    indicador({
      id: 'banco_conectado',
      nome: 'Banco conectado',
      estado: bancoOk ? ESTADOS_INDICADOR.CONFIRMADO : ESTADOS_INDICADOR.INDISPONIVEL,
      evidencia: { acessivel: bancoOk },
      verificadoEm: ts,
      motivo: bancoOk ? null : 'Tabela/banco TEF inacessível.'
    }),
    indicador({
      id: 'dll_encontrada',
      nome: 'DLL encontrada',
      estado: dllExists ? ESTADOS_INDICADOR.CONFIRMADO : ESTADOS_INDICADOR.INDISPONIVEL,
      evidencia: {
        dllExists,
        path: adapterDiag?.detalhes?.dllPath || null,
        nota: 'Arquivo DLL presente ≠ middleware validado ≠ operação financeira.'
      },
      verificadoEm: ts,
      motivo: dllExists ? null : 'DLL Destaxa não encontrada nesta máquina.'
    }),
    indicador({
      id: 'exports_dll',
      nome: 'Exports da DLL identificados',
      estado: exportsOk
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (dllLoaded ? ESTADOS_INDICADOR.NAO_VALIDADO : ESTADOS_INDICADOR.INDISPONIVEL),
      evidencia: { loaded: dllLoaded, exportsValidated: exportsOk },
      verificadoEm: ts,
      motivo: exportsOk
        ? null
        : 'Exports obrigatórios não validados nesta verificação (ou DLL não carregada).'
    }),
    indicador({
      id: 'middleware_validado',
      nome: 'Middleware instalado e validado',
      estado: middlewareValidated
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (middlewarePresentHint
          ? ESTADOS_INDICADOR.NAO_VALIDADO
          : ESTADOS_INDICADOR.INDISPONIVEL),
      evidencia: {
        dllPresente: middlewarePresentHint,
        validated: middlewareValidated,
        nota: 'Presença de DLL/V$Pague ≠ middleware Destaxa validado operacionalmente.'
      },
      verificadoEm: ts,
      motivo: middlewareValidated
        ? null
        : 'Middleware Destaxa não possui evidência operacional de validação neste diagnóstico.'
    }),
    indicador({
      id: 'driver_pinpad_validado',
      nome: 'Driver do PinPad validado',
      estado: driverValidated
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (driverWindowsHint || pinpadEnum
          ? ESTADOS_INDICADOR.NAO_VALIDADO
          : ESTADOS_INDICADOR.INDISPONIVEL),
      evidencia: {
        driverWindowsHint: Boolean(driverWindowsHint),
        driverValidated,
        nota: 'Driver enumerado pelo Windows ≠ driver validado para TEF Destaxa.'
      },
      verificadoEm: ts,
      motivo: driverValidated
        ? null
        : 'Driver do PinPad sem validação operacional TEF comprovada.'
    }),
    indicador({
      id: 'pinpad_enumerado',
      nome: 'PinPad enumerado pelo Windows',
      estado: pinpadEnum
        ? ESTADOS_INDICADOR.CONFIRMADO
        : ESTADOS_INDICADOR.INDISPONIVEL,
      evidencia: {
        enumerated: pinpadEnum,
        configuredPort: estados.pinpad?.configuredPort || null,
        detectedPort: estados.pinpad?.detectedPort || null,
        nota: 'Enumeração Windows ≠ PinPad operacional para venda.'
      },
      verificadoEm: ts,
      motivo: pinpadEnum ? null : 'PinPad não enumerado pelo Windows nesta verificação.'
    }),
    indicador({
      id: 'comunicacao_serial_validada',
      nome: 'Comunicação serial validada',
      estado: serialValidated
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (portaIdentificada || comConsistent
          ? ESTADOS_INDICADOR.NAO_VALIDADO
          : ESTADOS_INDICADOR.INDISPONIVEL),
      evidencia: {
        portaIdentificada,
        comConsistent,
        serialValidated,
        configuredPort: estados.pinpad?.configuredPort || null,
        detectedPort: estados.pinpad?.detectedPort || null,
        nota: 'Porta COM identificada/consistente ≠ comunicação serial TEF comprovada.'
      },
      verificadoEm: ts,
      motivo: serialValidated
        ? null
        : 'Comunicação serial com o PinPad não foi comprovada neste diagnóstico (sem I/O TEF).'
    }),
    indicador({
      id: 'vspague_em_execucao',
      nome: 'Processo V$Pague em execução',
      estado: vspagueRunning
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (estados.vspague?.detected === true
          ? ESTADOS_INDICADOR.NAO_VALIDADO
          : ESTADOS_INDICADOR.INDISPONIVEL),
      evidencia: {
        detected: estados.vspague?.detected === true,
        running: estados.vspague?.running === true,
        nota: 'Processo em execução ≠ terminal cadastrado no V$PagueServer.'
      },
      verificadoEm: ts,
      motivo: vspagueRunning ? null : 'Processo V$Pague Client não detectado em execução.'
    }),
    indicador({
      id: 'cadastro_terminal_vspague',
      nome: 'Cadastro do terminal no V$Pague confirmado',
      estado: terminalCadastroConfirmed
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (erro00151.encontrado || confCount !== 1
          ? ESTADOS_INDICADOR.BLOQUEADO
          : ESTADOS_INDICADOR.NAO_VALIDADO),
      evidencia: { erro00151, confCount, terminalCadastroConfirmed },
      verificadoEm: ts,
      motivo: terminalCadastroConfirmed
        ? null
        : (erro00151.encontrado
          ? erro00151.mensagem
          : 'Cadastro do terminal no V$Pague não confirmado (processo ≠ cadastro).')
    }),
    indicador({
      id: 'arquivo_conf_validado',
      nome: 'Arquivo .conf localizado e validado',
      estado: confValidated
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (confCount === 1
          ? ESTADOS_INDICADOR.NAO_VALIDADO
          : ESTADOS_INDICADOR.BLOQUEADO),
      evidencia: {
        count: confCount,
        arquivos: (conf?.arquivos || []).slice(0, 5),
        validated: confValidated,
        nota: 'Existência de .conf ≠ conteúdo homologado / mapeamento oficial.'
      },
      verificadoEm: ts,
      motivo: confValidated
        ? null
        : (confCount === 0
          ? 'Nenhum arquivo .conf encontrado sob C:\\VBI\\V$Pague.'
          : (confCount > 1
            ? `Mais de um .conf encontrado (${confCount}) — ambíguo.`
            : '.conf encontrado, porém não validado oficialmente neste diagnóstico.'))
    }),
    indicador({
      id: 'mapeamento_oficial',
      nome: 'Mapeamento oficial estabelecimento/loja/terminal confirmado',
      estado: mapeamento.estado,
      evidencia: {
        codigo: mapeamento.codigo,
        valoresPresentes: mapeamento.valoresPresentes,
        homologacaoDeclarada: false
      },
      verificadoEm: ts,
      motivo: mapeamento.mensagem
    }),
    indicador({
      id: 'init_client_sessao_atual',
      nome: 'INIT_CLIENT executado e confirmado na sessão atual',
      estado: clientInitNow
        ? ESTADOS_INDICADOR.CONFIRMADO
        : ESTADOS_INDICADOR.NAO_VALIDADO,
      evidencia: {
        initClientExecuted: estados.client?.initClientExecuted || 'NAO_EXECUTADO',
        codigoSessaoAtual: estados.client?.codeStatus === 'NAO_EXECUTADO'
          ? 'NAO_EXECUTADO'
          : (estados.client?.code || null),
        historicoComprovado: INIT_HISTORICO_PPC930_05,
        initNaoReexecutado: true,
        nota: 'INIT histórico (ex.: código 00 em sprint anterior) não comprova a sessão atual.'
      },
      verificadoEm: ts,
      motivo: clientInitNow
        ? null
        : 'INIT_CLIENT não executado/confirmado nesta sessão de diagnóstico (histórico preservado, sem reexecução).'
    }),
    indicador({
      id: 'comunicacao_transacional',
      nome: 'Comunicação transacional validada',
      estado: txValidated
        ? ESTADOS_INDICADOR.CONFIRMADO
        : ESTADOS_INDICADOR.NAO_VALIDADO,
      evidencia: {
        validated: txValidated,
        state: estados.transactionCommunication?.state || 'not_tested',
        explanation: estados.transactionCommunication?.explanation
          || 'Diagnóstico não executa CRT/CONTINUE/EST/FINALIZE.'
      },
      verificadoEm: ts,
      motivo: txValidated
        ? null
        : 'Comunicação transacional não validada — diagnóstico não envia operações financeiras.'
    }),
    indicador({
      id: 'venda_autorizacao_liberada',
      nome: 'Venda/autorização financeira liberada',
      estado: authAvailable
        ? ESTADOS_INDICADOR.CONFIRMADO
        : ESTADOS_INDICADOR.BLOQUEADO,
      evidencia: {
        financialGateEnabled: gateOn,
        authorizationAvailable: estados.authorization?.available === true,
        mrtContinuidadeNaoEquivalemHomologacao: true,
        nota: 'MRT-38..40 (continuidade simulada) não homologam venda financeira real.'
      },
      verificadoEm: ts,
      motivo: authAvailable
        ? null
        : (!gateOn
          ? 'Gate financeiro DESTAXA_REAL_TRANSACTION_ENABLED desabilitado (deliberado).'
          : 'Autorização financeira Destaxa não comprovada neste diagnóstico.')
    })
  ];

  return capacidades;
}

function avaliarProntidaoParaVenda(capacidades = []) {
  const porId = new Map(capacidades.map((c) => [c.id, c]));
  const faltantes = [];
  for (const id of CAPACIDADES_OBRIGATORIAS_VENDA) {
    const cap = porId.get(id);
    if (!cap || cap.estado !== ESTADOS_INDICADOR.CONFIRMADO) {
      faltantes.push({
        id,
        estado: cap?.estado || ESTADOS_INDICADOR.INDISPONIVEL,
        motivo: cap?.motivo || 'Capacidade obrigatória não confirmada.'
      });
    }
  }
  return {
    tefProntoParaVenda: faltantes.length === 0,
    faltantes,
    regra: 'Conservadora: qualquer obrigatória ≠ CONFIRMADO ⇒ TEF pronto para venda = NÃO. Índice auxiliar não autoriza venda.'
  };
}

/**
 * @param {object} opcoes
 * @param {object} [opcoes.config]
 * @param {object} [opcoes.estadosIntegracao]
 * @param {object} [opcoes.adapterDiag]
 * @param {object} [opcoes.conceitos]
 */
function avaliarEvidenciasDestaxa(opcoes = {}) {
  const config = opcoes.config || {};
  const estados = opcoes.estadosIntegracao || {};
  const conceitos = opcoes.conceitos || {};
  const gateOn = String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').trim() === '1';
  const conf = listarConfVsPague();
  const erro00151 = lerErro00151DoLog();
  const mapeamento = estadoMapeamentoOficial(config);
  const verificadoEm = agoraIso();

  const dllLoaded = estados.dll?.loaded === true;
  const exportsOk = estados.dll?.exportsValidated === true;
  const vspagueRunning = estados.vspague?.detected === true && estados.vspague?.running === true;
  const comOk = estados.pinpad?.comConsistent === true;
  const clientInitNow = estados.client?.initialized === true
    && estados.client?.initClientExecuted === 'EXECUTADO'
    && estados.client?.code === '00';

  const capacidades = montarCapacidadesOperacionais({
    config,
    estados,
    adapterDiag: opcoes.adapterDiag,
    conceitos,
    conf,
    erro00151,
    mapeamento,
    gateOn,
    verificadoEm
  });
  const prontidao = avaliarProntidaoParaVenda(capacidades);

  // Painel legado (compat UI) — estados alinhados à capacidade nomeada, sem overclaim.
  const cap = (id) => capacidades.find((c) => c.id === id);

  const indicadores = {
    dllExports: {
      estado: cap('exports_dll')?.estado
        || (dllLoaded && exportsOk
          ? ESTADOS_INDICADOR.CONFIRMADO
          : (dllLoaded || exportsOk ? ESTADOS_INDICADOR.NAO_VALIDADO : ESTADOS_INDICADOR.INDISPONIVEL)),
      dllLoaded,
      exportsValidated: exportsOk,
      dllEncontrada: cap('dll_encontrada')?.estado || null,
      nota: 'DLL/exports ≠ middleware validado ≠ pronto para venda.'
    },
    portaCom: {
      // MRT-41: consistência de porta ≠ comunicação serial validada
      estado: cap('comunicacao_serial_validada')?.estado || ESTADOS_INDICADOR.NAO_VALIDADO,
      configuredPort: estados.pinpad?.configuredPort || null,
      detectedPort: estados.pinpad?.detectedPort || null,
      comConsistent: comOk,
      nota: 'COM identificada/consistente ≠ comunicação serial comprovada.'
    },
    processoVsPague: {
      estado: cap('vspague_em_execucao')?.estado
        || (vspagueRunning ? ESTADOS_INDICADOR.CONFIRMADO : ESTADOS_INDICADOR.INDISPONIVEL),
      nota: 'Processo em execução ≠ terminal cadastrado no V$PagueServer.'
    },
    inicializacaoClient: {
      estadoSessaoAtual: cap('init_client_sessao_atual')?.estado
        || (clientInitNow
          ? ESTADOS_INDICADOR.CONFIRMADO
          : ESTADOS_INDICADOR.NAO_VALIDADO),
      initClientExecuted: estados.client?.initClientExecuted || 'NAO_EXECUTADO',
      codigoSessaoAtual: estados.client?.codeStatus === 'NAO_EXECUTADO'
        ? 'NAO_EXECUTADO'
        : (estados.client?.code || null),
      historicoComprovado: INIT_HISTORICO_PPC930_05,
      initNaoReexecutado: true,
      nota: 'INIT histórico não comprova sessão atual.'
    },
    cadastroTerminalVsPague: {
      estado: cap('cadastro_terminal_vspague')?.estado || ESTADOS_INDICADOR.NAO_VALIDADO,
      erro00151,
      conf
    },
    arquivoConf: {
      estado: cap('arquivo_conf_validado')?.estado || ESTADOS_INDICADOR.NAO_VALIDADO,
      conf,
      nota: '.conf existente ≠ validado / ≠ mapeamento oficial.'
    },
    mapeamentoEstabelecimentoLojaTerminal: mapeamento,
    identidadeClientVsPague: {
      estado: ESTADOS_INDICADOR.NAO_VALIDADO,
      nota: 'Hostname/MAC são lidos pelo V$PagueClient no Identificar; o CDS não deriva terminal lógico a partir de PDV/caixa.',
      confArquivos: conf.count,
      confMensagemLog: erro00151.confMensagem || null
    },
    middlewareValidado: {
      estado: cap('middleware_validado')?.estado || ESTADOS_INDICADOR.NAO_VALIDADO,
      nota: 'SDK/DLL detectados ≠ middleware validado.'
    },
    driverPinpadValidado: {
      estado: cap('driver_pinpad_validado')?.estado || ESTADOS_INDICADOR.NAO_VALIDADO
    },
    pinpadEnumerado: {
      estado: cap('pinpad_enumerado')?.estado || ESTADOS_INDICADOR.INDISPONIVEL
    },
    prontidaoTransacao: {
      estado: ESTADOS_INDICADOR.BLOQUEADO,
      financialGateEnabled: gateOn,
      transactionCommunicationValidated: estados.transactionCommunication?.validated === true,
      authorizationAvailable: estados.authorization?.available === true,
      homologacaoDeclarada: false,
      mensagem: 'Prontidão para transação: NÃO. Gate OFF e/ou capacidades operacionais pendentes. Índice técnico auxiliar não autoriza venda.'
    }
  };

  const capacidadesGenericas = {
    vendaDestaxa: {
      estado: ESTADOS_INDICADOR.BLOQUEADO,
      mensagem: 'Autorização financeira Destaxa não comprovada neste diagnóstico.'
    },
    cancelamentoDestaxa: {
      estado: ESTADOS_INDICADOR.INDISPONIVEL,
      mensagem: 'Cancelamento Destaxa não implementado / não validado.'
    },
    conciliacaoTef: {
      estado: ESTADOS_INDICADOR.NAO_VALIDADO,
      mensagem: 'Conciliação genérica do CDS não equivale a capacidade Destaxa homologada.'
    },
    reimpressaoTef: {
      estado: ESTADOS_INDICADOR.NAO_VALIDADO,
      mensagem: 'Reimpressão de comprovantes CDS ≠ prova de TEF Destaxa operacional.'
    },
    nfceIntegrada: {
      estado: ESTADOS_INDICADOR.NAO_VALIDADO,
      mensagem: 'Integração NFC-e é fluxo fiscal CDS; não prova TEF Destaxa pronto para venda.'
    }
  };

  const bloqueios = [
    erro00151.encontrado
      ? { codigo: 'VSPAGUE_00151', estado: ESTADOS_INDICADOR.BLOQUEADO, mensagem: erro00151.mensagem, trecho: erro00151.trecho }
      : null,
    conf.count === 0
      ? {
        codigo: 'VSPAGUE_CONF_AUSENTE',
        estado: ESTADOS_INDICADOR.BLOQUEADO,
        mensagem: 'Nenhum arquivo .conf encontrado sob C:\\VBI\\V$Pague.'
      }
      : (conf.count > 1
        ? {
          codigo: 'VSPAGUE_CONF_AMBIGUO',
          estado: ESTADOS_INDICADOR.BLOQUEADO,
          mensagem: `Mais de um .conf encontrado (${conf.count}).`
        }
        : {
          codigo: 'VSPAGUE_CONF_NAO_VALIDADO',
          estado: ESTADOS_INDICADOR.NAO_VALIDADO,
          mensagem: '.conf localizado, sem validação oficial do conteúdo neste diagnóstico.'
        }),
    mapeamento.estado === ESTADOS_INDICADOR.BLOQUEADO
      ? { codigo: mapeamento.codigo, estado: mapeamento.estado, mensagem: mapeamento.mensagem }
      : null,
    !gateOn
      ? {
        codigo: 'DESTAXA_REAL_TRANSACTION_DISABLED',
        estado: ESTADOS_INDICADOR.BLOQUEADO,
        mensagem: 'Gate financeiro DESTAXA_REAL_TRANSACTION_ENABLED desabilitado (deliberado).'
      }
      : null,
    !clientInitNow
      ? {
        codigo: 'INIT_CLIENT_SESSAO_NAO_CONFIRMADO',
        estado: ESTADOS_INDICADOR.NAO_VALIDADO,
        mensagem: 'INIT_CLIENT da sessão atual não confirmado (histórico não substitui).'
      }
      : null
  ].filter(Boolean);

  return {
    provedorEsperado: 'destaxa',
    tefProntoParaVenda: false,
    prontidao: {
      ...prontidao,
      // Defesa: nunca liberar venda neste diagnóstico readonly
      tefProntoParaVenda: false
    },
    estadosIndicador: ESTADOS_INDICADOR,
    capacidadesObrigatoriasVenda: CAPACIDADES_OBRIGATORIAS_VENDA,
    capacidades,
    indicadores,
    capacidadesGenericas,
    bloqueios,
    initClientNaoReexecutado: true,
    indiceTecnicoNaoAutorizaVenda: true,
    verificadoEm
  };
}

module.exports = {
  ESTADOS_INDICADOR,
  INIT_HISTORICO_PPC930_05,
  CAPACIDADES_OBRIGATORIAS_VENDA,
  listarConfVsPague,
  lerErro00151DoLog,
  estadoMapeamentoOficial,
  montarCapacidadesOperacionais,
  avaliarProntidaoParaVenda,
  avaliarEvidenciasDestaxa
};
