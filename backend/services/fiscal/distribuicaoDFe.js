/**
 * Distribuição DF-e — SEFAZ → SOAP → Download XML → Central de Entradas.
 *
 * Sprint 4: responsabilidade exclusiva de sincronizar documentos na inbox.
 * Sprint F6: envio SOAP via Plataforma Fiscal + fallback legado.
 * NÃO cria compras, NÃO altera estoque/financeiro, NÃO chama MIIP.
 *
 * @module services/fiscal/distribuicaoDFe
 */

const { getFiscalConfig } = require('./configService');
const {
  enviarDistribuicaoDfe,
  getDfeUrl
} = require('./distribuicaoDfeRuntime');
const CentralDfePersistenciaService = require('../../motores/central-entradas/services/CentralDfePersistenciaService');
const CentralDocumentosRepository = require('../../motores/central-entradas/repositories/CentralDocumentosRepository');
const CentralNsuRepository = require('../../motores/central-entradas/repositories/CentralNsuRepository');
const CentralNsuService = require('../../motores/central-entradas/services/CentralNsuService');
const {
  NSU_ZERADO,
  normalizarNsu,
  normalizarNsuOuZero,
  nsuMenorQue,
  extrairMetadadosRetorno,
  extrairDocumentosZip,
  retornoDistSucesso,
  salvarXmlRetorno656
} = require('./dfeRetornoParser');
const { fiscalSoapTelemetry } = require('./core/FiscalSoapTelemetry');
const {
  DfeAuditoriaService,
  DfeAuditoriaResultado,
  DfeAuditoriaEtapa,
  criarCorrelationIdDfeSync
} = require('./DfeAuditoriaService');

const MAX_ITERACOES_SYNC = 50;

/**
 * @param {Object} config
 * @returns {string}
 */
function obterCodigoUf(config) {
  const codigo = config.fiscal_codigo_uf || config.codigo_uf || '23';
  return String(codigo).replace(/\D/g, '').padStart(2, '0');
}

/**
 * @param {Object} config
 * @throws {Error}
 */
function validarConfigFiscal(config) {
  if (!config.certificadoPath || !config.certificadoSenha) {
    throw new Error('Certificado não configurado');
  }

  if (!config.cnpj) {
    throw new Error('CNPJ do emitente não configurado');
  }
}

/**
 * @param {Object} params
 * @returns {string}
 */
function montarXmlDistNsu({ ambiente, codigoUf, cnpj, ultNsu }) {
  return `
<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <tpAmb>${ambiente}</tpAmb>
  <cUFAutor>${codigoUf}</cUFAutor>
  <CNPJ>${cnpj}</CNPJ>
  <distNSU>
    <ultNSU>${normalizarNsuOuZero(ultNsu)}</ultNSU>
  </distNSU>
</distDFeInt>`;
}

/**
 * @param {Object} params
 * @returns {string}
 */
function montarXmlConsChave({ ambiente, codigoUf, cnpj, chave }) {
  return `
<distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
  <tpAmb>${ambiente}</tpAmb>
  <cUFAutor>${codigoUf}</cUFAutor>
  <CNPJ>${cnpj}</CNPJ>
  <consChNFe>
    <chNFe>${String(chave).replace(/\D/g, '')}</chNFe>
  </consChNFe>
</distDFeInt>`;
}

/**
 * Envia consulta DF-e via Plataforma Fiscal (F6) com fallback legado.
 * Retorna body + metadados de telemetria (RC6.6) sem alterar o SOAP.
 *
 * @param {string} xmlConsulta
 * @param {Object} config
 * @param {number} ambiente
 * @param {Object} [deps]
 * @returns {Promise<{ body: string, requestId: string|null, correlationId: string|null, tempoResolverMs: number, tempoXmlMs: number, tempoTransporteMs: number, tempoTotalMs: number, endpoint: string|null, fallbackUtilizado: boolean, httpStatus: number|null }>}
 */
