/**
 * Constrói o catálogo oficial de Web Services fiscais do CDS.
 *
 * Escopo atual (Sprint F2 / RC1.1 / RC6.9): CE via SVRS + Ambiente Nacional (DF-e + Manifestação).
 * Catálogo consumido pelos runtimes via FiscalWebServices / UrlResolver.
 *
 * @module services/fiscal/core/RegistryBuilder
 */

const { WebServiceRegistry } = require('./WebServiceRegistry');
const { WebServiceDefinition } = require('./WebServiceDefinition');
const { OperationType } = require('./OperationType');
const { ModelType } = require('./ModelType');
const { EnvironmentType } = require('./EnvironmentType');
const { DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RETRIES } = require('./SoapTransport');

const UF_SVRS = 'SVRS';
const UF_AN = 'AN';

const NS = Object.freeze({
  AUTORIZACAO: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4',
  RETORNO: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4',
  STATUS: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4',
  CONSULTA: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4',
  EVENTO: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4',
  DFE: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe'
});

const ACTION = Object.freeze({
  AUTORIZACAO: `${NS.AUTORIZACAO}/nfeAutorizacaoLote`,
  RETORNO: `${NS.RETORNO}/nfeRetAutorizacaoLote`,
  STATUS: `${NS.STATUS}/nfeStatusServicoNF`,
  CONSULTA: `${NS.CONSULTA}/nfeConsultaNF`,
  EVENTO: `${NS.EVENTO}/nfeRecepcaoEvento`,
  DFE: `${NS.DFE}/nfeDistDFeInteresse`
});

const ENDPOINTS = Object.freeze({
  NFCE_AUTORIZACAO: {
    [EnvironmentType.PRODUCAO]: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx'
  },
  NFCE_RETORNO: {
    [EnvironmentType.PRODUCAO]: 'https://nfce.svrs.rs.gov.br/ws/NFeRetAutorizacao/NFeRetAutorizacao4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NFeRetAutorizacao/NFeRetAutorizacao4.asmx'
  },
  NFCE_STATUS: {
    [EnvironmentType.PRODUCAO]: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NFeStatusServico4.asmx'
  },
  NFCE_CONSULTA: {
    [EnvironmentType.PRODUCAO]: 'https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx'
  },
  NFE_CONSULTA: {
    [EnvironmentType.PRODUCAO]: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NFeConsultaProtocolo4.asmx'
  },
  NFCE_EVENTO: {
    [EnvironmentType.PRODUCAO]: 'https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx'
  },
  NFE_AUTORIZACAO: {
    [EnvironmentType.PRODUCAO]: 'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx'
  },
  NFE_EVENTO: {
    // Mantido para cancelamento/eventos de UF via SVRS (não usar em Manifestação).
    [EnvironmentType.PRODUCAO]: 'https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx'
  },
  // Manifestação do Destinatário — Portal Nacional / NT 2020.001 §6.3 (Ambiente Nacional).
  AN_RECEPCAO_EVENTO: {
    [EnvironmentType.PRODUCAO]: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx'
  },
  DFE: {
    // Portal Nacional NF-e (AN) — www/hom desativados (404); oficiais: www1 / hom1 (aviso RFB 23/05/2022)
    [EnvironmentType.PRODUCAO]: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    [EnvironmentType.HOMOLOGACAO]: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
  }
});

/**
 * Quantidade oficial de serviços cadastrados pelo builder.
 * F2: 20 (auth/cancel/status/retorno/nfe/dfe + 4 manifestações × 2 amb)
 * F8: +4 Consulta Protocolo (NFC-e + NF-e × 2 ambientes) = 24
 */
const OFFICIAL_SERVICE_COUNT = 24;

function soapHeaders(soapAction) {
  return Object.freeze({
    'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction}"`,
    Accept: 'application/soap+xml, text/xml, */*'
  });
}

function def(partial) {
  return WebServiceDefinition.create({
    timeout: DEFAULT_TIMEOUT_MS,
    retry: DEFAULT_MAX_RETRIES,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: false },
    ativo: true,
    ...partial,
    headers: soapHeaders(partial.soapAction)
  });
}

