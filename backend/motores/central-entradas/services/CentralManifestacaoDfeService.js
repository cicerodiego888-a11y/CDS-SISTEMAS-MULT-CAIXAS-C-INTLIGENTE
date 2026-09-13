/**
 * CentralManifestacaoDfeService — Orquestra o fechamento RES_NFE → PROC_NFE.
 *
 * Reutiliza exclusivamente a Plataforma Fiscal existente:
 * manifestacaoRuntime + Registry + Resolver + SoapTransport + distribuicaoDFe.
 * Não implementa transporte SOAP, parser fiscal, MIIP ou promoção de documento.
 */

const { DocumentoFiscalStatus, isTerminal } = require('../core/DocumentoFiscalStatus');
const { DocumentoDfeTipo } = require('../core/DocumentoDfeTipo');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const CentralHistoricoRepository = require('../repositories/CentralHistoricoRepository');
const CentralEventosRepository = require('../repositories/CentralEventosRepository');
const CentralConfiguracaoService = require('./CentralConfiguracaoService');
const DocumentoTransitionService = require('./DocumentoTransitionService');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { logCentral, logCentralErro } = require('../utils/centralLog');
const { OperationType } = require('../../../services/fiscal/core/OperationType');
const {
  enviarManifestacao,
  montarEnvelopeManifestacao
} = require('../../../services/fiscal/manifestacaoRuntime');
const { sincronizarDistribuicaoDFe, consultarNotaPorChave } = require('../../../services/fiscal/distribuicaoDFe');
const { carregarCertificadoPfx } = require('../../../services/fiscal/certificateService');
const { assinarEvento } = require('../../../services/fiscal/signer');
const CentralNsuRepository = require('../repositories/CentralNsuRepository');
const CentralNsuService = require('./CentralNsuService');
const { criarCorrelationId, logOperacaoCentral } = require('../utils/centralOperacaoLog');
const { ResolutionSource } = require('../../../services/fiscal/core/ResolutionSource');

/**
 * Exceção documentada RC3.3.3:
 * A Plataforma Fiscal ainda possui fallback legado interno (manifestacaoLegado).
 * A Central NÃO aceita esse ramo — exige source PLATFORM e fallbackUtilizado=false.
 */

const POLITICAS_MANIFESTACAO = Object.freeze({
  MANUAL: 'MANUAL',
  AUTOMATICA_CIENCIA: 'AUTOMATICA_CIENCIA',
  CONFIRMAR_OPERADOR: 'CONFIRMAR_OPERADOR'
});

const CSTAT_MANIFESTACAO_ACEITA = new Set(['135', '573']);
/** RC7.4.7 — SEFAZ: evento após o prazo; XML completo nunca será disponibilizado. */
const CSTAT_XML_INDISPONIVEL = new Set(['596']);
const MENSAGEM_XML_INDISPONIVEL =
  'XML completo indisponível: evento apresentado após o prazo permitido pela SEFAZ.';
const INTERVALO_SEGURO_MS = 60 * 60 * 1000;
const LIMITE_CANDIDATOS_PADRAO = 10;
const MENSAGEM_AGUARDANDO_XML =
  'Aguardando disponibilização do XML completo pela SEFAZ.';

