/**
 * Sprint — Reconciliação NFC-e CStat 539 (chave existente na SEFAZ).
 * Não assume "rejeitar e incrementar": consulta a chave informada pela SEFAZ.
 */

'use strict';

const { onlyDigits } = require('../fiscal/utils');
const {
  aplicarOcupacaoPorRejeicao539Nfce,
  extrairChaveConflito539,
  parseChaveNfce,
  registrarNumeroOcupadoSefazNfce
} = require('../fiscal/nfceNumeracaoOcupadosService');
const { DOC_STATUS, STATUS } = require('./constants');
const { toCentavos, arredondarMoeda } = require('../fiscal/modeloTotais');

/** Máximo de números reconciliados automaticamente por ciclo de transmissão. */
const MAX_RECONCILIACOES_539_POR_CICLO = 10;

const RESULTADO = Object.freeze({
  AUTORIZADO: 'AUTORIZADO',
  OCUPADO: 'OCUPADO',
  NAO_LOCALIZADO: 'NAO_LOCALIZADO',
  ERRO_CONSULTA: 'ERRO_CONSULTA',
  LIMITE_LOOP: 'LIMITE_LOOP',
  SEM_CHAVE: 'SEM_CHAVE'
});

function log539(acao, campos = {}) {
  const parts = Object.entries({ acao, ...campos })
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  // eslint-disable-next-line no-console
  console.log(`[FISCAL][CSTAT539][RECONCILIACAO] ${parts.join(' ')}`);
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function agoraLocal() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function extrairCStat(raw) {
  const m = String(raw || '').match(/<cStat>\s*([^<]+)\s*<\/cStat>/i);
  return m ? String(m[1]).trim() : null;
}

function extrairNProt(raw) {
  const m = String(raw || '').match(/<nProt>\s*([^<]+)\s*<\/nProt>/i);
  return m ? String(m[1]).trim() : null;
}

function extrairXMotivo(raw) {
  const m = String(raw || '').match(/<xMotivo>\s*([^<]+)\s*<\/xMotivo>/i);
  return m ? String(m[1]).trim() : null;
}

/**
 * Proteção: chave já contabilizada como AUTORIZADA neste fechamento.
 */
async function chaveJaAutorizadaNoFechamento(db, fechamentoId, chave) {
  const dig = onlyDigits(chave);
  if (!dig || dig.length !== 44) return null;
  return get(
    db,
    `SELECT id, valor_total, status, protocolo, chave_acesso
     FROM fechamentos_fiscais_documentos
     WHERE fechamento_fiscal_id = ?
       AND REPLACE(REPLACE(COALESCE(chave_acesso,''), ' ', ''), '-', '') = ?
       AND UPPER(status) IN ('AUTORIZADO','AUTORIZADA')
     LIMIT 1`,
    [fechamentoId, dig]
  );
}

/**
 * Correspondência segura para contabilizar valor no fechamento.
 * Conservador: só associa se mesma chave enviada OU chave já vinculada ao doc
 * OU nNF+série da chave SEFAZ batem com o enviado e não há outra auth com a chave.
 */
async function avaliarAssociacaoSegura({
  db,
  fechamentoId,
  documento,
  numeroEnviado,
  serieEnviada,
  chaveEnviada,
  chaveSefaz,
  protocolo
}) {
  const digSefaz = onlyDigits(chaveSefaz);
  const digEnv = onlyDigits(chaveEnviada);
  if (!digSefaz || digSefaz.length !== 44) {
    return { associavel: false, motivo: 'CHAVE_SEFAZ_INVALIDA' };
  }

  const ja = await chaveJaAutorizadaNoFechamento(db, fechamentoId, digSefaz);
  if (ja && Number(ja.id) !== Number(documento.id)) {
    return {
      associavel: false,
      motivo: 'CHAVE_JA_CONTABILIZADA',
      documento_autorizado_id: ja.id,
      valor_ja_contado: ja.valor_total
    };
  }
  if (ja && Number(ja.id) === Number(documento.id)) {
    return { associavel: true, motivo: 'JA_AUTORIZADO_MESMO_DOC', idempotente: true };
  }

  if (digEnv && digEnv === digSefaz) {
    return { associavel: true, motivo: 'MESMA_CHAVE_ENVIADA', protocolo };
  }

  const parsed = parseChaveNfce(digSefaz);
  if (
    parsed
    && Number(parsed.numero) === Number(numeroEnviado)
    && Number(parsed.serie) === Number(serieEnviada || 1)
    && protocolo
  ) {
    // nNF coincide + protocolo de autorização: ainda exige que o valor
    // do documento seja o único pendente com esse número (sem prova de valor SEFAZ).
    // Conservador: NÃO associar automaticamente só por nNF — Case B.
    // Associar apenas se o XML do próprio documento já continha essa chave em tentativa anterior.
    const hist = await get(
      db,
      `SELECT id FROM fechamentos_fiscais_transmissoes
       WHERE documento_id = ?
         AND REPLACE(REPLACE(COALESCE(chave_acesso,''), ' ', ''), '-', '') = ?
       LIMIT 1`,
      [documento.id, digSefaz]
    ).catch(() => null);
    if (hist) {
      return { associavel: true, motivo: 'CHAVE_EM_HISTORICO_DOC', protocolo };
    }
  }

  return { associavel: false, motivo: 'SEM_CORRESPONDENCIA_SEGURA', protocolo };
}

function interpretarConsulta539(consulta) {
  const raw = String(
    (consulta && (consulta.body || consulta.raw || consulta.xml || consulta.message)) || ''
  );
  const cStat = String(
    (consulta && (consulta.cStat || consulta.cstat)) || extrairCStat(raw) || ''
  ).trim();
  const xMotivo = (consulta && (consulta.xMotivo || consulta.xmotivo)) || extrairXMotivo(raw);
  const protocolo = (consulta && consulta.protocolo) || extrairNProt(raw);
  const success = consulta && (consulta.success === true || consulta.ok === true);

  if (cStat === '100' || cStat === '150' || /<cStat>\s*100\s*<\/cStat>/i.test(raw)) {
    return {
      encontrado: true,
      autorizado: true,
      cStat: cStat || '100',
      xMotivo,
      protocolo,
      raw
    };
  }
  if (cStat === '217' || /não\s+consta|nao\s+consta|inexistent/i.test(String(xMotivo || ''))) {
    return {
      encontrado: false,
      autorizado: false,
      cStat: cStat || '217',
      xMotivo,
      protocolo: null,
      raw
    };
  }
  if (!success && !cStat) {
    return {
      encontrado: null,
      autorizado: false,
      cStat: null,
      xMotivo: xMotivo || (consulta && consulta.error) || 'Falha na consulta',
      protocolo: null,
      raw,
      erro: true
    };
  }
  // Existe resposta mas não é autorização clara
  return {
    encontrado: true,
    autorizado: false,
    cStat,
    xMotivo,
    protocolo,
    raw
  };
}

/**
 * Fluxo completo CStat 539 para um documento do fechamento.
 */
async function reconciliarCstat539Documento({
  db,
  fechamentoId,
  documento,
  config,
  numeroEnviado,
  chaveEnviada,
  xMotivo,
  xmlRetorno,
  contadorCiclo,
  deps = {}
} = {}) {
  const serie = Number(
    (documento && documento.serie) || (config && config.serie) || 1
  );
  const ambiente = Number(
    (documento && documento.ambiente) != null
      ? documento.ambiente
      : (config && config.ambiente)
  );
  const cnpj = (config && config.cnpj) || '';

  if (contadorCiclo != null && Number(contadorCiclo) >= MAX_RECONCILIACOES_539_POR_CICLO) {
    log539('LIMITE_LOOP', {
      nNF: numeroEnviado,
      fechamentoId,
      max: MAX_RECONCILIACOES_539_POR_CICLO
    });
    return {
      resultado: RESULTADO.LIMITE_LOOP,
      statusDocumento: DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO,
      statusFechamentoSugerido: STATUS.PENDENTE_RECUPERACAO,
      mensagem:
        'Limite de reconciliações CStat 539 atingido neste ciclo. Situação pendente de recuperação.',
      numero: numeroEnviado,
      chaveSefaz: null
    };
  }

  // 1) Persistir ocupação imediatamente (número NÃO reutilizável)
  const aplicarOcupacao = deps.aplicarOcupacaoPorRejeicao539Nfce || aplicarOcupacaoPorRejeicao539Nfce;
  const registrarOcupado = deps.registrarNumeroOcupadoSefazNfce || registrarNumeroOcupadoSefazNfce;

  const ocupacao = await aplicarOcupacao({
    cnpj,
    ambiente,
    serie,
    numeroEnviado,
    chaveEnviada,
    xMotivo,
    xmlRetorno,
    cStat: '539'
  });

  const chaveSefaz = ocupacao.chaveSefaz
    || extrairChaveConflito539(xMotivo, xmlRetorno);

  if (!chaveSefaz || onlyDigits(chaveSefaz).length !== 44) {
    log539('SEM_CHAVE', { nNF: numeroEnviado, fechamentoId, resultado: RESULTADO.SEM_CHAVE });
    return {
      resultado: RESULTADO.SEM_CHAVE,
      statusDocumento: DOC_STATUS.REJEITADO,
      ocupacao,
      numero: numeroEnviado,
      chaveSefaz: null,
      mensagem:
        'Foi identificada uma numeração já existente na SEFAZ (CStat 539), '
        + 'mas a chave não pôde ser extraída. Número marcado como ocupado — não será reutilizado.',
      reconciliacao: true
    };
  }

  log539('CONSULTA_SEFAZ', {
    nNF: numeroEnviado,
    chaveSefaz,
    fechamentoId,
    documentoId: documento && documento.id
  });

  // 2) Consultar a chave que a SEFAZ informou
  let consulta = null;
  let interpretacao;
  try {
    if (typeof deps.consultarProtocolo === 'function') {
      consulta = await deps.consultarProtocolo({ config, chave: chaveSefaz });
    } else {
      const { consultarProtocolo } = require('../fiscal/consultaProtocoloRuntime');
      const { ModelType } = require('../fiscal/core/ModelType');
      consulta = await consultarProtocolo({
        chave: chaveSefaz,
        modelo: ModelType.NFCE,
        ambiente,
        cUF: (config && (config.codigoUf || config.cUF)) || '23',
        certificadoPath: config && config.certificadoPath,
        certificadoSenha: config && config.certificadoSenha
      });
    }
    interpretacao = interpretarConsulta539(consulta);
  } catch (err) {
    interpretacao = {
      encontrado: null,
      autorizado: false,
      erro: true,
      xMotivo: err.message || String(err),
      cStat: null,
      protocolo: null,
      raw: ''
    };
  }

  // Garantir registro com chave SEFAZ (origem explícita)
  await registrarOcupado({
    cnpj: (parseChaveNfce(chaveSefaz) && parseChaveNfce(chaveSefaz).cnpj) || cnpj,
    ambiente,
    serie: (parseChaveNfce(chaveSefaz) && parseChaveNfce(chaveSefaz).serie) || serie,
    numero: (parseChaveNfce(chaveSefaz) && parseChaveNfce(chaveSefaz).numero) || numeroEnviado,
    chave: chaveSefaz,
    origem: '539-reconciliacao',
    cstat: '539',
    xmotivo: xMotivo
  });

  // Caso C — não localizado
  if (interpretacao.encontrado === false) {
    log539('RESULTADO', {
      nNF: numeroEnviado,
      chaveSefaz,
      resultado: RESULTADO.NAO_LOCALIZADO
    });
    return {
      resultado: RESULTADO.NAO_LOCALIZADO,
      statusDocumento: DOC_STATUS.REJEITADO,
      ocupacao,
      numero: numeroEnviado,
      chaveSefaz,
      cstatConsulta: interpretacao.cStat,
      mensagem:
        'Foi identificada uma numeração já existente na SEFAZ. '
        + 'O sistema reconciliou o número como ocupado; a chave informada não foi localizada na consulta. '
        + 'O número não será reutilizado.',
      reconciliacao: true,
      contabilizarValor: false
    };
  }

  // Erro de consulta
  if (interpretacao.erro) {
    log539('RESULTADO', {
      nNF: numeroEnviado,
      chaveSefaz,
      resultado: RESULTADO.ERRO_CONSULTA
    });
    return {
      resultado: RESULTADO.ERRO_CONSULTA,
      statusDocumento: DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO,
      statusFechamentoSugerido: STATUS.PENDENTE_RECUPERACAO,
      ocupacao,
      numero: numeroEnviado,
      chaveSefaz,
      mensagem:
        'Foi identificada uma numeração já existente na SEFAZ. '
        + 'O sistema está reconciliando o documento antes de continuar; a consulta falhou temporariamente.',
      reconciliacao: true,
      contabilizarValor: false
    };
  }

  // Caso A — autorizado + associação segura
  if (interpretacao.autorizado) {
    const assoc = await avaliarAssociacaoSegura({
      db,
      fechamentoId,
      documento,
      numeroEnviado,
      serieEnviada: serie,
      chaveEnviada,
      chaveSefaz,
      protocolo: interpretacao.protocolo
    });

    if (assoc.associavel && !assoc.idempotente) {
      await run(
        db,
        `UPDATE fechamentos_fiscais_documentos
         SET status = ?, cstat = ?, xmotivo = ?, protocolo = ?,
             chave_acesso = ?, xml_retorno = COALESCE(?, xml_retorno),
             data_hora_autorizacao = ?, atualizado_em = ?
         WHERE id = ?`,
        [
          DOC_STATUS.AUTORIZADO,
          interpretacao.cStat || '100',
          interpretacao.xMotivo || 'Recuperado via reconciliação CStat 539',
          interpretacao.protocolo || null,
          onlyDigits(chaveSefaz),
          interpretacao.raw || null,
          agoraLocal(),
          agoraLocal(),
          documento.id
        ]
      );

      log539('RESULTADO', {
        nNF: numeroEnviado,
        chaveSefaz,
        resultado: RESULTADO.AUTORIZADO,
        motivo: assoc.motivo
      });

      return {
        resultado: RESULTADO.AUTORIZADO,
        statusDocumento: DOC_STATUS.AUTORIZADO,
        ocupacao,
        numero: numeroEnviado,
        chaveSefaz: onlyDigits(chaveSefaz),
        protocolo: interpretacao.protocolo,
        cstatConsulta: interpretacao.cStat,
        associacao: assoc,
        mensagem:
          'Numeração reconciliada: documento autorizado localizado na SEFAZ e associado com segurança ao fechamento.',
        reconciliacao: true,
        contabilizarValor: true,
        valor: arredondarMoeda(documento.valor_total)
      };
    }

    if (assoc.idempotente) {
      log539('RESULTADO', {
        nNF: numeroEnviado,
        chaveSefaz,
        resultado: RESULTADO.AUTORIZADO,
        motivo: 'IDEMPOTENTE'
      });
      return {
        resultado: RESULTADO.AUTORIZADO,
        statusDocumento: DOC_STATUS.AUTORIZADO,
        ocupacao,
        numero: numeroEnviado,
        chaveSefaz: onlyDigits(chaveSefaz),
        protocolo: interpretacao.protocolo || assoc.protocolo,
        associacao: assoc,
        mensagem: 'Documento já autorizado (idempotente) — valor não duplicado.',
        reconciliacao: true,
        contabilizarValor: false,
        idempotente: true
      };
    }

    // Caso B — autorizado na SEFAZ mas não associável
    log539('RESULTADO', {
      nNF: numeroEnviado,
      chaveSefaz,
      resultado: RESULTADO.OCUPADO,
      motivo: assoc.motivo
    });
    return {
      resultado: RESULTADO.OCUPADO,
      statusDocumento: DOC_STATUS.REJEITADO,
      ocupacao,
      numero: numeroEnviado,
      chaveSefaz,
      protocolo: interpretacao.protocolo,
      cstatConsulta: interpretacao.cStat,
      associacao: assoc,
      mensagem:
        'Foi identificada uma numeração já existente na SEFAZ. '
        + 'O documento autorizado não pôde ser associado com segurança a este fechamento. '
        + 'Número marcado como ocupado; o valor não foi contabilizado. Use nova numeração para o saldo pendente.',
      reconciliacao: true,
      contabilizarValor: false
    };
  }

  // Existe mas não autorizado (ou situação indefinida) → OCUPADO
  log539('RESULTADO', {
    nNF: numeroEnviado,
    chaveSefaz,
    resultado: RESULTADO.OCUPADO,
    cstat: interpretacao.cStat
  });
  return {
    resultado: RESULTADO.OCUPADO,
    statusDocumento: DOC_STATUS.REJEITADO,
    ocupacao,
    numero: numeroEnviado,
    chaveSefaz,
    cstatConsulta: interpretacao.cStat,
    mensagem:
      'Foi identificada uma numeração já existente na SEFAZ. '
      + 'O sistema reconciliou o número como ocupado antes de continuar.',
    reconciliacao: true,
    contabilizarValor: false
  };
}

module.exports = {
  MAX_RECONCILIACOES_539_POR_CICLO,
  RESULTADO,
  reconciliarCstat539Documento,
  interpretarConsulta539,
  avaliarAssociacaoSegura,
  chaveJaAutorizadaNoFechamento,
  extrairChaveConflito539,
  log539
};
