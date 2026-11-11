'use strict';

/**
 * Protocolo de parâmetros Destaxa 1.83 (fonte: docs oficiais 06/07/08/09/10).
 * Formato entrada/saída: chave=valor;chave=valor
 *
 * Identificação de ações no retorno 99 (doc 07 + Anexo I):
 * - OPÇÃO: presença do campo `opcao` (lista separada por `|`)
 * - COLETA: presença do campo `tipo` (sem `opcao`)
 * - DISPLAY: presença de `mensagem` sem `tipo` e sem `opcao`
 *
 * NÃO usar `acao=DISPLAY|COLETA|OPCAO` — esse formato NÃO está na documentação.
 */

const {
  CODIGO_ACAO_SOLICITADA,
  CODIGO_CLIENT_OK,
  CODIGOS_RESULTADO,
  CLASSIFICACAO_CODIGO,
  ESTADOS_TRANSACAO,
  TIPOS_ACAO,
  CAMPOS_META_ENTRADA
} = require('./destaxaConstantes');
const {
  classificarCodigoFinanceiro
} = require('../tefFinancialSafetyPolicy');

function comSegurancaFinanceira(resultado) {
  return {
    ...resultado,
    ...classificarCodigoFinanceiro(resultado.codigo, resultado.estadoTransacao)
  };
}

function parseParametrosDestaxa(texto) {
  const mapa = {};
  if (!texto || !String(texto).trim()) return mapa;
  for (const parte of String(texto).split(';')) {
    const p = parte.trim();
    if (!p || !p.includes('=')) continue;
    const idx = p.indexOf('=');
    const chave = p.slice(0, idx).trim();
    const valor = p.slice(idx + 1).trim();
    if (chave) mapa[chave] = valor;
  }
  return mapa;
}

/**
 * Monta string Destaxa "chave=valor;chave=valor".
 * Remove chaves de metadado do adapter (operacao/funcao/campos) — não fazem parte
 * do parâmetro `entrada` da DLL (operacao é parâmetro separado em iniciaTransacaoDestaxa).
 * Ordem: não confirmado na doc como obrigatória; usa ordem de inserção do objeto.
 */
function buildTransactionInput(campos = {}) {
  const pares = [];
  const chaves = [];
  for (const [chave, valor] of Object.entries(campos || {})) {
    if (CAMPOS_META_ENTRADA.has(chave)) continue;
    if (valor == null) continue;
    if (typeof valor === 'object') continue;
    const texto = String(valor).trim();
    if (!texto || texto === 'undefined' || texto === 'null') continue;
    pares.push(`${chave}=${texto}`);
    chaves.push(chave);
  }
  return {
    texto: pares.join(';'),
    chaves,
    campos: { ...campos }
  };
}

/**
 * Converte valor em reais (número ou texto "1.00"/"1,00") para centavos inteiros.
 * Retorna null quando o valor não é um montante monetário positivo com até 2 casas.
 */
