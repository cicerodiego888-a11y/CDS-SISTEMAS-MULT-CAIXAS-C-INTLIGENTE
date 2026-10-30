'use strict';

/**
 * Evidências operacionais Destaxa/V$Pague (somente leitura).
 * Não chama INIT_CLIENT nem funções financeiras.
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
  nota: 'Último INIT_CLIENT comprovado em TEF-PPC930-05; este diagnóstico não reexecuta INIT_CLIENT.'
});

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
 * @param {object} opcoes
 * @param {object} [opcoes.config]
 * @param {object} [opcoes.estadosIntegracao]
 * @param {object} [opcoes.adapterDiag]
 */
function avaliarEvidenciasDestaxa(opcoes = {}) {
  const config = opcoes.config || {};
  const estados = opcoes.estadosIntegracao || {};
  const gateOn = String(process.env.DESTAXA_REAL_TRANSACTION_ENABLED || '').trim() === '1';
  const conf = listarConfVsPague();
  const erro00151 = lerErro00151DoLog();
  const mapeamento = estadoMapeamentoOficial(config);

  const dllLoaded = estados.dll?.loaded === true;
  const exportsOk = estados.dll?.exportsValidated === true;
  const vspagueRunning = estados.vspague?.detected === true && estados.vspague?.running === true;
  const comOk = estados.pinpad?.comConsistent === true;
  const clientInitNow = estados.client?.initialized === true
    && estados.client?.initClientExecuted === 'EXECUTADO'
    && estados.client?.code === '00';

  const indicadores = {
    dllExports: {
      estado: dllLoaded && exportsOk
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (dllLoaded || exportsOk ? ESTADOS_INDICADOR.NAO_VALIDADO : ESTADOS_INDICADOR.INDISPONIVEL),
      dllLoaded,
      exportsValidated: exportsOk
    },
    portaCom: {
      estado: comOk
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (estados.pinpad?.configuredPort || estados.pinpad?.detectedPort
          ? ESTADOS_INDICADOR.NAO_VALIDADO
          : ESTADOS_INDICADOR.INDISPONIVEL),
      configuredPort: estados.pinpad?.configuredPort || null,
      detectedPort: estados.pinpad?.detectedPort || null,
      comConsistent: comOk
    },
    processoVsPague: {
      estado: vspagueRunning ? ESTADOS_INDICADOR.CONFIRMADO : ESTADOS_INDICADOR.INDISPONIVEL,
      nota: 'Processo em execução ≠ terminal cadastrado no V$PagueServer.'
    },
    inicializacaoClient: {
      estadoSessaoAtual: clientInitNow
        ? ESTADOS_INDICADOR.CONFIRMADO
        : (estados.client?.initClientExecuted === 'NAO_EXECUTADO'
          ? ESTADOS_INDICADOR.NAO_VALIDADO
          : ESTADOS_INDICADOR.INDISPONIVEL),
      initClientExecuted: estados.client?.initClientExecuted || 'NAO_EXECUTADO',
      codigoSessaoAtual: estados.client?.codeStatus === 'NAO_EXECUTADO'
        ? 'NAO_EXECUTADO'
        : (estados.client?.code || null),
      historicoComprovado: INIT_HISTORICO_PPC930_05,
      initNaoReexecutado: true
    },
    cadastroTerminalVsPague: {
      estado: erro00151.encontrado || conf.count !== 1
        ? ESTADOS_INDICADOR.BLOQUEADO
        : ESTADOS_INDICADOR.NAO_VALIDADO,
      erro00151,
      conf
    },
    mapeamentoEstabelecimentoLojaTerminal: mapeamento,
    identidadeClientVsPague: {
      estado: ESTADOS_INDICADOR.NAO_VALIDADO,
      nota: 'Hostname/MAC são lidos pelo V$PagueClient no Identificar; o CDS não deriva terminal lógico a partir de PDV/caixa.',
      confArquivos: conf.count,
      confMensagemLog: erro00151.confMensagem || null
    },
    prontidaoTransacao: {
      estado: ESTADOS_INDICADOR.BLOQUEADO,
      financialGateEnabled: gateOn,
      transactionCommunicationValidated: estados.transactionCommunication?.validated === true,
      authorizationAvailable: estados.authorization?.available === true,
      homologacaoDeclarada: false,
      mensagem: 'Prontidão para transação bloqueada: gate financeiro desligado e/ou bloqueios operacionais Destaxa. Persistência de códigos ≠ homologação.'
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
        : null),
    mapeamento.estado === ESTADOS_INDICADOR.BLOQUEADO
      ? { codigo: mapeamento.codigo, estado: mapeamento.estado, mensagem: mapeamento.mensagem }
      : null,
    !gateOn
      ? {
        codigo: 'DESTAXA_REAL_TRANSACTION_DISABLED',
        estado: ESTADOS_INDICADOR.BLOQUEADO,
        mensagem: 'Gate financeiro DESTAXA_REAL_TRANSACTION_ENABLED desabilitado (deliberado).'
      }
      : null
  ].filter(Boolean);

  return {
    provedorEsperado: 'destaxa',
    tefProntoParaVenda: false,
    estadosIndicador: ESTADOS_INDICADOR,
    indicadores,
    capacidadesGenericas,
    bloqueios,
    initClientNaoReexecutado: true
  };
}

module.exports = {
  ESTADOS_INDICADOR,
  INIT_HISTORICO_PPC930_05,
  listarConfVsPague,
  lerErro00151DoLog,
  estadoMapeamentoOficial,
  avaliarEvidenciasDestaxa
};