function decodificarEntidadesXml(texto) {
  return String(texto || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extrairTag(xml, tag) {
  const regex = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`, 'i');
  return String(xml || '').match(regex)?.[1]?.trim() || null;
}

function extrairRetornoManifestacao(body) {
  const xml = decodificarEntidadesXml(body);
  const blocoRetEvento = xml.match(
    /<(?:[\w.-]+:)?retEvento(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?retEvento>/i
  )?.[0] || xml;
  const blocoInfEvento = blocoRetEvento.match(
    /<(?:[\w.-]+:)?infEvento(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?infEvento>/i
  )?.[0] || blocoRetEvento;

  const cStat = extrairTag(blocoInfEvento, 'cStat');
  return {
    cStat,
    xMotivo: extrairTag(blocoInfEvento, 'xMotivo'),
    protocolo: extrairTag(blocoInfEvento, 'nProt'),
    dataRegistro: extrairTag(blocoInfEvento, 'dhRegEvento'),
    aceita: CSTAT_MANIFESTACAO_ACEITA.has(String(cStat || '')),
    duplicada: String(cStat || '') === '573'
  };
}

function formatarDhEventoBrasil(data = new Date()) {
  const offsetMin = -data.getTimezoneOffset();
  const sinal = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
  return `${local}${sinal}${hh}:${mm}`;
}

function ajustarEventoManifestacaoDestinatario(eventoXml, params = {}) {
  let evento = String(eventoXml || '');
  // Manifestação do destinatário: cOrgao=91 (Ambiente Nacional) — NT 2020.001 P08.
  evento = evento.replace(
    /(<cOrgao>)[^<]*(<\/cOrgao>)/i,
    `$1${params.cOrgao || '91'}$2`
  );
  const dhEvento = params.dhEvento || formatarDhEventoBrasil();
  evento = evento.replace(
    /(<dhEvento>)[^<]*(<\/dhEvento>)/i,
    `$1${dhEvento}$2`
  );
  return evento;
}

function prepararEnvelopeAssinado(params, deps = {}) {
  const montarEnvelope = deps.montarEnvelopeManifestacao || montarEnvelopeManifestacao;
  const carregarCertificado = deps.carregarCertificado || carregarCertificadoPfx;
  const assinar = deps.assinarEvento || assinarEvento;
  const envelope = montarEnvelope({
    ...params,
    cOrgao: params.cOrgao || '91',
    dhEvento: params.dhEvento || formatarDhEventoBrasil()
  });
  const evento = String(envelope).match(
    /<(?:[\w.-]+:)?evento(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?evento>/i
  )?.[0];

  if (!evento) {
    throw new Error('Evento de manifestação não encontrado no envelope da Plataforma Fiscal.');
  }

  const eventoAjustado = ajustarEventoManifestacaoDestinatario(evento, {
    cOrgao: '91',
    dhEvento: params.dhEvento || formatarDhEventoBrasil()
  });
  const certificado = carregarCertificado(params.certificadoPath, params.certificadoSenha);
  const assinatura = assinar(eventoAjustado, certificado.privateKeyPem, certificado.certPem);
  if (!assinatura?.xmlAssinado) {
    throw new Error('Assinatura da Ciência da Emissão não foi gerada.');
  }

  return String(envelope).replace(evento, assinatura.xmlAssinado);
}

class CentralManifestacaoDfeService {
  constructor(deps = {}) {
    const repoDeps = { db: deps.db ?? null };
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository(repoDeps);
    this._historicoRepository = deps.historicoRepository
      ?? new CentralHistoricoRepository(repoDeps);
    this._eventosRepository = deps.eventosRepository
      ?? new CentralEventosRepository(repoDeps);
    this._configuracao = deps.configuracaoService
      ?? new CentralConfiguracaoService({ configuracaoRepository: deps.configuracaoRepository });
    this._enviarManifestacao = deps.enviarManifestacao || enviarManifestacao;
    this._sincronizarDfe = deps.sincronizarDfe || sincronizarDistribuicaoDFe;
    this._consultarNotaPorChave = deps.consultarNotaPorChave || consultarNotaPorChave;
    this._nsuRepository = deps.nsuRepository
      ?? new CentralNsuRepository(repoDeps);
    this._nsuService = deps.nsuService
      ?? new CentralNsuService({ nsuRepository: this._nsuRepository });
    this._syncExecucao = deps.syncExecucao || null;
    this._emitirEvento = deps.emitirEvento || emitirEvento;
    this._prepararEnvelopeAssinado = deps.prepararEnvelopeAssinado || prepararEnvelopeAssinado;
    this._transitionService = deps.transitionService
      ?? new DocumentoTransitionService({
        documentosRepository: this._documentosRepository,
        historicoRepository: this._historicoRepository
      });
    this._cancelarXmlWait = deps.cancelarXmlWait || ((documentoId, motivo) => {
      try {
        require('./CentralXmlWaitScheduler').cancelar(documentoId, motivo || 'xml_indisponivel');
      } catch { /* scheduler opcional em testes */ }
    });
    this._agora = deps.agora || (() => new Date());
    this._emExecucao = new Set();
  }

  async processarCandidatos(opcoes = {}) {
    const politica = opcoes.politica
      || await this._configuracao.obterPoliticaManifestacao();
    const automatico = politica === POLITICAS_MANIFESTACAO.AUTOMATICA_CIENCIA;

    if (!automatico) {
      return {
        politica,
        executado: false,
        candidatos: 0,
        resultados: [],
        mensagem: politica === POLITICAS_MANIFESTACAO.CONFIRMAR_OPERADOR
          ? 'Documentos aguardam confirmação do operador.'
          : 'Manifestação automática desabilitada (modo manual).'
      };
    }

    const limite = Math.max(
      1,
      Math.min(Number(opcoes.limite) || LIMITE_CANDIDATOS_PADRAO, 50)
    );
    const aguardando = await this._documentosRepository.listarPorStatus(
      DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO,
      limite
    );
    const candidatos = aguardando.filter(
      (doc) => doc.tipoDocumento === DocumentoDfeTipo.RES_NFE
    );
    const resultados = [];

    for (const documento of candidatos) {
      try {
        // Execução serial deliberada: evita rajada de eventos/consultas à SEFAZ.
        // eslint-disable-next-line no-await-in-loop
        resultados.push(await this.processarDocumento(documento.id, {
          ...opcoes,
          politica,
          automatico: true,
          // DistDFe já é responsabilidade da sincronização oficial (ultNSU).
          apenasManifestacao: opcoes.apenasManifestacao !== false
        }));
      } catch (error) {
        logCentralErro('MANIFESTACAO', error, { documentoId: documento.id });
        resultados.push({
          documentoId: documento.id,
          sucesso: false,
          mensagem: error.message
        });
      }
    }

    return {
      politica,
      executado: true,
      candidatos: candidatos.length,
      concluidos: resultados.filter((r) => r.xmlCompleto).length,
      resultados
    };
  }

  async processarDocumento(documentoId, opcoes = {}) {
    const id = Number(documentoId);
    if (!id) throw new Error('Documento inválido para manifestação.');
    if (this._emExecucao.has(id)) {
      return { documentoId: id, sucesso: false, ignorado: true, mensagem: 'Ciclo DF-e já em execução.' };
    }

    this._emExecucao.add(id);
    try {
      const documento = await this._documentosRepository.buscarPorId(id);
      if (!documento) {
        const erro = new Error('Documento não encontrado.');
        erro.statusCode = 404;
        throw erro;
      }

      if (documento.status === DocumentoFiscalStatus.XML_INDISPONIVEL) {
        return {
          documentoId: id,
          sucesso: false,
          ignorado: true,
          encerrado: true,
          status: documento.status,
          xmlCompleto: false,
          aguardandoDisponibilizacao: false,
          mensagem: MENSAGEM_XML_INDISPONIVEL
        };
      }

      if (
        documento.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
        || documento.tipoDocumento !== DocumentoDfeTipo.RES_NFE
      ) {
        return {
          documentoId: id,
          sucesso: true,
          ignorado: true,
          encerrado: isTerminal(documento.status),
          xmlCompleto: documento.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
            && documento.status !== DocumentoFiscalStatus.XML_INDISPONIVEL,
          mensagem: isTerminal(documento.status)
            ? `Documento encerrado (${documento.status}). Ciclo DF-e não será reiniciado.`
            : 'Documento não é mais candidato ao ciclo RES_NFE.'
        };
      }

      const politica = opcoes.politica
        || await this._configuracao.obterPoliticaManifestacao();
      const confirmado = opcoes.confirmado === true
        || politica === POLITICAS_MANIFESTACAO.AUTOMATICA_CIENCIA;
      /** RC3.3.6 — recuperação XML_WAIT: só DistDFe, nunca remanifestação. */
      const recuperacaoXml = opcoes.modoRecuperacaoXml === true;

      if (!confirmado && !recuperacaoXml) {
        return {
          documentoId: id,
          sucesso: false,
          ignorado: true,
          requerConfirmacao: politica === POLITICAS_MANIFESTACAO.CONFIRMAR_OPERADOR,
          politica,
          mensagem: politica === POLITICAS_MANIFESTACAO.CONFIRMAR_OPERADOR
            ? 'Confirmação do operador necessária.'
            : 'Manifestação em modo manual.'
        };
      }

      const contextoResult = await this._configuracao.obterContextoOperacional();
      if (!contextoResult.ok) {
        throw new Error(contextoResult.mensagem);
      }
      const contexto = contextoResult.contexto;

      // RC3.3.6 / RC3.4.1 — recuperação: DistDFe direto (sem remanifestar).
      // forcarConsulta NÃO é permanente: herda do caller (MIRX = false).
      // Só true com justificativa técnica explícita no caller (ex.: admin).
      if (recuperacaoXml) {
        return this._consultarDistDfePorNsu(documento, contexto, {
          ...opcoes,
          forcarConsulta: opcoes.forcarConsulta === true,
          apenasManifestacao: false
        });
      }

      let aceita = await this._obterUltimoEvento(
        TIPOS_EVENTO.MANIFESTACAO_ACEITA,
        documento.id
      );
      let cienciaRecemAceita = false;
      if (!aceita) {
        const rejeitada = await this._obterUltimoEvento(
          TIPOS_EVENTO.MANIFESTACAO_REJEITADA,
          documento.id
        );
        // RC7.4.7 — rejeição 596 já registrada: encerra sem retry / XML_WAIT.
        // (Não se aplica ao modoRecuperacaoXml — tratado acima.)
        if (this._ehRejeicaoXmlIndisponivel(rejeitada)) {
          await this._encerrarXmlIndisponivel(documento, {
            cStat: String(rejeitada.resultado || rejeitada.detalhe?.cStat || '596'),
            xMotivo: rejeitada.detalhe?.xMotivo || rejeitada.descricao,
            usuarioId: opcoes.usuarioId,
            correlationId: opcoes.correlationId || rejeitada.detalhe?.correlationId
          });
          return {
            documentoId: id,
            sucesso: false,
            cStat: String(rejeitada.resultado || '596'),
            status: DocumentoFiscalStatus.XML_INDISPONIVEL,
            encerrado: true,
            xmlCompleto: false,
            aguardandoDisponibilizacao: false,
            mensagem: rejeitada.detalhe?.xMotivo || MENSAGEM_XML_INDISPONIVEL
          };
        }

        const bloqueioRejeicao = this._obterBloqueioRejeicao(rejeitada);
        if (!opcoes.forcarConsulta && bloqueioRejeicao && this._agora() < bloqueioRejeicao) {
          return {
            documentoId: id,
            sucesso: false,
            aguardandoDisponibilizacao: true,
            proximaConsultaEm: bloqueioRejeicao.toISOString(),
            mensagem: 'Manifestação rejeitada recentemente; nova tentativa somente após 1 hora.'
          };
        }

        const claim = await this._reclamarManifestacao(documento, opcoes);
        if (!claim.ok) {
          return {
            documentoId: id,
            sucesso: false,
            ignorado: true,
            mensagem: claim.mensagem
          };
        }

        try {
          aceita = await this._enviarCiencia(documento, contexto, opcoes);
          if (!aceita?.sucesso) {
            await this._liberarClaim(documento.id);
            return aceita;
          }
          cienciaRecemAceita = true;
        } catch (error) {
          await this._liberarClaim(documento.id);
          throw error;
        }
      }

      const atualizado = await this._documentosRepository.buscarPorId(id);
      if (atualizado?.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) {
        return {
          documentoId: id,
          sucesso: true,
          xmlCompleto: true,
          documento: atualizado,
          mensagem: 'XML completo já recebido.'
        };
      }

      // NT 2014.002: após Ciência, o PROC_NFE NÃO é imediato.
      // Aguarda disponibilização de novo NSU pelo Ambiente Nacional.
      if (cienciaRecemAceita || opcoes.apenasManifestacao === true) {
        return this._registrarAguardandoXml(documento, opcoes, aceita);
      }

      const ultimaConsulta = await this._obterUltimoEvento(
        TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
        documento.id
      );
      const bloqueioDaSincronizacao = opcoes.bloqueadoConsultaAte
        ? { detalhe: { proximaConsultaEm: opcoes.bloqueadoConsultaAte } }
        : null;
      const proximaConsultaEm = this._obterProximaConsulta(
        aceita,
        ultimaConsulta,
        bloqueioDaSincronizacao
      );
      const agora = this._agora();
      if (!opcoes.forcarConsulta && proximaConsultaEm && agora < proximaConsultaEm) {
        return {
          documentoId: id,
          sucesso: true,
          aguardandoDisponibilizacao: true,
          proximaConsultaEm: proximaConsultaEm.toISOString(),
          mensagem: MENSAGEM_AGUARDANDO_XML
        };
      }

      // DistDFe (ultNSU); se sem PROC, fallback consChNFe em _consultarDistDfePorNsu.
      return this._consultarDistDfePorNsu(documento, contexto, opcoes);
    } finally {
      this._emExecucao.delete(id);
    }
  }

  async _enviarCiencia(documento, contexto, opcoes) {
    const inicio = Date.now();
    const correlationId = opcoes.correlationId || criarCorrelationId();
    await this._registrarEtapa({
      tipo: TIPOS_EVENTO.CIENCIA_ENVIADA,
      documento,
      descricao: 'Ciência da Emissão (210210) enviada.',
      resultado: 'ENVIADA',
      sucesso: null,
      usuarioId: opcoes.usuarioId,
      detalhe: { chave: documento.chave, evento: '210210', correlationId },
      ignorarHistoricoDuplicado: true
    });

    try {
      const envelope = this._prepararEnvelopeAssinado({
        tpAmb: Number(contexto.ambiente) === 1 ? 1 : 2,
        cOrgao: '91',
        cnpj: contexto.cnpj,
        chave: documento.chave,
        operacao: OperationType.MANIFESTACAO_CIENCIA,
        certificadoPath: contexto.certificadoPath,
        certificadoSenha: contexto.certificadoSenha
      });
      const runtime = await this._enviarManifestacao({
        operacao: OperationType.MANIFESTACAO_CIENCIA,
        ambiente: contexto.ambiente,
        cnpj: contexto.cnpj,
        chave: documento.chave,
        certificadoPath: contexto.certificadoPath,
        certificadoSenha: contexto.certificadoSenha,
        envelope
      });

      // RC3.3.3 — Central rejeita bypass legado da Plataforma Fiscal.
      if (
        runtime.fallbackUtilizado
        || runtime.source === ResolutionSource.FALLBACK
        || String(runtime.source || '').toUpperCase() === 'FALLBACK'
      ) {
        const duracaoMs = Number(runtime.tempoTotalMs) || (Date.now() - inicio);
        const proximaConsultaEm = new Date(
          this._agora().getTime() + INTERVALO_SEGURO_MS
        ).toISOString();
        await this._registrarEtapa({
          tipo: TIPOS_EVENTO.MANIFESTACAO_REJEITADA,
          documento,
          descricao: 'Manifestação rejeitada: fallback legado não é aceito pela Central (RC3.3.3).',
          resultado: 'FALLBACK_REJEITADO',
          sucesso: false,
          duracaoMs,
          usuarioId: opcoes.usuarioId,
          detalhe: {
            evento: '210210',
            correlationId,
            source: runtime.source || null,
            fallbackUtilizado: true,
            proximaConsultaEm
          }
        });
        logOperacaoCentral({
          correlationId,
          chave: documento.chave,
          operacao: 'MANIFESTACAO_210210',
          tempoMs: duracaoMs,
          resultado: 'FALLBACK_REJEITADO',
          origem: 'CentralManifestacaoDfeService',
          runtime: runtime.source || 'FALLBACK'
        });
        return {
          documentoId: documento.id,
          sucesso: false,
          proximaConsultaEm,
          mensagem: 'Fallback legado da Plataforma Fiscal bloqueado pela Central.'
        };
      }

      const fiscal = extrairRetornoManifestacao(runtime.body);
      const duracaoMs = Number(runtime.tempoTotalMs) || (Date.now() - inicio);
      const detalhe = {
        evento: '210210',
        correlationId,
        cStat: fiscal.cStat,
        xMotivo: fiscal.xMotivo,
        protocolo: fiscal.protocolo,
        dataRegistro: fiscal.dataRegistro,
        tempoMs: duracaoMs,
        tempoSoapMs: Number(runtime.tempoSoapMs) || null,
        endpoint: runtime.endpoint || null,
        statusCode: runtime.statusCode || null,
        source: runtime.source || null,
        fallbackUtilizado: Boolean(runtime.fallbackUtilizado)
      };

      if (!runtime.success || !fiscal.aceita) {
        const cStat = String(fiscal.cStat || '');
        const xmlIndisponivel = CSTAT_XML_INDISPONIVEL.has(cStat);
        detalhe.proximaConsultaEm = xmlIndisponivel
          ? null
          : new Date(this._agora().getTime() + INTERVALO_SEGURO_MS).toISOString();
        detalhe.xmlIndisponivel = xmlIndisponivel || undefined;

        await this._registrarEtapa({
          tipo: TIPOS_EVENTO.MANIFESTACAO_REJEITADA,
          documento,
          descricao: xmlIndisponivel
            ? `Manifestação rejeitada (prazo): ${fiscal.xMotivo || 'cStat 596'}`
            : `Manifestação rejeitada: ${fiscal.xMotivo || runtime.error || 'retorno inválido'}`,
          resultado: fiscal.cStat || 'ERRO',
          sucesso: false,
          duracaoMs,
          usuarioId: opcoes.usuarioId,
          detalhe
        });

        if (xmlIndisponivel) {
          // RC3.3.6 — recuperação XML_WAIT nunca encerra por 596 de remanifestação.
          if (opcoes.modoRecuperacaoXml === true) {
            logOperacaoCentral({
              correlationId,
              chave: documento.chave,
              operacao: 'MANIFESTACAO_210210',
              tempoMs: duracaoMs,
              resultado: '596_IGNORADO_RECUPERACAO',
              cStat,
              origem: 'CentralManifestacaoDfeService',
              runtime: runtime.source || 'PLATFORM'
            });
            return {
              documentoId: documento.id,
              sucesso: false,
              cStat,
              xmlCompleto: false,
              aguardandoDisponibilizacao: true,
              recuperacaoSemEncerrar: true,
              mensagem: fiscal.xMotivo || MENSAGEM_XML_INDISPONIVEL,
              detalhe
            };
          }
          await this._encerrarXmlIndisponivel(documento, {
            cStat,
            xMotivo: fiscal.xMotivo,
            usuarioId: opcoes.usuarioId,
            correlationId,
            detalhe
          });
          return {
            documentoId: documento.id,
            sucesso: false,
            cStat,
            status: DocumentoFiscalStatus.XML_INDISPONIVEL,
            encerrado: true,
            xmlCompleto: false,
            aguardandoDisponibilizacao: false,
            mensagem: fiscal.xMotivo || MENSAGEM_XML_INDISPONIVEL,
            detalhe
          };
        }

        return {
          documentoId: documento.id,
          sucesso: false,
          cStat: fiscal.cStat,
          proximaConsultaEm: detalhe.proximaConsultaEm,
          mensagem: fiscal.xMotivo || runtime.error || 'Manifestação não registrada pela SEFAZ.'
        };
      }

      const aguardarAte = this._resolverProximaJanela(opcoes.bloqueadoConsultaAte);
      detalhe.proximaConsultaEm = aguardarAte.toISOString();

      const insercao = await this._eventosRepository.inserirUnico({
        tipo: TIPOS_EVENTO.MANIFESTACAO_ACEITA,
        origem: ORIGENS.SISTEMA,
        descricao: fiscal.duplicada
          ? 'Ciência da Emissão já registrada anteriormente.'
          : 'Manifestação aceita pela SEFAZ.',
        resultado: fiscal.cStat,
        sucesso: true,
        documentoId: documento.id,
        duracaoMs,
        detalhe
      });

      await this._historicoRepository.inserir({
        documentoId: documento.id,
        statusAnterior: documento.status,
        statusNovo: documento.status,
        usuarioId: opcoes.usuarioId || null,
        detalhe: fiscal.duplicada
          ? 'Ciência da Emissão já registrada anteriormente.'
          : 'Manifestação aceita pela SEFAZ.'
      });

      await this._liberarClaim(documento.id);

      logOperacaoCentral({
        correlationId,
        chave: documento.chave,
        operacao: 'MANIFESTACAO_210210',
        tempoMs: duracaoMs,
        resultado: 'OK',
        cStat: fiscal.cStat,
        origem: 'CentralManifestacaoDfeService',
        runtime: runtime.source || 'PLATFORM'
      });

      return { ...(insercao.evento || {}), sucesso: true, detalhe };
    } catch (error) {
      const duracaoMs = Date.now() - inicio;
      const proximaConsultaEm = new Date(
        this._agora().getTime() + INTERVALO_SEGURO_MS
      ).toISOString();
      await this._registrarEtapa({
        tipo: TIPOS_EVENTO.MANIFESTACAO_REJEITADA,
        documento,
        descricao: `Falha ao enviar Ciência da Emissão: ${error.message}`,
        resultado: 'ERRO',
        sucesso: false,
        duracaoMs,
        usuarioId: opcoes.usuarioId,
        detalhe: { evento: '210210', erro: error.message, proximaConsultaEm, correlationId }
      });
      return {
        documentoId: documento.id,
        sucesso: false,
        proximaConsultaEm,
        mensagem: error.message
      };
    }
  }

  async _registrarAguardandoXml(documento, opcoes, eventoAceita = null) {
    const proximaConsultaEm = this._resolverProximaJanela(
      opcoes.bloqueadoConsultaAte
      || eventoAceita?.detalhe?.proximaConsultaEm
    ).toISOString();

    const ultimaConsulta = await this._obterUltimoEvento(
      TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
      documento.id
    );
    const jaRegistrado = ultimaConsulta?.detalhe?.aguardandoXml === true
      || ultimaConsulta?.descricao === MENSAGEM_AGUARDANDO_XML;

    if (!jaRegistrado) {
      await this._registrarEtapa({
        tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
        documento,
        descricao: MENSAGEM_AGUARDANDO_XML,
        resultado: 'AGUARDANDO_NSU',
        sucesso: true,
        usuarioId: opcoes.usuarioId,
        detalhe: {
          aguardandoXml: true,
          motivo: 'NT_2014_002',
          proximaConsultaEm
        }
      });
    }

    // RC3.4.1 — enfileira no MIRX (não consulta SEFAZ aqui).
    try {
      const xmlWait = require('./CentralXmlWaitScheduler');
      if (typeof xmlWait.enfileirarRecuperacao === 'function') {
        await xmlWait.enfileirarRecuperacao(documento, {
          origem: ORIGENS.SISTEMA,
          motivo: 'pos_ciencia_aguardar_janela',
          correlationId: opcoes.correlationId,
          proximaEm: proximaConsultaEm
        });
      }
    } catch { /* ignore */ }

    return {
      documentoId: documento.id,
      sucesso: true,
      xmlCompleto: false,
      aguardandoDisponibilizacao: true,
      proximaConsultaEm,
      mensagem: MENSAGEM_AGUARDANDO_XML
    };
  }

  async _consultarDistDfePorNsu(documento, contexto, opcoes) {
    const inicio = Date.now();
    const statusAnterior = documento.status;
    const ambiente = Number(contexto.ambiente) === 1 ? 1 : 2;
    const correlationId = opcoes.correlationId || criarCorrelationId();

    const executarConsulta = async () => {
      try {
        const controle = await this._nsuService.buscarPorCnpjAmbiente(
          contexto.cnpj,
          ambiente
        );
        const cooldown = this._nsuService.avaliarCooldown(controle);
        if (!opcoes.forcarConsulta && cooldown.ativo) {
          return {
            documentoId: documento.id,
            sucesso: true,
            xmlCompleto: false,
            aguardandoDisponibilizacao: true,
            cStat: controle?.ultimoCstat || '137',
            ultNsu: controle?.ultNsu || null,
            maxNsu: controle?.maxNsu || null,
            proximaConsultaEm: cooldown.proximaConsultaEm,
            mensagem: MENSAGEM_AGUARDANDO_XML
          };
        }

        const resultado = await this._sincronizarDfe({
          maxIteracoes: Math.min(Number(opcoes.maxIteracoes) || 5, 20),
          contextoCentral: contexto,
          nsuRepository: this._nsuRepository,
          nsuService: this._nsuService,
          correlationId
        });
        const atualizado = await this._documentosRepository.buscarPorId(documento.id);
        const xmlCompleto = atualizado
          && atualizado.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
          && [DocumentoDfeTipo.PROC_NFE, DocumentoDfeTipo.NFE].includes(atualizado.tipoDocumento);
        const duracaoMs = Date.now() - inicio;
        const cStat = String(resultado.cStat || '');
        const proximaConsultaEm = xmlCompleto
          ? null
          : (resultado.proximaConsultaEm || this._resolverProximaJanela().toISOString());
        const deveAguardar = !xmlCompleto;

        await this._registrarEtapa({
          tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
          documento: atualizado || documento,
          descricao: xmlCompleto
            ? 'XML completo recebido via Distribuição DF-e (NSU).'
            : MENSAGEM_AGUARDANDO_XML,
          resultado: cStat || (xmlCompleto ? 'XML_COMPLETO' : 'AGUARDANDO_NSU'),
          sucesso: cStat !== '656' && resultado.sucesso !== false,
          duracaoMs,
          usuarioId: opcoes.usuarioId,
          detalhe: {
            modo: 'distNSU',
            correlationId,
            cStat,
            mensagem: resultado.mensagem || null,
            ultNsu: resultado.ultNsu || null,
            maxNsu: resultado.maxNsu || null,
            novoNsu: atualizado?.nsu || null,
            tipoDocumento: atualizado?.tipoDocumento || documento.tipoDocumento,
            xmlCompleto,
            aguardandoXml: !xmlCompleto,
            proximaConsultaEm
          }
        });

        logOperacaoCentral({
          correlationId,
          chave: documento.chave,
          nsu: resultado.ultNsu,
          operacao: 'DIST_DFE_POS_MANIFESTACAO',
          cStat,
          tempoMs: duracaoMs,
          resultado: xmlCompleto ? 'PROC_NFE' : (cStat === '656' ? '656' : 'AGUARDANDO'),
          origem: 'CentralManifestacaoDfeService',
          runtime: 'PLATFORM'
        });

        // RC3.3.6+ — DistDFe sem PROC: fallback oficial consChNFe (exceto 656).
        if (!xmlCompleto && cStat !== '656' && resultado.sucesso !== false) {
          const porChave = await this._consultarXmlCompletoPorChave(documento, contexto, {
            ...opcoes,
            correlationId,
            inicioMs: inicio,
            origemDist: {
              cStat,
              ultNsu: resultado.ultNsu || null,
              maxNsu: resultado.maxNsu || null
            }
          });
          if (porChave.xmlCompleto) {
            return porChave;
          }
          // Mantém janela de espera (DistDFe ou consChNFe).
          return {
            documentoId: documento.id,
            sucesso: true,
            cStat: porChave.cStat || cStat,
            ultNsu: resultado.ultNsu || null,
            maxNsu: resultado.maxNsu || null,
            xmlCompleto: false,
            documento: await this._documentosRepository.buscarPorId(documento.id),
            proximaConsultaEm: porChave.proximaConsultaEm || proximaConsultaEm,
            aguardandoDisponibilizacao: true,
            consultaPorChave: true,
            mensagem: MENSAGEM_AGUARDANDO_XML
          };
        }

        return {
          documentoId: documento.id,
          sucesso: cStat !== '656' && resultado.sucesso !== false,
          cStat,
          ultNsu: resultado.ultNsu || null,
          maxNsu: resultado.maxNsu || null,
          xmlCompleto,
          documento: atualizado,
          proximaConsultaEm,
          aguardandoDisponibilizacao: deveAguardar && !xmlCompleto,
          mensagem: xmlCompleto
            ? 'XML completo recebido e promovido automaticamente.'
            : cStat === '656'
              ? 'Consumo indevido informado pela SEFAZ; nova tentativa bloqueada por 1 hora.'
              : MENSAGEM_AGUARDANDO_XML
        };
      } catch (error) {
        const duracaoMs = Date.now() - inicio;
        const proximaConsultaEm = this._resolverProximaJanela().toISOString();
        await this._registrarEtapa({
          tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
          documento,
          descricao: MENSAGEM_AGUARDANDO_XML,
          resultado: 'ERRO',
          sucesso: false,
          duracaoMs,
          usuarioId: opcoes.usuarioId,
          detalhe: {
            modo: 'distNSU',
            erro: error.message,
            aguardandoXml: true,
            proximaConsultaEm,
            correlationId
          }
        });
        return {
          documentoId: documento.id,
          sucesso: false,
          xmlCompleto: false,
          aguardandoDisponibilizacao: true,
          proximaConsultaEm,
          mensagem: error.message
        };
      }
    };

    if (this._syncExecucao && typeof this._syncExecucao.comLockDistDfe === 'function') {
      const locked = await this._syncExecucao.comLockDistDfe(
        `ciclo-dfe:${documento.id}`,
        executarConsulta
      );
      if (locked && locked.codigo === 'SYNC_EM_ANDAMENTO') {
        return {
          documentoId: documento.id,
          sucesso: false,
          ignorado: true,
          aguardandoDisponibilizacao: true,
          mensagem: locked.mensagem
        };
      }
      return locked;
    }

    return executarConsulta();
  }

  /**
   * RC3.3.6+ — Fallback após DistDFe sem PROC: consChNFe da mesma chave.
   * Reutiliza consultarNotaPorChave (Plataforma Fiscal) + persistência Central.
   * @private
   */
  async _consultarXmlCompletoPorChave(documento, contexto, opcoes = {}) {
    const correlationId = opcoes.correlationId || criarCorrelationId();
    const inicio = opcoes.inicioMs || Date.now();
    try {
      await this._consultarNotaPorChave(documento.chave, {
        contextoCentral: contexto
      });
    } catch (error) {
      const duracaoMs = Date.now() - inicio;
      const proximaConsultaEm = this._resolverProximaJanela().toISOString();
      await this._registrarEtapa({
        tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
        documento,
        descricao: `Consulta por chave sem XML completo: ${error.message}`,
        resultado: 'CONS_CHNFE_ERRO',
        sucesso: false,
        duracaoMs,
        usuarioId: opcoes.usuarioId,
        detalhe: {
          modo: 'consChNFe',
          correlationId,
          erro: error.message,
          origemDist: opcoes.origemDist || null,
          aguardandoXml: true,
          proximaConsultaEm
        }
      });
      logOperacaoCentral({
        correlationId,
        chave: documento.chave,
        operacao: 'CONS_CHNFE_POS_DIST',
        tempoMs: duracaoMs,
        resultado: 'ERRO',
        origem: 'CentralManifestacaoDfeService',
        runtime: 'PLATFORM'
      });
      return {
        documentoId: documento.id,
        sucesso: false,
        xmlCompleto: false,
        aguardandoDisponibilizacao: true,
        proximaConsultaEm,
        mensagem: error.message,
        consultaPorChave: true
      };
    }

    const atualizado = await this._documentosRepository.buscarPorId(documento.id);
    const xmlCompleto = atualizado
      && atualizado.status !== DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
      && [DocumentoDfeTipo.PROC_NFE, DocumentoDfeTipo.NFE].includes(atualizado.tipoDocumento);
    const duracaoMs = Date.now() - inicio;
    const proximaConsultaEm = xmlCompleto
      ? null
      : this._resolverProximaJanela().toISOString();

    await this._registrarEtapa({
      tipo: TIPOS_EVENTO.CONSULTA_DFE_POS_MANIFESTACAO,
      documento: atualizado || documento,
      descricao: xmlCompleto
        ? 'XML completo recebido via consulta por chave (consChNFe).'
        : MENSAGEM_AGUARDANDO_XML,
      resultado: xmlCompleto ? 'XML_COMPLETO_CHAVE' : 'AGUARDANDO_CHAVE',
      sucesso: true,
      duracaoMs,
      usuarioId: opcoes.usuarioId,
      detalhe: {
        modo: 'consChNFe',
        correlationId,
        origemDist: opcoes.origemDist || null,
        tipoDocumento: atualizado?.tipoDocumento || documento.tipoDocumento,
        xmlCompleto,
        aguardandoXml: !xmlCompleto,
        proximaConsultaEm
      }
    });

    logOperacaoCentral({
      correlationId,
      chave: documento.chave,
      operacao: 'CONS_CHNFE_POS_DIST',
      tempoMs: duracaoMs,
      resultado: xmlCompleto ? 'PROC_NFE' : 'AGUARDANDO',
      origem: 'CentralManifestacaoDfeService',
      runtime: 'PLATFORM'
    });

    return {
      documentoId: documento.id,
      sucesso: true,
      xmlCompleto,
      documento: atualizado,
      consultaPorChave: true,
      proximaConsultaEm,
      aguardandoDisponibilizacao: !xmlCompleto,
      mensagem: xmlCompleto
        ? 'XML completo recebido via consulta por chave.'
        : MENSAGEM_AGUARDANDO_XML
    };
  }

  async _reclamarManifestacao(documento, opcoes = {}) {
    const claim = await this._eventosRepository.inserirUnico({
      tipo: TIPOS_EVENTO.MANIFESTACAO_CLAIM,
      origem: ORIGENS.SISTEMA,
      descricao: 'Claim atômico de Ciência da Emissão',
      resultado: 'CLAIM',
      sucesso: null,
      documentoId: documento.id,
      detalhe: {
        chave: documento.chave,
        usuarioId: opcoes.usuarioId || null
      }
    });

    if (claim.conflito) {
      const aceita = await this._obterUltimoEvento(
        TIPOS_EVENTO.MANIFESTACAO_ACEITA,
        documento.id
      );
      if (aceita) {
        return { ok: false, mensagem: 'Manifestação já aceita para esta chave.' };
      }
      return { ok: false, mensagem: 'Manifestação já em andamento para este documento.' };
    }
    return { ok: true };
  }

  async _liberarClaim(documentoId) {
    try {
      await this._eventosRepository.removerPorTipoDocumento(
        TIPOS_EVENTO.MANIFESTACAO_CLAIM,
        documentoId
      );
    } catch { /* ignore */ }
  }

  async _registrarEtapa(dados) {
    const documento = dados.documento;
    const evento = await this._emitirEvento({
      tipo: dados.tipo,
      origem: ORIGENS.SISTEMA,
      descricao: dados.descricao,
      resultado: dados.resultado,
      sucesso: dados.sucesso,
      documentoId: documento.id,
      usuarioId: dados.usuarioId || null,
      duracaoMs: dados.duracaoMs || null,
      detalhe: dados.detalhe || null
    });

    if (!dados.ignorarHistoricoDuplicado) {
      await this._historicoRepository.inserir({
        documentoId: documento.id,
        statusAnterior: documento.status,
        statusNovo: documento.status,
        usuarioId: dados.usuarioId || null,
        detalhe: dados.descricao
      });
    } else {
      // Timeline: um único histórico por descrição recente evita órfãos/duplicatas de Ciência.
      const historico = await this._historicoRepository.listarPorDocumento?.(documento.id);
      const jaExiste = Array.isArray(historico)
        && historico.some((h) => h.detalhe === dados.descricao);
      if (!jaExiste) {
        await this._historicoRepository.inserir({
          documentoId: documento.id,
          statusAnterior: documento.status,
          statusNovo: documento.status,
          usuarioId: dados.usuarioId || null,
          detalhe: dados.descricao
        });
      }
    }
    return evento;
  }

  async _obterUltimoEvento(tipo, documentoId) {
    const eventos = await this._eventosRepository.listar({
      tipo,
      documentoId,
      limite: 1
    });
    return eventos[0] || null;
  }

  _obterProximaConsulta(...eventos) {
    const datas = eventos
      .map((evento) => evento?.detalhe?.proximaConsultaEm)
      .filter(Boolean)
      .map((valor) => new Date(valor))
      .filter((data) => !Number.isNaN(data.getTime()));
    if (!datas.length) return null;
    return new Date(Math.max(...datas.map((data) => data.getTime())));
  }

  _ehRejeicaoXmlIndisponivel(eventoRejeicao) {
    if (!eventoRejeicao) return false;
    const cStat = String(
      eventoRejeicao.detalhe?.cStat
      || eventoRejeicao.resultado
      || ''
    );
    return CSTAT_XML_INDISPONIVEL.has(cStat);
  }

  /**
   * RC7.4.7 — Encerra documento em XML_INDISPONIVEL e cancela XML_WAIT.
   * @private
   */
  async _encerrarXmlIndisponivel(documento, meta = {}) {
    const cStat = String(meta.cStat || '596');
    const xMotivo = meta.xMotivo || MENSAGEM_XML_INDISPONIVEL;
    const detalhe = `XML indisponível (cStat ${cStat}): ${xMotivo}`;

    if (documento.status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) {
      await this._transitionService.transicionar(
        documento.id,
        documento.status,
        DocumentoFiscalStatus.XML_INDISPONIVEL,
        {
          detalhe,
          usuarioId: meta.usuarioId || null,
          origem: 'RC7.4.7_CSTAT_596'
        }
      );
    }

    this._cancelarXmlWait(documento.id, 'xml_indisponivel');

    logOperacaoCentral({
      correlationId: meta.correlationId || null,
      chave: documento.chave,
      operacao: 'MANIFESTACAO_210210',
      tempoMs: null,
      resultado: 'XML_INDISPONIVEL',
      cStat,
      origem: 'CentralManifestacaoDfeService',
      runtime: 'PLATFORM'
    });
  }

  _obterBloqueioRejeicao(eventoRejeicao) {
    if (!eventoRejeicao) return null;
    // RC7.4.7 — 596 nunca entra em cooldown de retry.
    if (this._ehRejeicaoXmlIndisponivel(eventoRejeicao)) return null;
    if (eventoRejeicao.detalhe?.proximaConsultaEm) {
      const data = new Date(eventoRejeicao.detalhe.proximaConsultaEm);
      return Number.isNaN(data.getTime()) ? null : data;
    }
    if (!eventoRejeicao.createdAt) return null;
    const criada = new Date(eventoRejeicao.createdAt);
    if (Number.isNaN(criada.getTime())) return null;
    return new Date(criada.getTime() + INTERVALO_SEGURO_MS);
  }

  _resolverProximaJanela(referencia = null) {
    const candidatas = [];
    if (referencia) {
      const data = new Date(referencia);
      if (!Number.isNaN(data.getTime())) candidatas.push(data);
    }
    candidatas.push(new Date(this._agora().getTime() + INTERVALO_SEGURO_MS));
    return new Date(Math.max(...candidatas.map((data) => data.getTime())));
  }

  _obterCooldownNsu(controle) {
    if (!controle?.dataSincronizacao) return null;
    if (String(controle.ultNsu || '') !== String(controle.maxNsu || '')) return null;
    const ultima = new Date(controle.dataSincronizacao);
    if (Number.isNaN(ultima.getTime())) return null;
    const proxima = new Date(ultima.getTime() + INTERVALO_SEGURO_MS);
    return this._agora() < proxima ? proxima : null;
  }
}

module.exports = CentralManifestacaoDfeService;
module.exports.POLITICAS_MANIFESTACAO = POLITICAS_MANIFESTACAO;
module.exports.CSTAT_MANIFESTACAO_ACEITA = CSTAT_MANIFESTACAO_ACEITA;
module.exports.CSTAT_XML_INDISPONIVEL = CSTAT_XML_INDISPONIVEL;
module.exports.INTERVALO_SEGURO_MS = INTERVALO_SEGURO_MS;
module.exports.MENSAGEM_AGUARDANDO_XML = MENSAGEM_AGUARDANDO_XML;
module.exports.MENSAGEM_XML_INDISPONIVEL = MENSAGEM_XML_INDISPONIVEL;
module.exports.extrairRetornoManifestacao = extrairRetornoManifestacao;
module.exports.prepararEnvelopeAssinado = prepararEnvelopeAssinado;