function valorReaisParaCentavos(valor) {
  if (valor == null || typeof valor === 'object') return null;
  const texto = String(valor).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const [inteiro, fracao = ''] = texto.split('.');
  const centavos = Number(inteiro) * 100 + Number(fracao.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
}

function erroValorNaoPermitido() {
  const erro = new Error('valorCentavos deve ser inteiro positivo');
  erro.codigo = 'DESTAXA_VALOR_NAO_PERMITIDO';
  return erro;
}

/**
 * Conversão única valor interno CDS (centavos inteiros) → `transacao_valor` Destaxa.
 * Formato oficial (docs/06 "Ex: 100.99"; exemplos dotnet/java/clang "100.00", "23.49"):
 * reais com ponto decimal e 2 casas. 100 centavos → "1.00".
 */
function formatarValorDestaxa(valorCentavos) {
  if (!Number.isSafeInteger(valorCentavos) || valorCentavos <= 0) {
    throw erroValorNaoPermitido();
  }
  const reais = Math.floor(valorCentavos / 100);
  const centavos = String(valorCentavos % 100).padStart(2, '0');
  return `${reais}.${centavos}`;
}

/**
 * Valores de `transacao_tipo_cartao` alinhados aos examples oficiais Destaxa 1.83
 * (java/dotnet) e ao token de docs/07 (`Debito|Credito`).
 * MRT-50.73: literal canônico CDS = `Debito` (ASCII), não `Débito` (docs/06).
 * `Credito` permanece sem acento.
 */
const TIPOS_CARTAO_CRT_DOCUMENTADOS = Object.freeze({
  DEBITO: 'Debito',
  CREDITO: 'Credito'
});

/** Valores documentados em docs/06 para `transacao_pagamento`. */
const FORMAS_PAGAMENTO_CRT_DOCUMENTADAS = Object.freeze({
  A_VISTA: 'A vista',
  PARCELADO: 'Parcelado',
  PRE_DATADO: 'Pré-datado'
});

function normalizarTipoPdvParaCrt(tipoPdv) {
  return String(tipoPdv || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Mapeia a classificação já feita no PDV/CDS para o campo oficial Destaxa.
 * `cartao`/`tef` genéricos → null (Client pode solicitar via 99).
 * Não inventa Voucher nem outros rótulos fora da doc 1.83.
 */
function mapearTipoCartaoCrt(tipoPdv) {
  const tipo = normalizarTipoPdvParaCrt(tipoPdv);
  if (!tipo) return null;
  if (tipo.includes('debito')) return TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO;
  if (tipo.includes('credito')) return TIPOS_CARTAO_CRT_DOCUMENTADOS.CREDITO;
  return null;
}

/**
 * Forma de pagamento Destaxa a partir da modalidade CDS.
 * Debito → `A vista`. Crédito com parcelas > 1 → `Parcelado`; senão `A vista`.
 * `Pré-datado` só entra se o chamador informar explicitamente o valor documentado.
 */
function mapearFormaPagamentoCrt(tipoPdv, parcelas) {
  const tipoCartao = mapearTipoCartaoCrt(tipoPdv);
  if (tipoCartao === TIPOS_CARTAO_CRT_DOCUMENTADOS.DEBITO) {
    return FORMAS_PAGAMENTO_CRT_DOCUMENTADAS.A_VISTA;
  }
  if (tipoCartao === TIPOS_CARTAO_CRT_DOCUMENTADOS.CREDITO) {
    const qtd = Number(parcelas);
    if (Number.isFinite(qtd) && qtd > 1) {
      return FORMAS_PAGAMENTO_CRT_DOCUMENTADAS.PARCELADO;
    }
    return FORMAS_PAGAMENTO_CRT_DOCUMENTADAS.A_VISTA;
  }
  return null;
}

function valorCampoCrtDocumentado(valor, permitidos) {
  const texto = String(valor || '').trim();
  return Object.values(permitidos).includes(texto) ? texto : null;
}

/**
 * Entrada CRT (parâmetro `entrada` de iniciaTransacaoDestaxa).
 * Campos documentados em docs/06: `transacao_valor` e, quando a modalidade CDS
 * já classifica débito/crédito, `transacao_tipo_cartao` + `transacao_pagamento`.
 * `operacao=CRT` NÃO entra aqui — é parâmetro separado da DLL.
 * Compatível com retorno 99: campos omitidos podem ser solicitados pelo Client;
 * campos explícitos preservam a escolha do PDV e não substituem coletas restantes
 * (senha PinPad, etc.).
 */
function buildCrtInput({
  valorCentavos,
  tipoPdv = null,
  parcelas = null,
  tipoCartao = null,
  formaPagamento = null
} = {}) {
  const campos = {
    transacao_valor: formatarValorDestaxa(valorCentavos)
  };
  const tipo = valorCampoCrtDocumentado(tipoCartao, TIPOS_CARTAO_CRT_DOCUMENTADOS)
    || mapearTipoCartaoCrt(tipoPdv);
  const forma = valorCampoCrtDocumentado(formaPagamento, FORMAS_PAGAMENTO_CRT_DOCUMENTADAS)
    || mapearFormaPagamentoCrt(tipoPdv, parcelas);
  if (tipo) campos.transacao_tipo_cartao = tipo;
  if (forma) campos.transacao_pagamento = forma;
  return buildTransactionInput(campos);
}

function classificarCodigoTransacao(codigo) {
  const chave = String(codigo || '').trim().toUpperCase();
  const meta = CODIGOS_RESULTADO[chave] || null;

  if (chave === CODIGO_CLIENT_OK) {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.SUCCESS,
      estadoTransacao: ESTADOS_TRANSACAO.SUCCESS,
      conhecido: true,
      descricao: meta?.descricao || 'API executada com sucesso'
    });
  }
  if (chave === CODIGO_ACAO_SOLICITADA) {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.ACTION_REQUIRED,
      estadoTransacao: ESTADOS_TRANSACAO.WAITING_ACTION,
      conhecido: true,
      descricao: meta?.descricao || 'Client solicita uma ação da AC'
    });
  }
  if (chave === '08') {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.TIMEOUT,
      estadoTransacao: ESTADOS_TRANSACAO.TIMEOUT,
      conhecido: true,
      descricao: meta?.descricao || 'Tempo limite de espera excedido'
    });
  }
  if (['03', '04', '09'].includes(chave)) {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.DENIED,
      estadoTransacao: ESTADOS_TRANSACAO.DENIED,
      conhecido: Boolean(meta),
      descricao: meta?.descricao || 'Transação cancelada'
    });
  }
  if (chave === 'A0') {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.UNCONFIRMED,
      estadoTransacao: ESTADOS_TRANSACAO.UNCONFIRMED,
      conhecido: true,
      descricao: meta?.descricao || 'Uma ou mais transações não foram confirmadas corretamente'
    });
  }
  if (chave === 'A1') {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.BLOCKED,
      estadoTransacao: ESTADOS_TRANSACAO.BLOCKED,
      conhecido: true,
      descricao: meta?.descricao || 'Existem transações não confirmadas'
    });
  }
  if (['FF', 'F0', 'F1', 'F2', 'FE', '05', '06', '07'].includes(chave)) {
    return comSegurancaFinanceira({
      codigo: chave,
      classificacao: CLASSIFICACAO_CODIGO.ERROR,
      estadoTransacao: ESTADOS_TRANSACAO.ERROR,
      conhecido: Boolean(meta),
      descricao: meta?.descricao || 'Erro'
    });
  }
  return comSegurancaFinanceira({
    codigo: chave || '??',
    classificacao: CLASSIFICACAO_CODIGO.UNKNOWN,
    estadoTransacao: ESTADOS_TRANSACAO.UNKNOWN,
    conhecido: false,
    descricao: 'Código Destaxa não documentado em 09-tabela-codigos-de-retorno'
  });
}

