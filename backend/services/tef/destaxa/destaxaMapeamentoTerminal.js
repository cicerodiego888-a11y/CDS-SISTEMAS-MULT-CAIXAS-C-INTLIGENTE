'use strict';

/**
 * Contrato de mapeamento CDS ↔ Destaxa/V$Pague (somente estrutura).
 * MRT-10: os campos em tef_configuracao são genéricos (empresa/loja/terminal/pdv/caixa);
 * ESTE módulo é a interpretação Destaxa — outros provedores NÃO reutilizam este contrato.
 * Não inventa códigos; não declara terminal homologado só porque campos foram gravados.
 *
 * Fonte DLL Destaxa 1.83 (05-api-iniciaclientdestaxa.md):
 * - estabelecimento / loja / terminal = opcionais em iniciaClientDestaxa
 * - Identidade do Client no Partner Cloud = hostname/MAC (V$PagueClient), não estes campos
 */

const MAPEAMENTO_CAMPOS = Object.freeze([
  {
    cds: 'empresa_codigo',
    cdsApi: 'empresaCodigo',
    destaxa: 'estabelecimento',
    papel: 'codigo_estabelecimento_vspague',
    enviadoIniciaClient: true,
    obrigatorioDll: false,
    origemEsperada: 'Destaxa (oficial)'
  },
  {
    cds: 'loja_codigo',
    cdsApi: 'lojaCodigo',
    destaxa: 'loja',
    papel: 'codigo_loja_vspague',
    enviadoIniciaClient: true,
    obrigatorioDll: false,
    origemEsperada: 'Destaxa (oficial)'
  },
  {
    cds: 'terminal_codigo',
    cdsApi: 'terminalCodigo',
    destaxa: 'terminal',
    papel: 'codigo_terminal_logico_vspague',
    enviadoIniciaClient: true,
    obrigatorioDll: false,
    origemEsperada: 'Destaxa (oficial)'
  },
  {
    cds: 'pdv_codigo',
    cdsApi: 'pdvCodigo',
    destaxa: null,
    papel: 'identidade_pdv_cds',
    enviadoIniciaClient: false,
    obrigatorioDll: false,
    origemEsperada: 'CDS (local)'
  },
  {
    cds: 'caixa_codigo',
    cdsApi: 'caixaCodigo',
    destaxa: null,
    papel: 'identidade_caixa_cds',
    enviadoIniciaClient: false,
    obrigatorioDll: false,
    origemEsperada: 'CDS (local)'
  }
]);

const ESTADOS = Object.freeze({
  PENDENTE_FORNECEDOR: 'PENDENTE_FORNECEDOR',
  PARCIAL_SEM_CONFIRMACAO: 'PARCIAL_SEM_CONFIRMACAO',
  PREENCHIDO_SEM_CONFIRMACAO_SERVIDOR: 'PREENCHIDO_SEM_CONFIRMACAO_SERVIDOR',
  NAO_APLICAVEL: 'NAO_APLICAVEL'
});

function texto(config, ...chaves) {
  for (const chave of chaves) {
    const valor = config?.[chave];
    if (valor == null) continue;
    const t = String(valor).trim();
    if (t && t !== 'undefined' && t !== 'null') return t;
  }
  return '';
}

function lerCampos(config = {}) {
  return {
    empresa_codigo: texto(config, 'empresaCodigo', 'empresa_codigo', 'estabelecimento'),
    loja_codigo: texto(config, 'lojaCodigo', 'loja_codigo', 'loja'),
    terminal_codigo: texto(config, 'terminalCodigo', 'terminal_codigo', 'terminal'),
    pdv_codigo: texto(config, 'pdvCodigo', 'pdv_codigo'),
    caixa_codigo: texto(config, 'caixaCodigo', 'caixa_codigo')
  };
}

/**
 * Simula a seleção de chaves enviadas a iniciaClientDestaxa (sem chamar a DLL).
 * Espelha DestaxaNativeBridge.montarEntradaClient.
 * MRT-28: anexa parâmetros oficiais de log (opcionais na mesma string `entrada`).
 */