async function executarEnvioConsultaDfe(xmlConsulta, config, ambiente, deps = {}) {
  const runtimeSend = deps.enviarDistribuicaoDfe || enviarDistribuicaoDfe;
  const resultado = await runtimeSend({
    xmlConsulta,
    ambiente,
    cUF: obterCodigoUf(config),
    certificadoPath: config.certificadoPath,
    certificadoSenha: config.certificadoSenha,
    versao: '1.01',
    legadoHttpClient: deps.legadoHttpClient || null,
    correlationId: deps.correlationId || null
  });

  const requestId = resultado.telemetryRequestId || null;

  if (!resultado.success || resultado.body == null) {
    if (requestId) {
      fiscalSoapTelemetry.finalizar(requestId, {
        sucesso: false,
        resultado: 'ERRO',
        tempoResolverMs: resultado.tempoResolverMs,
        tempoXmlMs: resultado.tempoXmlMs,
        tempoTransporteMs: resultado.tempoTransporteMs,
        tempoTotalMs: resultado.tempoTotalMs,
        fallbackUtilizado: resultado.fallbackUtilizado,
        endpoint: resultado.endpoint
      });
    }
    throw new Error(resultado.error || 'Falha na Distribuição DF-e (plataforma/legado).');
  }

  return {
    body: resultado.body,
    requestId,
    correlationId: resultado.correlationId || null,
    tempoResolverMs: resultado.tempoResolverMs,
    tempoXmlMs: resultado.tempoXmlMs,
    tempoTransporteMs: resultado.tempoTransporteMs,
    tempoTotalMs: resultado.tempoTotalMs,
    endpoint: resultado.endpoint || null,
    fallbackUtilizado: Boolean(resultado.fallbackUtilizado),
    httpStatus: resultado.statusCode != null ? resultado.statusCode : null
  };
}

/**
 * Compatibilidade: retorna apenas o XML de retorno.
 *
 * @param {string} xmlConsulta
 * @param {Object} config
 * @param {number} ambiente
 * @param {Object} [deps]
 * @returns {Promise<string>}
 */
async function enviarConsultaDfe(xmlConsulta, config, ambiente, deps = {}) {
  const envio = await executarEnvioConsultaDfe(xmlConsulta, config, ambiente, deps);
  if (envio.requestId) {
    fiscalSoapTelemetry.finalizar(envio.requestId, {
      sucesso: true,
      xmlRetorno: envio.body,
      tempoResolverMs: envio.tempoResolverMs,
      tempoXmlMs: envio.tempoXmlMs,
      tempoTransporteMs: envio.tempoTransporteMs,
      tempoTotalMs: envio.tempoTotalMs,
      fallbackUtilizado: envio.fallbackUtilizado,
      endpoint: envio.endpoint,
      resultado: 'OK'
    });
  }
  return envio.body;
}

/**
 * Finaliza telemetria SOAP após parse/persistência (observe-only).
 * @param {object|null} envio
 * @param {object} [extra]
 */
function finalizarTelemetriaEnvio(envio, extra = {}) {
  if (!envio || !envio.requestId) return;
  fiscalSoapTelemetry.finalizar(envio.requestId, {
    sucesso: extra.sucesso !== false,
    xmlRetorno: envio.body,
    persistidos: extra.persistidos,
    duplicados: extra.duplicados,
    descartados: extra.descartados,
    cStat: extra.cStat,
    xMotivo: extra.xMotivo,
    ultNSU: extra.ultNSU,
    maxNSU: extra.maxNSU,
    tempoResolverMs: envio.tempoResolverMs,
    tempoXmlMs: envio.tempoXmlMs,
    tempoTransporteMs: envio.tempoTransporteMs,
    tempoTotalMs: envio.tempoTotalMs,
    fallbackUtilizado: envio.fallbackUtilizado,
    endpoint: envio.endpoint,
    resultado: extra.resultado || (extra.sucesso === false ? 'ERRO' : 'OK')
  });
}

/**
 * @param {string} xmlRetorno
 * @param {CentralDfePersistenciaService} persistencia
 * @param {string} origem
 * @param {Object} [ctxAudit]
 * @returns {Promise<{ notasNovas: number, notasDuplicadas: number, ignorados: number, atualizados: number, eventos: number, errosZip: number, errosSchema: number, recebidosZip: number }>}
 */