/**
 * Interpreta saída do retorno 99 conforme docs/07 e Anexo I (docs/10).
 */
function parseAcaoSolicitada(saidaBruta) {
  const parametros = parseParametrosDestaxa(saidaBruta);
  const mensagem = parametros.mensagem || '';
  const temOpcao = Object.prototype.hasOwnProperty.call(parametros, 'opcao');
  const temTipo = Object.prototype.hasOwnProperty.call(parametros, 'tipo');

  if (temOpcao) {
    const opcoes = String(parametros.opcao || '')
      .split('|')
      .map((o) => o.trim())
      .filter(Boolean);
    return {
      tipo: TIPOS_ACAO.OPCAO,
      mensagem,
      opcoes,
      tipoDado: parametros.tipo || null,
      mascara: parametros.mascara || null,
      chave: parametros.chave || null,
      timeout: parametros.timeout || null,
      parametros
    };
  }

  if (temTipo) {
    return {
      tipo: TIPOS_ACAO.COLETA,
      mensagem,
      tipoDado: parametros.tipo || null,
      mascara: parametros.mascara || null,
      chave: parametros.chave || null,
      timeout: parametros.timeout || null,
      parametros
    };
  }

  if (mensagem) {
    return {
      tipo: TIPOS_ACAO.DISPLAY,
      mensagem,
      parametros
    };
  }

  return {
    tipo: null,
    mensagem: '',
    parametros,
    acaoDesconhecida: true,
    observacao: 'saida 99 sem mensagem/tipo/opcao — formato não reconhecido pela doc 07'
  };
}