function projetarEntradaIniciaClient(config = {}, opcoes = {}) {
  const { anexarParamsLogEntrada, DESTAXA_DLL_LOG_PARAMS } = require('./destaxaDllLogConfig');
  const versao = String(opcoes.versao || '').trim() || null;
  const aplicacao = String(opcoes.aplicacao || 'CDS Sistemas').trim();
  const campos = lerCampos(config);
  let pares = [];
  if (versao) pares.push(['versao', versao]);
  pares.push(['aplicacao', aplicacao]);
  if (campos.empresa_codigo) pares.push(['estabelecimento', campos.empresa_codigo]);
  if (campos.loja_codigo) pares.push(['loja', campos.loja_codigo]);
  if (campos.terminal_codigo) pares.push(['terminal', campos.terminal_codigo]);

  // Log DLL: preservar parâmetros atuais; anexar os cinco oficiais (MRT-28).
  // Pode ser desligado com opcoes.incluirLogDll === false (testes pontuais).
  const incluirLog = opcoes.incluirLogDll !== false && config.incluirLogDll !== false;
  if (incluirLog) {
    const overrideLog = config.destaxaDllLog && typeof config.destaxaDllLog === 'object'
      ? { ...DESTAXA_DLL_LOG_PARAMS, ...config.destaxaDllLog }
      : DESTAXA_DLL_LOG_PARAMS;
    pares = anexarParamsLogEntrada(pares, overrideLog);
  }

  const chavesLog = ['diretorio_trabalho', 'nivel_log', 'nome_arquivo_log', 'tam_max_log', 'total_bkp_log'];
  return {
    texto: pares.map(([k, v]) => `${k}=${v}`).join(';'),
    chaves: pares.map(([k]) => k),
    incluiPdvOuCaixa: false,
    camposDestaxaEnviados: {
      estabelecimento: Boolean(campos.empresa_codigo),
      loja: Boolean(campos.loja_codigo),
      terminal: Boolean(campos.terminal_codigo)
    },
    camposLogDll: Object.fromEntries(
      pares.filter(([k]) => chavesLog.includes(k))
    ),
    camposCdsLocais: {
      pdv_codigo: campos.pdv_codigo || null,
      caixa_codigo: campos.caixa_codigo || null
    }
  };
}

function avaliarMapeamentoTerminal(config = {}, opcoes = {}) {
  const provedor = String(opcoes.provedor || config.tefProvedor || config.provedor || '')
    .toLowerCase()
    .trim();

  if (provedor && provedor !== 'destaxa') {
    return {
      estado: ESTADOS.NAO_APLICAVEL,
      codigo: 'MAPEAMENTO_DESTAXA_NAO_APLICAVEL',
      mensagem: 'Mapeamento Destaxa não se aplica a este provedor.',
      tefProntoParaVenda: false,
      homologacaoDeclarada: false,
      contratoDll: {
        estabelecimentoLojaTerminalObrigatorios: false,
        fonte: '05-api-iniciaclientdestaxa.md'
      },
      campos: lerCampos(config),
      mapeamento: MAPEAMENTO_CAMPOS
    };
  }

  const campos = lerCampos(config);
  const destaxaPreenchidos = [
    campos.empresa_codigo,
    campos.loja_codigo,
    campos.terminal_codigo
  ].filter(Boolean).length;
  const locaisPreenchidos = [campos.pdv_codigo, campos.caixa_codigo].filter(Boolean).length;

  let estado;
  let codigo;
  let mensagem;

  if (destaxaPreenchidos === 0) {
    estado = ESTADOS.PENDENTE_FORNECEDOR;
    codigo = 'MAPEAMENTO_OFICIAL_PENDENTE';
    mensagem = 'Códigos Destaxa (estabelecimento/loja/terminal) ausentes. Aguardar valores oficiais do fornecedor; não inventar a partir de PDV/caixa/CNPJ/número lógico.';
  } else if (destaxaPreenchidos < 3) {
    estado = ESTADOS.PARCIAL_SEM_CONFIRMACAO;
    codigo = 'MAPEAMENTO_PARCIAL_SEM_CONFIRMACAO';
    mensagem = 'Mapeamento Destaxa parcial no CDS. Persistência local não prova cadastro no V$PagueServer (00151/.conf).';
  } else {
    estado = ESTADOS.PREENCHIDO_SEM_CONFIRMACAO_SERVIDOR;
    codigo = 'MAPEAMENTO_PREENCHIDO_SEM_CONFIRMACAO_SERVIDOR';
    mensagem = 'Três códigos Destaxa preenchidos no CDS, mas equivalência oficial e reconhecimento do terminal pelo servidor ainda não confirmados.';
  }

  const avisos = [];
  if (destaxaPreenchidos === 0) {
    avisos.push('Preencha estabelecimento/loja/terminal somente com literais oficiais Destaxa.');
  }
  if (locaisPreenchidos > 0 && destaxaPreenchidos === 0) {
    avisos.push('pdv_codigo/caixa_codigo são identidade CDS e não são enviados a iniciaClientDestaxa.');
  }
  avisos.push('Gravar configuração TEF não declara o PDV homologado nem resolve o erro 00151 do V$PagueClient.');

  return {
    estado,
    codigo,
    mensagem,
    avisos,
    tefProntoParaVenda: false,
    homologacaoDeclarada: false,
    contratoDll: {
      estabelecimentoLojaTerminalObrigatorios: false,
      fonte: '05-api-iniciaclientdestaxa.md',
      nota: 'Parâmetros opcionais na DLL; Identificar no Client usa hostname/MAC.'
    },
    contagem: {
      destaxaPreenchidos,
      locaisPreenchidos
    },
    campos,
    mapeamento: MAPEAMENTO_CAMPOS,
    projecaoEntrada: projetarEntradaIniciaClient(config, opcoes)
  };
}

module.exports = {
  MAPEAMENTO_CAMPOS,
  ESTADOS,
  lerCampos,
  projetarEntradaIniciaClient,
  avaliarMapeamentoTerminal
};