async function persistirDocumentosRetorno(xmlRetorno, persistencia, origem, ctxAudit = null) {
  const auditoria = ctxAudit?.auditoria || null;
  const correlationId = ctxAudit?.correlationId || null;
  const cnpj = ctxAudit?.cnpj || null;
  const ambiente = ctxAudit?.ambiente != null ? ctxAudit.ambiente : null;

  let eventos = 0;
  let errosZip = 0;
  let errosSchema = 0;
  let recebidosZip = 0;
  const descartes = [];

  const documentos = extrairDocumentosZip(xmlRetorno, {
    onDescarte: (evt) => {
      descartes.push(evt);
    }
  });

  for (const evt of descartes) {
    recebidosZip += 1;
    if (evt.resultado === 'EVENTO') eventos += 1;
    else if (evt.resultado === 'ERRO_ZIP') errosZip += 1;
    else errosSchema += 1;

    // RC3.7.1 — evento 110111/110112 aplica CANCELADA no documento da chave
    if (evt.resultado === 'EVENTO' && evt.xml && typeof persistencia.aplicarEventoDfe === 'function') {
      try {
        const aplicado = await persistencia.aplicarEventoDfe({
          xml: evt.xml,
          nsu: evt.nsu,
          chave: evt.chave,
          origem
        });
        if (aplicado?.aplicado && auditoria) {
          await auditoria.registrar({
            correlation_id: correlationId,
            cnpj,
            ambiente,
            nsu: evt.nsu,
            tipo: 'EVENTO',
            schema: evt.schema,
            chave: evt.chave || aplicado.chave,
            resultado: aplicado.status || 'CANCELADA',
            motivo: aplicado.documento?.statusDetalhe || 'Evento fiscal aplicado',
            tempo_ms: evt.tempoMs
          });
        }
      } catch (errEvt) {
        console.warn('[DFE] falha ao aplicar evento:', errEvt.message);
      }
    }

    if (auditoria) {
      await auditoria.registrar({
        correlation_id: correlationId,
        cnpj,
        ambiente,
        nsu: evt.nsu,
        tipo: evt.tipo || DfeAuditoriaEtapa.ZIP,
        schema: evt.schema,
        chave: evt.chave || null,
        resultado: evt.resultado,
        motivo: evt.motivo,
        tempo_ms: evt.tempoMs,
        detalhe: { tamanhoZip: evt.tamanhoZip }
      });
    }
  }

  let notasNovas = 0;
  let notasDuplicadas = 0;
  let ignorados = 0;
  let atualizados = 0;

  for (const doc of documentos) {
    recebidosZip += 1;
    const tParser = Date.now();

    if (auditoria) {
      await auditoria.registrar({
        correlation_id: correlationId,
        cnpj,
        ambiente,
        nsu: doc.nsu,
        tipo: DfeAuditoriaEtapa.ZIP,
        schema: doc.schema,
        resultado: 'PROCESSADO',
        motivo: `ZIP OK · ${doc.tamanhoZip || 0} bytes · descompactado`,
        tempo_ms: doc.tempoZipMs,
        detalhe: { tamanhoZip: doc.tamanhoZip, tipoAuditoria: doc.tipoAuditoria }
      });
      await auditoria.registrar({
        correlation_id: correlationId,
        cnpj,
        ambiente,
        nsu: doc.nsu,
        tipo: DfeAuditoriaEtapa.PARSER,
        schema: doc.schema,
        resultado: 'PROCESSADO',
        motivo: `Parser=${doc.tipoAuditoria || 'NF'} Resultado=OK`,
        tempo_ms: Date.now() - tParser,
        detalhe: { parser: doc.tipoAuditoria }
      });
    }

    let resultado;
    const tPers = Date.now();
    try {
      resultado = await persistencia.persistirDocumentoDfe({
        xml: doc.xml,
        nsu: doc.nsu,
        origem
      });
    } catch (err) {
      ignorados += 1;
      if (auditoria) {
        await auditoria.registrar({
          correlation_id: correlationId,
          cnpj,
          ambiente,
          nsu: doc.nsu,
          tipo: DfeAuditoriaEtapa.PERSISTENCIA,
          schema: doc.schema,
          resultado: DfeAuditoriaResultado.ERRO_BANCO,
          motivo: err.message || 'Erro ao persistir',
          tempo_ms: Date.now() - tPers
        });
      }
      continue;
    }

    if (resultado.novo) notasNovas += 1;
    else if (resultado.duplicado) notasDuplicadas += 1;
    else if (resultado.atualizado) atualizados += 1;
    else if (resultado.ignorado) ignorados += 1;

    if (auditoria) {
      let resCode = DfeAuditoriaResultado.PROCESSADO;
      if (resultado.duplicado) resCode = DfeAuditoriaResultado.DUPLICADO;
      else if (resultado.ignorado) resCode = DfeAuditoriaResultado.IGNORADO;
      else if (resultado.atualizado) resCode = DfeAuditoriaResultado.XML_COMPLETO;
      else if (resultado.tipoDfe === 'RES_NFE' || doc.tipoAuditoria === 'RES_NFE') {
        resCode = DfeAuditoriaResultado.RESUMO;
      } else if (resultado.novo) {
        resCode = DfeAuditoriaResultado.XML_COMPLETO;
      }

      await auditoria.registrar({
        correlation_id: correlationId,
        cnpj,
        ambiente,
        nsu: doc.nsu,
        tipo: DfeAuditoriaEtapa.PERSISTENCIA,
        schema: doc.schema,
        chave: resultado.documento?.chave || null,
        resultado: resCode,
        motivo: resultado.motivo
          || (resultado.novo ? 'INSERT' : resultado.atualizado ? 'UPDATE XML' : resultado.duplicado ? 'DUPLICADO' : 'SKIP'),
        tempo_ms: Date.now() - tPers,
        detalhe: {
          novo: !!resultado.novo,
          duplicado: !!resultado.duplicado,
          atualizado: !!resultado.atualizado,
          ignorado: !!resultado.ignorado,
          tipoDfe: resultado.tipoDfe || null,
          documentoId: resultado.documento?.id || null
        }
      });
    }
  }

  return {
    notasNovas,
    notasDuplicadas,
    ignorados,
    atualizados,
    eventos,
    errosZip,
    errosSchema,
    recebidosZip
  };
}

