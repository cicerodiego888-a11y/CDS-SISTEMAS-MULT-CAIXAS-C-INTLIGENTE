'use strict';

const { appendXmlRetornoNfce } = require('./xmlRetornoNfce');
const { consultarProtocolo: consultarProtocoloPadrao } = require('./consultaProtocoloRuntime');
const { ModelType } = require('./core/ModelType');
const { extrairChaveEProtocoloAutorizados } = require('./utils');

function dbGet(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function dbRun(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ changes: this.changes });
    });
  });
}

function block(xml, name) {
  const match = String(xml || '').match(
    new RegExp(`<((?:[\\w.-]+:)${name}|${name})\\b[^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, 'i')
  );
  return match ? match[2] : null;
}

function blocks(xml, name) {
  const pattern = new RegExp(
    `<((?:[\\w.-]+:)${name}|${name})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
    'gi'
  );
  return [...String(xml || '').matchAll(pattern)].map((match) => match[0]);
}

function tag(xml, name) {
  const match = String(xml || '').match(
    new RegExp(`<(?:(?:[\\w.-]+):)?${name}\\b[^>]*>\\s*([^<]*)\\s*<\\/(?:(?:[\\w.-]+):)?${name}\\s*>`, 'i')
  );
  return match ? match[1].trim() : null;
}

function interpretarEventoCancelamento(xml, esperado = {}) {
  const chave = String(esperado.chave || '').replace(/\D/g, '');
  const cnpj = String(esperado.cnpj || '').replace(/\D/g, '');
  const ambiente = String(esperado.ambiente || '');
  const codigoUf = String(esperado.codigoUf || '').replace(/\D/g, '').padStart(2, '0');
  const protocoloAutorizacao = String(esperado.protocoloAutorizacao || '');
  const retorno = block(xml, 'retConsSitNFe') || String(xml || '');
  const resposta = {
    confirmado: false,
    encontrado: false,
    conflito: false,
    motivo: null,
    chave: null,
    cStat: null,
    xMotivo: null,
    protocolo: null,
    dataCancelamento: null
  };

  const candidatos = blocks(retorno, 'procEventoNFe').filter((procEvento) => {
    const evento = block(procEvento, 'evento');
    const infEvento = evento && block(evento, 'infEvento');
    const retEvento = block(procEvento, 'retEvento');
    const infRetEvento = retEvento && block(retEvento, 'infEvento');
    return tag(infEvento, 'tpEvento') === '110111'
      || tag(infRetEvento, 'tpEvento') === '110111';
  });

  if (!candidatos.length) {
    resposta.motivo = 'Consulta oficial não retornou procEventoNFe do evento 110111.';
    return resposta;
  }
  resposta.encontrado = true;

  const conflitos = [];
  if (!/^\d{44}$/.test(chave) || chave.slice(20, 22) !== '65') conflitos.push('chave esperada inválida');
  if (!/^\d{14}$/.test(cnpj) || chave.slice(6, 20) !== cnpj) conflitos.push('CNPJ esperado incompatível');
  if (!/^[12]$/.test(ambiente)) conflitos.push('ambiente esperado inválido');
  if (!/^\d{2}$/.test(codigoUf) || chave.slice(0, 2) !== codigoUf) conflitos.push('UF esperada incompatível');
  if (!/^\d{15}$|^\d{17}$/.test(protocoloAutorizacao)) conflitos.push('protocolo de autorização esperado ausente ou inválido');
  if (candidatos.length !== 1) conflitos.push('mais de um evento de cancelamento retornado');

  const procEvento = candidatos.length === 1 ? candidatos[0] : '';
  const evento = procEvento && block(procEvento, 'evento');
  const infEvento = evento && block(evento, 'infEvento');
  const retEvento = procEvento && block(procEvento, 'retEvento');
  const infRetEvento = retEvento && block(retEvento, 'infEvento');
  const idEvento = evento
    && evento.match(/<(?:(?:[\w.-]+):)?infEvento\b[^>]*\bId=["']([^"']+)["']/i)?.[1];
  const chaveEvento = tag(infEvento, 'chNFe');
  const chaveRetorno = tag(infRetEvento, 'chNFe');
  const detalheEvento = infEvento && block(infEvento, 'detEvento');
  const protocoloEventoOrigem = tag(detalheEvento, 'nProt');
  const cStat = tag(infRetEvento, 'cStat');
  const protocolo = tag(infRetEvento, 'nProt');
  const dataCancelamento = tag(infRetEvento, 'dhRegEvento');

  if (!retorno || tag(retorno, 'cStat') !== '100') conflitos.push('status da consulta oficial não confirma resposta válida');
  if (tag(retorno, 'tpAmb') !== ambiente) conflitos.push('ambiente da consulta divergente');
  if (tag(retorno, 'chNFe') !== chave) conflitos.push('chave da consulta divergente');
  if (tag(retorno, 'cUF') !== codigoUf) conflitos.push('UF da consulta divergente');
  if (tag(infEvento, 'tpAmb') !== ambiente || tag(infRetEvento, 'tpAmb') !== ambiente) {
    conflitos.push('ambiente do evento divergente');
  }
  if (tag(infEvento, 'cOrgao') !== codigoUf || tag(infRetEvento, 'cOrgao') !== codigoUf) {
    conflitos.push('UF do evento divergente');
  }
  if (tag(infEvento, 'CNPJ') !== cnpj) conflitos.push('CNPJ autor do evento divergente');
  if (chaveEvento !== chave || chaveRetorno !== chave) conflitos.push('chave do evento divergente');
  if (tag(infEvento, 'tpEvento') !== '110111' || tag(infRetEvento, 'tpEvento') !== '110111') {
    conflitos.push('tipo de evento divergente');
  }
  if (tag(infEvento, 'nSeqEvento') !== '1' || tag(infRetEvento, 'nSeqEvento') !== '1') {
    conflitos.push('sequência do evento divergente');
  }
  if (idEvento !== `ID110111${chave}01`) conflitos.push('identificador do evento divergente');
  if (!['101', '135', '155'].includes(cStat)) conflitos.push('cStat do evento não comprova cancelamento');
  if (!/^\d{15}$|^\d{17}$/.test(protocolo)) conflitos.push('protocolo de registro do evento ausente ou inválido');
  if (protocoloEventoOrigem !== protocoloAutorizacao) conflitos.push('protocolo de autorização referenciado pelo evento divergente');
  if (!dataCancelamento) conflitos.push('data de registro do evento ausente');

  if (conflitos.length) {
    resposta.conflito = true;
    resposta.motivo = `Evento 110111 não confirmado: ${[...new Set(conflitos)].join('; ')}.`;
    return resposta;
  }

  return {
    ...resposta,
    confirmado: true,
    motivo: tag(infRetEvento, 'xMotivo'),
    chave,
    cStat,
    xMotivo: tag(infRetEvento, 'xMotivo'),
    protocolo,
    dataCancelamento
  };
}

async function confirmarEventoCancelamentoNfce(dados = {}) {
  const consultar = dados.consultarProtocolo || consultarProtocoloPadrao;
  let consulta;
  try {
    consulta = await consultar({
      chave: dados.chave,
      modelo: ModelType.NFCE,
      ambiente: dados.ambiente,
      cUF: dados.codigoUf,
      certificadoPath: dados.certificadoPath,
      certificadoSenha: dados.certificadoSenha,
      protocoloAutorizacao: dados.protocoloAutorizacao
    });
  } catch (cause) {
    return {
      confirmado: false,
      encontrado: false,
      conflito: false,
      motivo: `Consulta oficial do evento 110111 falhou: ${cause?.message || String(cause)}.`,
      retornoXml: null
    };
  }

  const retornoXml = String(consulta?.body || '');
  if (consulta?.success !== true || !retornoXml) {
    const detalhe = String(consulta?.error || consulta?.message || '').trim();
    return {
      confirmado: false,
      encontrado: false,
      conflito: false,
      motivo: `Consulta oficial do evento 110111 inconclusiva${detalhe ? `: ${detalhe}` : '.'}`,
      retornoXml: retornoXml || null
    };
  }

  return {
    ...interpretarEventoCancelamento(retornoXml, dados),
    retornoXml
  };
}

function interpretarConsulta(xml) {
  const consulta = block(xml, 'protNFe');
  const infProt = consulta && block(consulta, 'infProt');
  if (!infProt) {
    return {
      status: 'cancelamento_desconhecido',
      cStat: null,
      chave: null,
      protocolo: null,
      ambiente: null
    };
  }

  const cStat = tag(infProt, 'cStat');
  const status = ['100', '150'].includes(cStat)
    ? 'autorizada'
    : 'cancelamento_desconhecido';
  return {
    status,
    cStat,
    chave: tag(infProt, 'chNFe'),
    protocolo: tag(infProt, 'nProt'),
    ambiente: tag(infProt, 'tpAmb')
  };
}

function erro(message, statusCode, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

async function reconciliarCancelamentoNfce(nfceId, options = {}) {
  const id = Number(nfceId);
  if (!Number.isInteger(id) || id <= 0) {
    throw erro('ID da NFC-e inválido.', 400, 'NFCE_ID_INVALIDO');
  }
  if (options.confirmacaoConsulta !== true) {
    throw erro('Confirmação explícita obrigatória para consultar a situação fiscal.', 400, 'CONFIRMACAO_OBRIGATORIA');
  }

  const database = options.db || require('../../database');
  const nota = await dbGet(database, 'SELECT * FROM nfce_notas WHERE id = ?', [id]);
  if (!nota) throw erro('NFC-e não encontrada.', 404, 'NFCE_NAO_ENCONTRADA');
  if (String(nota.status || '').toLowerCase() !== 'cancelamento_desconhecido') {
    throw erro('Somente NFC-e com cancelamento_desconhecido pode ser reconciliada por este fluxo.', 409, 'STATUS_INCOMPATIVEL');
  }

  const chave = String(nota.chave_acesso || '').replace(/\D/g, '');
  if (!/^\d{44}$/.test(chave) || chave.slice(20, 22) !== '65') {
    throw erro('A NFC-e não possui chave válida do modelo 65.', 400, 'CHAVE_NFCE_INVALIDA');
  }

  const getConfig = options.getFiscalConfig || (() => require('./configService').getFiscalConfig());
  const config = await getConfig();
  const cnpjConfig = String(config.cnpj || '').replace(/\D/g, '');
  if (!/^\d{14}$/.test(cnpjConfig)) {
    throw erro('CNPJ fiscal não está configurado corretamente; a reconciliação foi bloqueada.', 409, 'CNPJ_CONFIG_INVALIDO');
  }
  if (chave.slice(6, 20) !== cnpjConfig) {
    throw erro('A chave da NFC-e não corresponde ao CNPJ fiscal configurado.', 409, 'CNPJ_DIVERGENTE');
  }
  const codigoUf = String(config.codigoUf || '23').replace(/\D/g, '').padStart(2, '0');
  if (chave.slice(0, 2) !== codigoUf) {
    throw erro('A chave da NFC-e não corresponde à UF fiscal configurada.', 409, 'UF_DIVERGENTE');
  }
  const ambiente = Number(nota.ambiente || config.ambiente);
  if (![1, 2].includes(ambiente)) {
    throw erro('O ambiente fiscal da NFC-e não está definido corretamente.', 409, 'AMBIENTE_INVALIDO');
  }
  if (
    nota.ambiente != null
    && config.ambiente != null
    && Number(nota.ambiente) !== Number(config.ambiente)
  ) {
    throw erro('O ambiente da NFC-e diverge do ambiente fiscal configurado.', 409, 'AMBIENTE_DIVERGENTE');
  }

  const consultar = options.consultarProtocolo || consultarProtocoloPadrao;
  let consulta;
  try {
    consulta = await consultar({
      chave,
      modelo: ModelType.NFCE,
      ambiente,
      cUF: codigoUf,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha
    });
  } catch (cause) {
    const detalhe = cause && cause.message ? ` Detalhe: ${cause.message}` : '';
    throw erro(
      `A consulta à SEFAZ não foi concluída; nenhum retorno foi confirmado. A NFC-e permanece bloqueada e inalterada.${detalhe}`,
      502,
      'CONSULTA_SEFAZ_INCONCLUSIVA'
    );
  }

  const retornoXml = String(consulta && consulta.body || '');
  if (!consulta || consulta.success !== true || !retornoXml) {
    const detalhe = String((consulta && (consulta.error || consulta.message)) || '').trim();
    throw erro(
      `A consulta à SEFAZ não foi concluída; nenhum retorno foi confirmado. A NFC-e permanece bloqueada e inalterada.${detalhe ? ` Detalhe: ${detalhe}` : ''}`,
      502,
      'CONSULTA_SEFAZ_INCONCLUSIVA'
    );
  }

  const resultado = interpretarConsulta(retornoXml);
  const retornoConsulta = block(retornoXml, 'retConsSitNFe');
  const chaveResposta = tag(retornoConsulta, 'chNFe');
  const ambienteResposta = tag(retornoConsulta, 'tpAmb');
  const ufResposta = tag(retornoConsulta, 'cUF');
  const cStatConsulta = tag(retornoConsulta, 'cStat');
  const divergenciaResposta = (chaveResposta && chaveResposta !== chave)
    || (ambienteResposta && Number(ambienteResposta) !== ambiente)
    || (ufResposta && ufResposta !== codigoUf);
  if (divergenciaResposta) {
    const xmlDivergente = appendXmlRetornoNfce(nota.xml_retorno, retornoXml);
    const registro = await dbRun(database, `
      UPDATE nfce_notas
      SET xml_retorno = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'cancelamento_desconhecido' AND chave_acesso = ?
    `, [xmlDivergente, id, nota.chave_acesso]);
    if (registro.changes !== 1) {
      throw erro('A divergência fiscal não pôde ser registrada; a NFC-e permanece bloqueada.', 500, 'PERSISTENCIA_RECONCILIACAO_INDETERMINADA');
    }
    throw erro('A SEFAZ retornou chave, ambiente ou UF divergente; o estado da NFC-e foi mantido para análise.', 409, 'IDENTIDADE_SEFAZ_DIVERGENTE');
  }
  const evento = interpretarEventoCancelamento(retornoXml, {
    chave,
    cnpj: cnpjConfig,
    codigoUf,
    ambiente,
    protocoloAutorizacao: nota.protocolo
      || extrairChaveEProtocoloAutorizados(nota.xml_retorno)?.protocolo
  });
  if (evento.conflito) {
    const xmlDivergente = appendXmlRetornoNfce(nota.xml_retorno, retornoXml);
    const registro = await dbRun(database, `
      UPDATE nfce_notas
      SET xml_retorno = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'cancelamento_desconhecido' AND chave_acesso = ?
    `, [xmlDivergente, id, nota.chave_acesso]);
    if (registro.changes !== 1) {
      throw erro('A divergência fiscal não pôde ser registrada; a NFC-e permanece bloqueada.', 500, 'PERSISTENCIA_RECONCILIACAO_INDETERMINADA');
    }
    throw erro(`A consulta oficial retornou divergência. A NFC-e permanece bloqueada. ${evento.motivo}`, 409, 'EVENTO_SEFAZ_DIVERGENTE');
  }
  const resultadoFinal = evento.confirmado
    ? {
      status: 'cancelada',
      cStat: evento.cStat,
      chave: evento.chave,
      protocolo: evento.protocolo,
      ambiente: String(ambiente)
    }
    : resultado;
  if (resultadoFinal.chave && resultadoFinal.chave.replace(/\D/g, '') !== chave) {
    const xmlDivergente = appendXmlRetornoNfce(nota.xml_retorno, retornoXml);
    await dbRun(database, `
      UPDATE nfce_notas
      SET xml_retorno = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'cancelamento_desconhecido' AND chave_acesso = ?
    `, [xmlDivergente, id, nota.chave_acesso]);
    throw erro('A SEFAZ retornou uma chave diferente da NFC-e selecionada; o estado local foi mantido.', 409, 'CHAVE_SEFAZ_DIVERGENTE');
  }
  if (
    resultadoFinal.chave
    && resultadoFinal.ambiente != null
    && Number(resultadoFinal.ambiente) !== ambiente
  ) {
    const xmlDivergente = appendXmlRetornoNfce(nota.xml_retorno, retornoXml);
    await dbRun(database, `
      UPDATE nfce_notas
      SET xml_retorno = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'cancelamento_desconhecido' AND chave_acesso = ?
    `, [xmlDivergente, id, nota.chave_acesso]);
    throw erro('A SEFAZ retornou uma NFC-e de ambiente diferente; o estado local foi mantido.', 409, 'AMBIENTE_SEFAZ_DIVERGENTE');
  }

  const xmlAtualizado = appendXmlRetornoNfce(nota.xml_retorno, retornoXml);
  const statusAtualizado = Boolean(
    cStatConsulta === '100'
    && chaveResposta === chave
    && ambienteResposta != null
    && Number(ambienteResposta) === ambiente
    && ufResposta === codigoUf
    && resultadoFinal.chave
    && resultadoFinal.ambiente != null
    && Number(resultadoFinal.ambiente) === ambiente
    && resultadoFinal.status !== 'cancelamento_desconhecido'
  );
  const statusNovo = statusAtualizado ? resultadoFinal.status : 'cancelamento_desconhecido';
  const persistencia = await dbRun(database, `
    UPDATE nfce_notas
    SET status = ?, xml_retorno = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ? AND status = 'cancelamento_desconhecido' AND chave_acesso = ?
  `, [statusNovo, xmlAtualizado, id, nota.chave_acesso]);

  if (persistencia.changes !== 1) {
    throw erro('A NFC-e mudou durante a reconciliação; nenhuma nova tentativa foi liberada.', 409, 'PERSISTENCIA_RECONCILIACAO_INDETERMINADA');
  }

  return {
    success: statusAtualizado,
    notaId: id,
    chaveAcesso: chave,
    status: statusNovo,
    cStat: resultadoFinal.cStat,
    protocolo: evento.confirmado ? evento.protocolo : resultadoFinal.protocolo,
    message: statusAtualizado
      ? (statusNovo === 'autorizada'
        ? 'A SEFAZ confirmou que a NFC-e permanece autorizada e o estado local foi reconciliado. Nenhum evento foi enviado; o fluxo normal de cancelamento continuará sujeito ao prazo fiscal.'
        : 'A SEFAZ confirmou que a NFC-e está cancelada. Nenhum novo evento foi enviado.')
      : 'A consulta não confirmou autorização nem cancelamento para a chave selecionada. A NFC-e permanece bloqueada para nova tentativa.'
  };
}

module.exports = {
  interpretarConsulta,
  interpretarEventoCancelamento,
  confirmarEventoCancelamentoNfce,
  reconciliarCancelamentoNfce
};