function estadoPorAcao(acao) {
  if (!acao?.tipo) return ESTADOS_TRANSACAO.WAITING_ACTION;
  if (acao.tipo === TIPOS_ACAO.DISPLAY) return ESTADOS_TRANSACAO.DISPLAY;
  if (acao.tipo === TIPOS_ACAO.COLETA) return ESTADOS_TRANSACAO.COLLECT;
  if (acao.tipo === TIPOS_ACAO.OPCAO) return ESTADOS_TRANSACAO.OPTION;
  return ESTADOS_TRANSACAO.WAITING_ACTION;
}

/**
 * Monta entrada de continuaTransacaoDestaxa após ação 99.
 * Doc 07: coleta → informacao=<valor>; display → entrada vazia.
 * Resposta de opção: não confirmado se deve usar `informacao` ou `opcao` — doc cita
 * informacao para coleta; para opção o valor selecionado também usa informacao
 * quando a AC digitou/escolheu (inferência não feita — preferir informacao se valor dado).
 */
function buildContinuaInput(resposta = {}) {
  if (resposta == null || resposta === '') {
    return buildTransactionInput({});
  }
  if (typeof resposta === 'string') {
    // Se já veio no formato Destaxa, preservar; se for só o valor coletado, usar informacao=
    if (resposta.includes('=')) {
      return { texto: resposta, chaves: ['raw'], campos: { raw: resposta } };
    }
    return buildTransactionInput({ informacao: resposta });
  }
  if (resposta.informacao != null) {
    return buildTransactionInput({ informacao: resposta.informacao });
  }
  if (resposta.entradaVazia === true || resposta.displayAck === true) {
    return buildTransactionInput({});
  }
  // Não inventar alias valor→informacao sem doc; aceitar apenas chaves Destaxa explícitas
  return buildTransactionInput(resposta);
}

/**
 * TEF-DESTAXA-51.54 — CNPJ da credenciadora/rede a partir do campo oficial CRT
 * `transacao_rede_cnpj` (docs/06 saída). Nunca deduz de comprovante, provedor,
 * conf Destaxa (18.760.540/0001-39) ou configuração do estabelecimento.
 * @returns {string|null} 14 dígitos ou null
 */
function normalizarCnpjCredenciadoraDestaxa(valor) {
  if (valor == null) return null;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos.length === 14 ? digitos : null;
}

/**
 * Extrai CNPJ fiscal validado dos parâmetros Destaxa (somente `transacao_rede_cnpj`).
 */
function extrairCnpjCredenciadoraDeParametros(parametros = {}) {
  if (!parametros || typeof parametros !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(parametros, 'transacao_rede_cnpj')) {
    return null;
  }
  return normalizarCnpjCredenciadoraDestaxa(parametros.transacao_rede_cnpj);
}

/**
 * TEF-DESTAXA-51.25 — extrai evidências oficiais do retorno 00 (docs/06).
 * TEF-DESTAXA-51.54 — inclui `transacao_rede_cnpj` / cnpj_credenciadora normalizado.
 * Preserva nomes/formatos Destaxa; não inventa campos.
 * @param {object|string|null} resultadoOuSaida - resposta do ciclo (com .saida) ou string chave=valor
 */