/**
 * @param {Object} [deps]
 * @returns {Promise<Object>}
 */
async function sincronizarDistribuicaoDFe(deps = {}) {
  let config;
  let ambiente;

  if (deps.contextoCentral) {
    const ctx = deps.contextoCentral;
    config = {
      certificadoPath: ctx.certificadoPath,
      certificadoSenha: ctx.certificadoSenha,
      cnpj: ctx.cnpj,
      fiscal_codigo_uf: ctx.codigoUf,
      codigo_uf: ctx.codigoUf,
      ambiente: ctx.ambiente,
      fiscal_ambiente: ctx.ambiente
    };
    ambiente = Number(ctx.ambiente) === 1 ? 1 : 2;
  } else {
    // DF-e não depende de URL de autorização NFC-e
    config = await getFiscalConfig({ validarUrls: false });
    ambiente = Number(config.fiscal_ambiente || config.ambiente || 2);
  }

  validarConfigFiscal(config);
  const cnpj = String(config.cnpj).replace(/\D/g, '');
  const codigoUf = obterCodigoUf(config);

  const nsuRepository = deps.nsuRepository ?? new CentralNsuRepository();
  const nsuService = deps.nsuService
    ?? new CentralNsuService({ nsuRepository });
  const persistencia = deps.persistenciaService ?? new CentralDfePersistenciaService();
  const auditoria = deps.auditoriaService ?? new DfeAuditoriaService();
  const correlationId = criarCorrelationIdDfeSync();
  const syncInicio = Date.now();
  const parentCorrelationId = deps.correlationId || null;

  let controleNsu = await nsuService.obterOuCriar(cnpj, ambiente);
  let ultNsuAtual = normalizarNsuOuZero(controleNsu.ultNsu);
  let maxNsuAtual = normalizarNsuOuZero(controleNsu.maxNsu);

  let notasNovasTotal = 0;
  let notasDuplicadasTotal = 0;
  let ignoradosTotal = 0;
  let atualizadosTotal = 0;
  let eventosTotal = 0;
  let errosZipTotal = 0;
  let errosSchemaTotal = 0;
  let recebidosZipTotal = 0;
  let iteracoes = 0;
  let ultimoRetorno = null;

  console.log(`[DFE][SYNC] ${correlationId} | CNPJ=${cnpj} | ambiente=${ambiente} | ultNSU=${ultNsuAtual}`);

  while (iteracoes < (deps.maxIteracoes ?? MAX_ITERACOES_SYNC)) {
    iteracoes += 1;

    const xmlConsulta = montarXmlDistNsu({
      ambiente,
      codigoUf,
      cnpj,
      ultNsu: ultNsuAtual
    });

    const tConsulta = Date.now();
    const envio = await executarEnvioConsultaDfe(xmlConsulta, config, ambiente, deps);
    let ultimoRetornoIter = null;
    try {
      ultimoRetornoIter = extrairMetadadosRetorno(envio.body);
      ultimoRetorno = ultimoRetornoIter;
      const tempoConsulta = Date.now() - tConsulta;
      const lotesEstimados = (String(envio.body || '').match(/<docZip/gi) || []).length;

      await auditoria.registrarConsulta({
        correlation_id: correlationId,
        cnpj,
        ambiente,
        empresa: cnpj,
        ultNsuEnviado: ultNsuAtual,
        ultNsuRecebido: ultimoRetorno.ultNSU,
        maxNsuRecebido: ultimoRetorno.maxNSU,
        cStat: ultimoRetorno.cStat,
        xMotivo: ultimoRetorno.xMotivo,
        lotes: lotesEstimados,
        tempoMs: tempoConsulta,
        motivo: `ultNSU=${ultNsuAtual} maxNSU=${ultimoRetorno.maxNSU} cStat=${ultimoRetorno.cStat} lotes=${lotesEstimados} tempo=${tempoConsulta}ms`,
        detalhe: parentCorrelationId ? { parentCorrelationId } : undefined
      });

      console.log(
        `[DFE][SYNC] ${correlationId} | ultNSU=${ultNsuAtual} maxNSU=${ultimoRetorno.maxNSU}`
        + ` cStat=${ultimoRetorno.cStat} lotes=${lotesEstimados} tempo=${tempoConsulta}ms`
      );

      if (!retornoDistSucesso(ultimoRetorno.cStat)) {
        finalizarTelemetriaEnvio(envio, {
          sucesso: false,
          cStat: ultimoRetorno.cStat,
          xMotivo: ultimoRetorno.xMotivo,
          ultNSU: ultimoRetorno.ultNSU,
          maxNSU: ultimoRetorno.maxNSU,
          resultado: 'ERRO'
        });
        throw new Error(
          ultimoRetorno.xMotivo
            || `SEFAZ retornou cStat ${ultimoRetorno.cStat || 'desconhecido'}`
        );
      }

      // cStat 656: cooldown obrigatório; RC3.7.5.1 pode recuperar cursor se SEFAZ > local.
      if (String(ultimoRetorno.cStat) === '656') {
        const xmlPath656 = salvarXmlRetorno656(envio.body, { correlationId });
        if (xmlPath656) {
          console.log(`[DFE][SYNC] ${correlationId} | XML 656 salvo: ${xmlPath656}`);
        }
        const nsuLocalAntes = normalizarNsuOuZero(controleNsu.ultNsu);
        const aplicado = await nsuService.aplicarRetornoDistDfe({
          controle: controleNsu,
          cStat: '656',
          xmlRetorno: envio.body,
          ultNsu: ultimoRetorno.ultNSU,
          maxNsu: ultimoRetorno.maxNSU,
          correlationId,
          cnpj,
          empresa: cnpj
        });
        controleNsu = aplicado.controle;
        ultNsuAtual = normalizarNsuOuZero(aplicado.ultNsu);
        maxNsuAtual = normalizarNsuOuZero(aplicado.maxNsu);
        const recuperouNsu = Boolean(aplicado.atualizouNsu);
        await auditoria.registrarNsuAvanco({
          correlation_id: correlationId,
          cnpj,
          ambiente,
          nsu: ultNsuAtual,
          avancou: recuperouNsu,
          motivo: recuperouNsu
            ? 'cStat 656 — Cursor NSU sincronizado automaticamente (AUTO_SYNC_NSU)'
            : 'cStat 656 — Cursor atualizado=FALSE (NSU preservado)',
          cStat: '656',
          ultNsuAnterior: aplicado.recuperacaoNsu?.nsuLocal || nsuLocalAntes,
          ultNsuNovo: ultNsuAtual,
          maxNsu: maxNsuAtual
        });
        finalizarTelemetriaEnvio(envio, {
          sucesso: false,
          cStat: '656',
          xMotivo: ultimoRetorno.xMotivo,
          ultNSU: ultimoRetorno.ultNSU,
          maxNSU: ultimoRetorno.maxNSU,
          persistidos: 0,
          duplicados: 0,
          descartados: 0,
          resultado: 'CONSUMO_INDEVIDO'
        });
        await auditoria.registrarResumoSync({
          correlation_id: correlationId,
          cnpj,
          ambiente,
          recebidos: 0,
          processados: 0,
          atualizados: recuperouNsu ? 1 : 0,
          duplicados: 0,
          eventos: 0,
          xml: 0,
          resumo: 0,
          erros: 1,
          tempoTotalMs: Date.now() - syncInicio,
          ultNsu: ultNsuAtual,
          maxNsu: maxNsuAtual,
          cStat: '656',
          motivo: recuperouNsu ? 'CONSUMO_INDEVIDO_NSU_RECUPERADO' : 'CONSUMO_INDEVIDO'
        });
        return {
          sucesso: false,
          codigo: 'CONSUMO_INDEVIDO',
          notasNovas: notasNovasTotal,
          notasDuplicadas: notasDuplicadasTotal,
          ignorados: ignoradosTotal,
          ultNsu: ultNsuAtual,
          maxNsu: maxNsuAtual,
          iteracoes,
          cStat: '656',
          correlationId,
          nsuRecuperado: recuperouNsu,
          proximaConsultaEm: aplicado.proximaConsultaEm,
          mensagem: recuperouNsu
            ? (ultimoRetorno.xMotivo
              || 'Consumo indevido (cStat 656) — cursor NSU sincronizado automaticamente; nova consulta após cooldown.')
            : (ultimoRetorno.xMotivo
              || 'Consumo indevido (cStat 656) — NSU preservado; nova consulta após 1 hora.'),
          ultimaSincronizacao: controleNsu.dataSincronizacao || controleNsu.updatedAt
        };
      }

      const persistidos = await persistirDocumentosRetorno(envio.body, persistencia, 'dfe', {
        auditoria,
        correlationId,
        cnpj,
        ambiente
      });
      notasNovasTotal += persistidos.notasNovas;
      notasDuplicadasTotal += persistidos.notasDuplicadas;
      ignoradosTotal += persistidos.ignorados;
      atualizadosTotal += persistidos.atualizados || 0;
      eventosTotal += persistidos.eventos || 0;
      errosZipTotal += persistidos.errosZip || 0;
      errosSchemaTotal += persistidos.errosSchema || 0;
      recebidosZipTotal += persistidos.recebidosZip || 0;

      finalizarTelemetriaEnvio(envio, {
        sucesso: true,
        cStat: ultimoRetorno.cStat,
        xMotivo: ultimoRetorno.xMotivo,
        ultNSU: ultimoRetorno.ultNSU,
        maxNSU: ultimoRetorno.maxNSU,
        persistidos: persistidos.notasNovas,
        duplicados: persistidos.notasDuplicadas,
        descartados: persistidos.ignorados,
        resultado: 'OK'
      });

      const ultAntes = ultNsuAtual;
      const aplicado = await nsuService.aplicarRetornoDistDfe({
        controle: controleNsu,
        cStat: ultimoRetorno.cStat,
        xmlRetorno: envio.body,
        ultNsu: ultimoRetorno.ultNSU,
        maxNsu: ultimoRetorno.maxNSU,
        correlationId
      });
      controleNsu = aplicado.controle;
      ultNsuAtual = normalizarNsuOuZero(aplicado.ultNsu);
      maxNsuAtual = normalizarNsuOuZero(aplicado.maxNsu);

      await auditoria.registrarNsuAvanco({
        correlation_id: correlationId,
        cnpj,
        ambiente,
        nsu: ultNsuAtual,
        avancou: !!aplicado.atualizouNsu,
        motivo: aplicado.atualizouNsu
          ? `Cursor atualizado=TRUE (${ultAntes} → ${ultNsuAtual})`
          : `Cursor atualizado=FALSE (${aplicado.preservado ? 'preservado' : 'sem avanço'})`,
        cStat: ultimoRetorno.cStat,
        ultNsuAnterior: ultAntes,
        ultNsuNovo: ultNsuAtual,
        maxNsu: maxNsuAtual
      });

      if (!nsuMenorQue(ultNsuAtual, maxNsuAtual)) {
        break;
      }
    } catch (erro) {
      finalizarTelemetriaEnvio(envio, {
        sucesso: false,
        cStat: ultimoRetornoIter?.cStat,
        xMotivo: ultimoRetornoIter?.xMotivo || erro.message,
        resultado: 'ERRO'
      });
      await auditoria.registrar({
        correlation_id: correlationId,
        cnpj,
        ambiente,
        tipo: DfeAuditoriaEtapa.SYNC,
        resultado: DfeAuditoriaResultado.ERRO_PARSER,
        motivo: erro.message || 'Erro na sincronização DistDFe',
        tempo_ms: Date.now() - syncInicio
      });
      throw erro;
    }
  }

  const tempoTotal = Date.now() - syncInicio;
  await auditoria.registrarResumoSync({
    correlation_id: correlationId,
    cnpj,
    ambiente,
    recebidos: recebidosZipTotal,
    processados: notasNovasTotal + atualizadosTotal,
    atualizados: atualizadosTotal,
    duplicados: notasDuplicadasTotal,
    eventos: eventosTotal,
    xml: notasNovasTotal + atualizadosTotal,
    resumo: 0,
    erros: ignoradosTotal + errosZipTotal + errosSchemaTotal,
    tempoTotalMs: tempoTotal,
    ultNsu: ultNsuAtual,
    maxNsu: maxNsuAtual,
    cStat: ultimoRetorno?.cStat || '138',
    motivo: `recebidos=${recebidosZipTotal} processados=${notasNovasTotal} atualizados=${atualizadosTotal} duplicados=${notasDuplicadasTotal} eventos=${eventosTotal} erros=${ignoradosTotal + errosZipTotal + errosSchemaTotal} tempo=${tempoTotal}ms`
  });

  console.log(
    `[DFE][SYNC] ${correlationId} | FIM | novas=${notasNovasTotal} dup=${notasDuplicadasTotal}`
    + ` ign=${ignoradosTotal} eventos=${eventosTotal} tempo=${tempoTotal}ms`
  );

  return {
    sucesso: true,
    notasNovas: notasNovasTotal,
    notasDuplicadas: notasDuplicadasTotal,
    ignorados: ignoradosTotal,
    atualizados: atualizadosTotal,
    ultNsu: ultNsuAtual,
    maxNsu: maxNsuAtual,
    iteracoes,
    cStat: ultimoRetorno?.cStat || '138',
    correlationId,
    mensagem: notasNovasTotal > 0
      ? `${notasNovasTotal} nova(s) nota(s) sincronizada(s)`
      : 'Sincronização concluída — nenhuma nota nova',
    ultimaSincronizacao: controleNsu.dataSincronizacao || controleNsu.updatedAt
  };
}