/**
 * Lista plana das definições oficiais (imutável após build).
 * @returns {WebServiceDefinition[]}
 */
function listOfficialDefinitions() {
  const ambientes = [EnvironmentType.PRODUCAO, EnvironmentType.HOMOLOGACAO];
  const defs = [];

  for (const ambiente of ambientes) {
    defs.push(def({
      modelo: ModelType.NFCE,
      operacao: OperationType.AUTORIZACAO,
      ambiente,
      uf: UF_SVRS,
      endpoint: ENDPOINTS.NFCE_AUTORIZACAO[ambiente],
      soapAction: ACTION.AUTORIZACAO,
      namespace: NS.AUTORIZACAO,
      versao: '4.00',
      descricao: `NFC-e Autorização (${ambiente}) — SVRS`,
      observacoes: 'Endpoint oficial SVRS para CE. Runtime F10 via autorizacaoRuntime + emissor.'
    }));

    defs.push(def({
      modelo: ModelType.NFCE,
      operacao: OperationType.CANCELAMENTO,
      ambiente,
      uf: UF_SVRS,
      endpoint: ENDPOINTS.NFCE_EVENTO[ambiente],
      soapAction: ACTION.EVENTO,
      namespace: NS.EVENTO,
      versao: '1.00',
      descricao: `NFC-e Cancelamento (${ambiente}) — SVRS`,
      observacoes: 'Evento 110111. Runtime F9 via cancelamentoRuntime + cancelarNfce.'
    }));

    defs.push(def({
      modelo: ModelType.NFCE,
      operacao: OperationType.STATUS_SERVICO,
      ambiente,
      uf: UF_SVRS,
      endpoint: ENDPOINTS.NFCE_STATUS[ambiente],
      soapAction: ACTION.STATUS,
      namespace: NS.STATUS,
      versao: '4.00',
      descricao: `NFC-e Status Serviço (${ambiente}) — SVRS`,
      observacoes: 'Runtime F5 via statusServico. Consulta NFeStatusServico.'
    }));

    defs.push(def({
      modelo: ModelType.NFCE,
      operacao: OperationType.CONSULTA_PROTOCOLO,
      ambiente,
      uf: UF_SVRS,
      endpoint: ENDPOINTS.NFCE_CONSULTA[ambiente],
      soapAction: ACTION.CONSULTA,
      namespace: NS.CONSULTA,
      versao: '4.00',
      descricao: `NFC-e Consulta Protocolo (${ambiente}) — SVRS`,
      observacoes: 'Consulta por chave (consSitNFe). Runtime F8.'
    }));

    defs.push(def({
      modelo: ModelType.NFCE,
      operacao: OperationType.RETORNO_AUTORIZACAO,
      ambiente,
      uf: UF_SVRS,
      endpoint: ENDPOINTS.NFCE_RETORNO[ambiente],
      soapAction: ACTION.RETORNO,
      namespace: NS.RETORNO,
      versao: '4.00',
      descricao: `NFC-e Retorno Autorização (${ambiente}) — SVRS`,
      observacoes: 'CDS usa indSinc=1; retorno assíncrono reservado para evolução.'
    }));

    defs.push(def({
      modelo: ModelType.NFE,
      operacao: OperationType.AUTORIZACAO,
      ambiente,
      uf: UF_SVRS,
      endpoint: ENDPOINTS.NFE_AUTORIZACAO[ambiente],
      soapAction: ACTION.AUTORIZACAO,
      namespace: NS.AUTORIZACAO,
      versao: '4.00',
      descricao: `NF-e Autorização (${ambiente}) — SVRS`,
      observacoes: 'Modelo 55. Hoje hardcoded em nfeDevolucaoCompra.js.'
    }));

    defs.push(def({
      modelo: ModelType.NFE,
      operacao: OperationType.CONSULTA_PROTOCOLO,
      ambiente,
      uf: UF_SVRS,
      endpoint: ENDPOINTS.NFE_CONSULTA[ambiente],
      soapAction: ACTION.CONSULTA,
      namespace: NS.CONSULTA,
      versao: '4.00',
      descricao: `NF-e Consulta Protocolo (${ambiente}) — SVRS`,
      observacoes: 'Consulta por chave (consSitNFe). Runtime F8.'
    }));

    defs.push(def({
      modelo: ModelType.NFE,
      operacao: OperationType.CANCELAMENTO,
      ambiente,
      uf: UF_SVRS,
      endpoint: ENDPOINTS.NFE_EVENTO[ambiente],
      soapAction: ACTION.EVENTO,
      namespace: NS.EVENTO,
      versao: '1.00',
      descricao: `NF-e Cancelamento (${ambiente}) — SVRS`,
      observacoes: 'Evento 110111 modelo 55. Runtime via cancelamentoRuntime + cancelarNfe.'
    }));

    defs.push(def({
      modelo: ModelType.NFE,
      operacao: OperationType.DISTRIBUICAO_DFE,
      ambiente,
      uf: UF_AN,
      endpoint: ENDPOINTS.DFE[ambiente],
      soapAction: ACTION.DFE,
      namespace: NS.DFE,
      versao: '1.01',
      descricao: `Distribuição DF-e (${ambiente}) — Ambiente Nacional`,
      observacoes: 'Ambiente Nacional. Runtime F6 via distribuicaoDfeRuntime + Central Sync.'
    }));

    const manifestacoes = [
      {
        operacao: OperationType.MANIFESTACAO_CIENCIA,
        evento: '210210',
        label: 'Ciência da Operação'
      },
      {
        operacao: OperationType.MANIFESTACAO_CONFIRMACAO,
        evento: '210200',
        label: 'Confirmação da Operação'
      },
      {
        operacao: OperationType.MANIFESTACAO_DESCONHECIMENTO,
        evento: '210220',
        label: 'Desconhecimento da Operação'
      },
      {
        operacao: OperationType.MANIFESTACAO_NAO_REALIZADA,
        evento: '210240',
        label: 'Operação não Realizada'
      }
    ];

    for (const item of manifestacoes) {
      defs.push(def({
        modelo: ModelType.NFE,
        operacao: item.operacao,
        ambiente,
        uf: UF_AN,
        endpoint: ENDPOINTS.AN_RECEPCAO_EVENTO[ambiente],
        soapAction: ACTION.EVENTO,
        namespace: NS.EVENTO,
        versao: '1.00',
        descricao: `Manifestação — ${item.label} (${ambiente}) — Ambiente Nacional`,
        observacoes: `RC6.9 / NT 2020.001 §6.3 — RecepcaoEvento AN (tpEvento ${item.evento}).`
      }));
    }
  }

  return defs;
}