function extrairEvidenciasRetorno00(resultadoOuSaida = null) {
  const saida = typeof resultadoOuSaida === 'string'
    ? resultadoOuSaida
    : (resultadoOuSaida?.saida
      || resultadoOuSaida?.evidencias?.saidaOriginal
      || '');
  const parametros = typeof resultadoOuSaida === 'object' && resultadoOuSaida?.parametros
    && typeof resultadoOuSaida.parametros === 'object'
    ? { ...resultadoOuSaida.parametros }
    : parseParametrosDestaxa(saida);

  const nsu = Object.prototype.hasOwnProperty.call(parametros, 'transacao_nsu')
    ? parametros.transacao_nsu
    : null;
  const autorizacao = Object.prototype.hasOwnProperty.call(parametros, 'transacao_autorizacao')
    ? parametros.transacao_autorizacao
    : null;
  const comprovante1via = Object.prototype.hasOwnProperty.call(parametros, 'transacao_comprovante_1via')
    ? parametros.transacao_comprovante_1via
    : null;
  const comprovante2via = Object.prototype.hasOwnProperty.call(parametros, 'transacao_comprovante_2via')
    ? parametros.transacao_comprovante_2via
    : null;
  const redeCnpjBruto = Object.prototype.hasOwnProperty.call(parametros, 'transacao_rede_cnpj')
    ? parametros.transacao_rede_cnpj
    : null;
  const cnpjCredenciadora = extrairCnpjCredenciadoraDeParametros(parametros);
  const rede = Object.prototype.hasOwnProperty.call(parametros, 'transacao_rede')
    ? parametros.transacao_rede
    : null;
  const administradora = Object.prototype.hasOwnProperty.call(parametros, 'transacao_administradora')
    ? parametros.transacao_administradora
    : null;

  const nsuOk = nsu != null && String(nsu).trim() !== '';
  const autorizacaoOk = autorizacao != null && String(autorizacao).trim() !== '';
  const via1Ok = comprovante1via != null && String(comprovante1via).trim() !== '';
  const via2Ok = comprovante2via != null && String(comprovante2via).trim() !== '';

  return {
    transacao_nsu: nsuOk ? String(nsu) : (nsu == null ? null : String(nsu)),
    transacao_autorizacao: autorizacaoOk ? String(autorizacao) : (autorizacao == null ? null : String(autorizacao)),
    transacao_comprovante_1via: via1Ok ? String(comprovante1via) : (comprovante1via == null ? null : String(comprovante1via)),
    transacao_comprovante_2via: via2Ok ? String(comprovante2via) : (comprovante2via == null ? null : String(comprovante2via)),
    transacao_rede_cnpj: redeCnpjBruto == null ? null : String(redeCnpjBruto),
    transacao_rede: rede == null ? null : String(rede).trim() || null,
    transacao_administradora: administradora == null ? null : String(administradora).trim() || null,
    nsu: nsuOk ? String(nsu) : null,
    autorizacao: autorizacaoOk ? String(autorizacao) : null,
    comprovanteCliente: via1Ok ? String(comprovante1via) : null,
    comprovanteLoja: via2Ok ? String(comprovante2via) : null,
    cnpj_credenciadora: cnpjCredenciadora,
    adquirente: rede == null ? null : String(rede).trim() || null,
    bandeira: administradora == null ? null : String(administradora).trim() || null,
    parametros,
    saidaOriginal: saida == null ? '' : String(saida),
    completa: nsuOk === true,
    parcial: nsuOk !== true
      || (Object.prototype.hasOwnProperty.call(parametros, 'transacao_autorizacao') && !autorizacaoOk)
      || (Object.prototype.hasOwnProperty.call(parametros, 'transacao_comprovante_1via') && !via1Ok)
      || (Object.prototype.hasOwnProperty.call(parametros, 'transacao_comprovante_2via') && !via2Ok)
  };
}

/**
 * TEF-DESTAXA-51.25 — classificação técnica de A1 sem finalização automática.
 * @param {'iniciaClientDestaxa'|'iniciaTransacaoDestaxa'|string} origemApi
 */
function classificarRetornoA1(origemApi, detalhes = {}) {
  const origem = String(origemApi || '').trim() || 'desconhecida';
  return {
    codigo: 'A1',
    classificacao: CLASSIFICACAO_CODIGO.BLOCKED,
    financialState: 'BLOCKED',
    retryAllowed: false,
    finalizacaoAutomatica: false,
    origemApi: origem,
    mensagem: CODIGOS_RESULTADO.A1?.descricao
      || 'Existem transações não confirmadas. Confirmar ou cancelar antes de novas transações.',
    exigeIdentificacaoPendencia: true,
    exigeAutorizacaoExplicita: true,
    ...detalhes
  };
}

module.exports = {
  parseParametrosDestaxa,
  buildTransactionInput,
  buildContinuaInput,
  buildCrtInput,
  mapearTipoCartaoCrt,
  mapearFormaPagamentoCrt,
  TIPOS_CARTAO_CRT_DOCUMENTADOS,
  FORMAS_PAGAMENTO_CRT_DOCUMENTADAS,
  formatarValorDestaxa,
  valorReaisParaCentavos,
  classificarCodigoTransacao,
  parseAcaoSolicitada,
  estadoPorAcao,
  extrairEvidenciasRetorno00,
  classificarRetornoA1,
  normalizarCnpjCredenciadoraDestaxa,
  extrairCnpjCredenciadoraDeParametros
};