/**
 * Compatibilidade legada — delega à sincronização oficial.
 *
 * @deprecated RC1 — Use POST /api/central-entradas/sincronizar
 * @returns {Promise<Object>}
 */
async function distribuirDocumentosRecebidos() {
  const resultado = await sincronizarDistribuicaoDFe();
  return {
    sucesso: resultado.sucesso,
    notasNovas: resultado.notasNovas,
    mensagem: resultado.mensagem,
    ultNsu: resultado.ultNsu,
    maxNsu: resultado.maxNsu
  };
}

/**
 * @param {string} chave
 * @param {Object} [deps]
 * @returns {Promise<Object>}
 */
async function consultarNotaPorChave(chave, deps = {}) {
  let config;
  let ambiente;

  if (deps.contextoCentral) {
    const ctx = deps.contextoCentral;
    config = {
      certificadoPath: ctx.certificadoPath,
      certificadoSenha: ctx.certificadoSenha,
      cnpj: ctx.cnpj,
      fiscal_codigo_uf: ctx.codigoUf,
      codigo_uf: ctx.codigoUf,
      ambiente: ctx.ambiente,
      fiscal_ambiente: ctx.ambiente
    };
    ambiente = Number(ctx.ambiente) === 1 ? 1 : 2;
  } else {
    config = await getFiscalConfig({ validarUrls: false });
    ambiente = Number(config.fiscal_ambiente || config.ambiente || 2);
  }

  validarConfigFiscal(config);

  const chaveLimpa = String(chave || '').replace(/\D/g, '');
  if (chaveLimpa.length !== 44) {
    throw new Error('Chave deve conter 44 dígitos');
  }

  const cnpj = String(config.cnpj).replace(/\D/g, '');
  const codigoUf = obterCodigoUf(config);
  const persistencia = deps.persistenciaService ?? new CentralDfePersistenciaService();

  const xmlConsulta = montarXmlConsChave({
    ambiente,
    codigoUf,
    cnpj,
    chave: chaveLimpa
  });

  const envio = await executarEnvioConsultaDfe(xmlConsulta, config, ambiente, deps);
  try {
    const metadados = extrairMetadadosRetorno(envio.body);

    if (!retornoDistSucesso(metadados.cStat) && metadados.cStat !== '138') {
      finalizarTelemetriaEnvio(envio, {
        sucesso: false,
        cStat: metadados.cStat,
        xMotivo: metadados.xMotivo,
        resultado: 'ERRO'
      });
      throw new Error(metadados.xMotivo || `SEFAZ retornou cStat ${metadados.cStat}`);
    }

    const persistidos = await persistirDocumentosRetorno(envio.body, persistencia, 'consulta_chave');

    finalizarTelemetriaEnvio(envio, {
      sucesso: true,
      cStat: metadados.cStat,
      xMotivo: metadados.xMotivo,
      persistidos: persistidos.notasNovas,
      duplicados: persistidos.notasDuplicadas,
      descartados: persistidos.ignorados,
      resultado: 'OK'
    });

    return {
      sucesso: true,
      chave: chaveLimpa,
      cStat: metadados.cStat,
      mensagem: metadados.xMotivo,
      notasNovas: persistidos.notasNovas,
      notasDuplicadas: persistidos.notasDuplicadas,
      ignorados: persistidos.ignorados
    };
  } catch (erro) {
    finalizarTelemetriaEnvio(envio, {
      sucesso: false,
      xMotivo: erro.message,
      resultado: 'ERRO'
    });
    throw erro;
  }
}