class RegistryBuilder {
  /**
   * Constrói um registry vazio.
   * @returns {WebServiceRegistry}
   */
  static createEmpty() {
    return new WebServiceRegistry();
  }

  /**
   * Constrói o registry oficial do CDS (SVRS + AN).
   * @returns {WebServiceRegistry}
   */
  static buildOfficial() {
    const registry = new WebServiceRegistry();
    for (const definition of listOfficialDefinitions()) {
      registry.register(definition);
    }
    return registry;
  }

  /**
   * Popula um registry existente com o catálogo oficial.
   * @param {WebServiceRegistry} registry
   * @param {{ overwrite?: boolean }} [options]
   * @returns {WebServiceRegistry}
   */
  static populateOfficial(registry, options = {}) {
    if (!registry || typeof registry.register !== 'function') {
      throw new Error('RegistryBuilder.populateOfficial: registry inválido.');
    }
    for (const definition of listOfficialDefinitions()) {
      registry.register(definition, options);
    }
    return registry;
  }

  /**
   * @returns {number}
   */
  static getOfficialCount() {
    return OFFICIAL_SERVICE_COUNT;
  }

  /**
   * @returns {WebServiceDefinition[]}
   */
  static listOfficialDefinitions() {
    return listOfficialDefinitions();
  }
}

module.exports = {
  RegistryBuilder,
  listOfficialDefinitions,
  OFFICIAL_SERVICE_COUNT,
  ENDPOINTS,
  NS,
  ACTION,
  UF_SVRS,
  UF_AN
};
