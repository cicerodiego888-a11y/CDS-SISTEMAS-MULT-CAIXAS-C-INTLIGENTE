/**
 * Catálogo de erros amigáveis da NF-e — Sprint 3.4.
 * Nunca expõe stack trace ao operador.
 */

'use strict';

const CATALOGO = {
  CERTIFICADO_INVALIDO: {
    codigo: 'CERTIFICADO_INVALIDO',
    mensagem: 'Certificado Digital inválido.',
    sugestao: 'Verifique o arquivo .pfx, a senha e se o certificado está dentro da validade.'
  },
  CERTIFICADO_VENCIDO: {
    codigo: 'CERTIFICADO_VENCIDO',
    mensagem: 'Certificado Digital vencido.',
    sugestao: 'Instale um novo certificado A1 válido e atualize a senha nas configurações fiscais.'
  },
  CERTIFICADO_AUSENTE: {
    codigo: 'CERTIFICADO_AUSENTE',
    mensagem: 'Certificado Digital não encontrado.',
    sugestao: 'Faça o upload do certificado nas configurações fiscais.'
  },
  FALHA_COMUNICACAO: {
    codigo: 'FALHA_COMUNICACAO',
    mensagem: 'Falha de comunicação com a SEFAZ.',
    sugestao: 'Verifique a internet e tente novamente. Se persistir, use o Diagnóstico Fiscal.'
  },
  TIMEOUT: {
    codigo: 'TIMEOUT',
    mensagem: 'Timeout durante transmissão.',
    sugestao: 'A SEFAZ demorou para responder. Use REENVIAR ou consulte a situação da nota.'
  },
  SERVICO_INDISPONIVEL: {
    codigo: 'SERVICO_INDISPONIVEL',
    mensagem: 'Serviço SEFAZ indisponível.',
    sugestao: 'Aguarde alguns minutos e use REENVIAR. Consulte o status do serviço no Diagnóstico.'
  },
  XML_REJEITADO: {
    codigo: 'XML_REJEITADO',
    mensagem: 'XML rejeitado pela SEFAZ.',
    sugestao: 'Revise os dados do cliente, itens, NCM/CFOP e natureza da operação.'
  },
  NUMERACAO_INVALIDA: {
    codigo: 'NUMERACAO_INVALIDA',
    mensagem: 'Numeração inválida.',
    sugestao: 'Ajuste a série/número da NF-e nas configurações fiscais (somente SUPER ADMIN).'
  },
  DUPLICIDADE: {
    codigo: 'DUPLICIDADE',
    mensagem: 'Duplicidade de NF-e.',
    sugestao: 'Esta nota já foi enviada. Consulte a situação pela chave ou avance a numeração.'
  },
  LOTE_PROCESSAMENTO: {
    codigo: 'LOTE_PROCESSAMENTO',
    mensagem: 'Lote em processamento.',
    sugestao: 'Aguarde a consulta automática. Não reemitir até obter o retorno definitivo.'
  },
  ERRO_ASSINATURA: {
    codigo: 'ERRO_ASSINATURA',
    mensagem: 'Falha ao assinar o XML.',
    sugestao: 'Verifique o certificado e a senha. Execute o Diagnóstico Fiscal.'
  },
  CONFIGURACAO: {
    codigo: 'CONFIGURACAO',
    mensagem: 'Configuração fiscal incompleta.',
    sugestao: 'Complete CNPJ, IE, certificado, ambiente e UF nas configurações fiscais.'
  },
  DESCONHECIDO: {
    codigo: 'DESCONHECIDO',
    mensagem: 'Ocorreu um erro na operação fiscal.',
    sugestao: 'Consulte o Monitor NF-e e o Diagnóstico Fiscal. Se necessário, contate o suporte.'
  }
};

const CSTAT_MAP = {
  '100': null,
  '101': null,
  '105': 'LOTE_PROCESSAMENTO',
  '104': 'LOTE_PROCESSAMENTO',
  '108': 'SERVICO_INDISPONIVEL',
  '109': 'SERVICO_INDISPONIVEL',
  '110': 'XML_REJEITADO',
  '204': 'DUPLICIDADE',
  '539': 'DUPLICIDADE',
  '213': 'NUMERACAO_INVALIDA',
  '563': 'NUMERACAO_INVALIDA',
  '215': 'XML_REJEITADO',
  '225': 'XML_REJEITADO',
  '301': 'XML_REJEITADO',
  '302': 'XML_REJEITADO'
};

const REENVIAVEL = new Set([
  'FALHA_COMUNICACAO',
  'TIMEOUT',
  'SERVICO_INDISPONIVEL',
  'LOTE_PROCESSAMENTO',
  'erro_comunicacao',
  'erro_transmissao',
  'timeout',
  'servico_indisponivel',
  'lote_processamento',
  'aguardando_retorno',
  'pendente_reenvio'
]);

const BLOQUEIO_REENVIO = new Set([
  'autorizada',
  'cancelada',
  'denegada',
  'inutilizada'
]);

function obterCatalogo(codigo) {
  return CATALOGO[codigo] || CATALOGO.DESCONHECIDO;
}