/**
 * Lista documentos da Central (compatibilidade legada /api/dfe/consultar-notas).
 *
 * @deprecated RC1 — Use GET /api/central-entradas/documentos
 * @returns {Promise<Object>}
 */
async function consultarNotasRecebidas() {
  const repository = new CentralDocumentosRepository();
  const documentos = await repository.listar({ limite: 200, ordenarPor: 'created_at', ordenarDirecao: 'DESC' });

  return {
    sucesso: true,
    mensagem: 'Notas da Central Inteligente de Entradas',
    notas: documentos.map((doc) => ({
      id: doc.id,
      chave: doc.chave,
      numero: doc.numero,
      serie: doc.serie,
      fornecedor: doc.fornecedor,
      cnpj_fornecedor: doc.cnpjFornecedor,
      data_emissao: doc.dataEmissao,
      valor_total: doc.valorTotal,
      status: doc.status,
      origem: doc.origem,
      nsu: doc.nsu,
      created_at: doc.createdAt
    }))
  };
}

module.exports = {
  sincronizarDistribuicaoDFe,
  distribuirDocumentosRecebidos,
  consultarNotaPorChave,
  consultarNotasRecebidas,
  getDfeUrl,
  montarXmlDistNsu,
  montarXmlConsChave,
  extrairMetadadosRetorno,
  extrairDocumentosZip,
  persistirDocumentosRetorno,
  enviarConsultaDfe
};