function classificarPorTexto(texto) {
  const t = String(texto || '').toLowerCase();
  if (!t) return obterCatalogo('DESCONHECIDO');
  if (/certificado.*(vencid|expir)/i.test(t) || /notafter|expired/i.test(t)) return obterCatalogo('CERTIFICADO_VENCIDO');
  if (/certificado.*(inv[aá]lid|n[aã]o encontr|ausente|senha)/i.test(t) || /pfx|pkcs12/i.test(t)) {
    if (/n[aã]o encontr|ausente|enoent/i.test(t)) return obterCatalogo('CERTIFICADO_AUSENTE');
    return obterCatalogo('CERTIFICADO_INVALIDO');
  }
  if (/timeout|etimedout|esockettimedout|aborted/i.test(t)) return obterCatalogo('TIMEOUT');
  if (/econnrefused|enotfound|eai_again|network|socket hang|getaddrinfo/i.test(t)) {
    return obterCatalogo('FALHA_COMUNICACAO');
  }
  if (/503|indispon[ií]vel|serviço.*paralisado|svrs.*fora/i.test(t)) return obterCatalogo('SERVICO_INDISPONIVEL');
  if (/assinatura|sign|key\.key|privatekey|cryptokey/i.test(t)) return obterCatalogo('ERRO_ASSINATURA');
  if (/duplicid|j[aá] existe|204|539/i.test(t)) return obterCatalogo('DUPLICIDADE');
  if (/numera[cç][aã]o|n[uú]mero.*inv[aá]lid/i.test(t)) return obterCatalogo('NUMERACAO_INVALIDA');
  if (/lote.*process|105|104/i.test(t)) return obterCatalogo('LOTE_PROCESSAMENTO');
  if (/rejeit|schema|xml/i.test(t)) return obterCatalogo('XML_REJEITADO');
  return obterCatalogo('DESCONHECIDO');
}

function classificarPorCStat(cStat, xMotivo) {
  const code = CSTAT_MAP[String(cStat || '')];
  if (code) return obterCatalogo(code);
  if (cStat && String(cStat) !== '100' && String(cStat) !== '101') {
    const base = obterCatalogo('XML_REJEITADO');
    return {
      ...base,
      mensagem: xMotivo ? `XML rejeitado: ${xMotivo}` : base.mensagem,
      cStat: String(cStat)
    };
  }
  return null;
}

function classificarErro(input = {}) {
  const cStat = input.cStat || (String(input.xml || input.body || '').match(/<cStat>(\d+)<\/cStat>/) || [])[1];
  const xMotivo = input.xMotivo || (String(input.xml || input.body || '').match(/<xMotivo>([^<]+)<\/xMotivo>/) || [])[1];
  const porStat = classificarPorCStat(cStat, xMotivo);
  if (porStat) return { ...porStat, cStat: cStat || null, xMotivo: xMotivo || null, tecnico: String(input.erro || input.message || '').slice(0, 200) };

  const porTexto = classificarPorTexto(input.erro || input.message || input.xml || input.body);
  return {
    ...porTexto,
    cStat: cStat || null,
    xMotivo: xMotivo || null,
    tecnico: String(input.erro || input.message || '').slice(0, 200)
  };
}

function podeReenviar({ status, erroCodigo } = {}) {
  const st = String(status || '').toLowerCase();
  if (BLOQUEIO_REENVIO.has(st)) return false;
  if (REENVIAVEL.has(st)) return true;
  if (erroCodigo && REENVIAVEL.has(String(erroCodigo))) return true;
  return false;
}

function statusParaFila(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'autorizada') return 'autorizado';
  if (s === 'cancelada') return 'cancelado';
  if (s === 'aguardando_retorno' || s === 'lote_processamento') return 'aguardando';
  if (s === 'emitindo' || s === 'transmitindo') return 'transmitindo';
  if (s === 'pendente_reenvio' || s === 'reenvio') return 'reenvio';
  if (s.includes('consulta')) return 'consulta';
  if (s.includes('erro') || s === 'timeout' || s === 'servico_indisponivel' || s === 'erro_comunicacao' || s === 'erro_transmissao' || s === 'rejeitada') {
    return 'erro';
  }
  if (s === 'pendente') return 'aguardando';
  return 'aguardando';
}

function statusOperacionalDeErro(erro) {
  const codigo = erro?.codigo || 'DESCONHECIDO';
  if (codigo === 'TIMEOUT') return 'timeout';
  if (codigo === 'SERVICO_INDISPONIVEL') return 'servico_indisponivel';
  if (codigo === 'LOTE_PROCESSAMENTO') return 'aguardando_retorno';
  if (codigo === 'FALHA_COMUNICACAO') return 'erro_comunicacao';
  if (codigo === 'ERRO_ASSINATURA') return 'erro_assinatura';
  if (codigo === 'XML_REJEITADO' || codigo === 'DUPLICIDADE' || codigo === 'NUMERACAO_INVALIDA') return 'rejeitada';
  return 'erro_transmissao';
}

function respostaAmigavel(erroOuCodigo, extras = {}) {
  const erro = typeof erroOuCodigo === 'string'
    ? obterCatalogo(erroOuCodigo)
    : (erroOuCodigo?.codigo ? erroOuCodigo : classificarErro(erroOuCodigo || {}));
  return {
    success: false,
    mensagem: erro.mensagem,
    codigo: erro.codigo,
    sugestao: erro.sugestao,
    cStat: erro.cStat || extras.cStat || null,
    ...extras
  };
}

module.exports = {
  CATALOGO,
  CSTAT_MAP,
  obterCatalogo,
  classificarErro,
  classificarPorTexto,
  classificarPorCStat,
  podeReenviar,
  statusParaFila,
  statusOperacionalDeErro,
  respostaAmigavel,
  REENVIAVEL,
  BLOQUEIO_REENVIO
};
