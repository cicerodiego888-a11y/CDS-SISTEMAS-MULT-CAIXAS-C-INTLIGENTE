/**
 * Regras de saúde da Central (RC3.4.6) — somente leitura local.
 * Não consulta SEFAZ / não altera MIRX / não altera MIIP.
 *
 * @module motores/central-entradas/health/HealthRules
 */

const { HealthNiveis } = require('./HealthNiveis');
const { DocumentoFiscalStatus } = require('../core/DocumentoFiscalStatus');
const { recuperacaoPortalNacionalHabilitada } = require('../config/centralFeatureFlags');

const MS_MIN = 60 * 1000;
const MS_HORA = 60 * MS_MIN;

/** Limites (somente análise local — sem SEFAZ). */
const LIMITES = Object.freeze({
  AGENDADO_ATRASO_MS: 20 * MS_MIN,
  AGENDADO_ESPERA_MAX_MS: 4 * MS_HORA,
  SLEEP_ATRASO_MS: 20 * MS_MIN,
  SLEEP_MAX_MS: 3 * MS_HORA,
  SEM_WAKEUP_MS: 25 * MS_MIN,
  SEM_PARSER_MS: 30 * MS_MIN,
  PARSER_SEM_MIIP_MS: 45 * MS_MIN,
  MIIP_SEM_COMPRA_MS: 6 * MS_HORA,
  SEM_COMPRA_MS: 12 * MS_HORA,
  SEM_ATUALIZACAO_MS: 8 * MS_HORA,
  MUITAS_TENTATIVAS: 5,
  PARADO_ETAPA_MS: 6 * MS_HORA
});

const TERMINAIS = new Set([
  DocumentoFiscalStatus.GRAVADA,
  DocumentoFiscalStatus.DESCARTADA,
  DocumentoFiscalStatus.DUPLICADA,
  DocumentoFiscalStatus.XML_INDISPONIVEL
]);

/**
 * @typedef {Object} HealthAvaliacao
 * @property {string} regra
 * @property {string} nivel
 * @property {string} diagnostico
 * @property {string} recomendacao
 * @property {number} [tempoParadoMs]
 * @property {boolean} [autoRecuperavel]
 * @property {string} [acaoInterna]
 */

function formatarDuracao(ms) {
  const n = Math.max(0, Number(ms) || 0);
  const min = Math.floor(n / MS_MIN);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function tempoDesde(iso, agora) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, agora - t);
}

function proximaPassou(iso, agora, margemMs = 0) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return agora > t + margemMs;
}

/**
 * Avalia um documento + estado MIRX (somente leitura).
 * @param {Object} doc
 * @param {Object} [wait]
 * @param {Object} [ctx]
 * @returns {HealthAvaliacao[]}
 */
function avaliarDocumento(doc, wait = {}, ctx = {}) {
  const agora = ctx.agora != null ? Number(ctx.agora) : Date.now();
  const alertas = [];
  if (!doc?.id) return alertas;

  const status = doc.status;
  if (status === DocumentoFiscalStatus.XML_INDISPONIVEL || status === DocumentoFiscalStatus.ERRO) {
    alertas.push({
      regra: 'DOCUMENTO_BLOQUEADO',
      nivel: HealthNiveis.BLOQUEADO,
      diagnostico: status === DocumentoFiscalStatus.XML_INDISPONIVEL
        ? 'Documento encerrado: XML indisponível na SEFAZ (estado terminal).'
        : 'Documento em erro operacional. Verifique o histórico e a configuração.',
      recomendacao: status === DocumentoFiscalStatus.XML_INDISPONIVEL
        ? (recuperacaoPortalNacionalHabilitada()
          ? 'Recuperar pelo Portal Nacional (CDS) ou Importação de XML Legado. Nenhuma ação MIRX automática.'
          : 'Documento encerrado: XML indisponível na SEFAZ. Nenhuma ação MIRX automática.')
        : 'Verificar configuração e histórico do documento.',
      tempoParadoMs: tempoDesde(doc.updatedAt || doc.createdAt, agora),
      autoRecuperavel: false
    });
    return alertas;
  }

  if (TERMINAIS.has(status)) return alertas;

  const waitSafe = wait || {};
  const estadoMirx = waitSafe.estadoMirx || null;
  const dormindo = waitSafe.dormindo === true || estadoMirx === 'SLEEP';
  const proxima = waitSafe.proximaTentativa || null;
  const tentativas = Number(waitSafe.tentativas || 0);
  const atualizadoMs = tempoDesde(doc.updatedAt || doc.createdAt, agora);
  const criadoMs = tempoDesde(doc.createdAt, agora);
  const temParse = Boolean(doc.temParse || doc.parseDisponivel || doc.parseJson);
  const temMiip = Boolean(doc.temMiip || doc.miipDisponivel || doc.miipSessaoId || doc.miipResumoJson);
  const temCompra = Boolean(doc.compraId);
  const xmlProvavelCompleto = Boolean(doc.xmlCompletoProvavel)
    || ['PROC_NFE', 'NFE'].includes(doc.tipoDocumento);

  // 1) SLEEP além do esperado / sem WAKEUP
  if (dormindo) {
    const dormindoMs = tempoDesde(waitSafe.dormindoDesde || doc.updatedAt, agora);
    if (proximaPassou(proxima, agora, LIMITES.SEM_WAKEUP_MS)) {
      alertas.push({
        regra: 'SEM_WAKEUP',
        nivel: HealthNiveis.CRITICO,
        diagnostico: `Documento em SLEEP sem WAKEUP após o horário programado (${formatarDuracao(tempoDesde(proxima, agora))} de atraso).`,
        recomendacao: 'Aguardar o próximo ciclo do MIRX. Se persistir, verificar se o serviço da Central está ativo.',
        tempoParadoMs: dormindoMs,
        autoRecuperavel: false
      });
    } else if ((dormindoMs != null && dormindoMs > LIMITES.SLEEP_MAX_MS)
      || proximaPassou(proxima, agora, LIMITES.SLEEP_ATRASO_MS)) {
      alertas.push({
        regra: 'SLEEP_ALEM',
        nivel: HealthNiveis.ATENCAO,
        diagnostico: `Documento permaneceu em SLEEP além do tempo esperado (${formatarDuracao(dormindoMs || 0)}).`,
        recomendacao: proxima
          ? `Aguardar próxima tentativa automática.`
          : 'Aguardar próxima tentativa automática do MIRX.',
        tempoParadoMs: dormindoMs,
        autoRecuperavel: false
      });
    }
  }

  // 2) AGENDADO além do esperado (janela NT / consulta programada)
  if (
    status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
    && !dormindo
    && ['AGUARDANDO_JANELA_SEFAZ', 'CONSULTA_PROGRAMADA', null].includes(estadoMirx)
  ) {
    const esperaMs = tempoDesde(waitSafe.iniciadoEm || doc.updatedAt || doc.createdAt, agora);
    if (proximaPassou(proxima, agora, LIMITES.AGENDADO_ATRASO_MS)) {
      alertas.push({
        regra: 'AGENDADO_ALEM',
        nivel: HealthNiveis.CRITICO,
        diagnostico: `Recuperação automática do XML agendada, porém o horário passou sem nova tentativa (${formatarDuracao(tempoDesde(proxima, agora))} de atraso).`,
        recomendacao: 'Aguardar o scheduler MIRX. Verificar se o serviço da Central está ativo.',
        tempoParadoMs: esperaMs,
        autoRecuperavel: false
      });
    } else if (esperaMs != null && esperaMs > LIMITES.AGENDADO_ESPERA_MAX_MS) {
      alertas.push({
        regra: 'AGENDADO_ALEM',
        nivel: HealthNiveis.ATENCAO,
        diagnostico: `Documento aguardando recuperação automática do XML há ${formatarDuracao(esperaMs)}.`,
        recomendacao: proxima
          ? `Aguardar próxima tentativa automática.`
          : 'Aguardar próxima tentativa automática.',
        tempoParadoMs: esperaMs,
        autoRecuperavel: false
      });
    }
  }

  // 3) XML completo com status antigo
  if (
    xmlProvavelCompleto
    && status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO
  ) {
    alertas.push({
      regra: 'XML_STATUS_ANTIGO',
      nivel: HealthNiveis.CRITICO,
      diagnostico: 'XML completo aparentemente salvo, porém o status ainda é de espera de XML.',
      recomendacao: 'Reprocessar o documento internamente (Parser) — sem nova consulta à SEFAZ.',
      tempoParadoMs: atualizadoMs,
      autoRecuperavel: true,
      acaoInterna: 'processar_pendentes'
    });
  }

  // 4) Sem Parser (XML sincronizado)
  if (
    ['SINCRONIZADA'].includes(status)
    && xmlProvavelCompleto
    && !temParse
    && (atualizadoMs == null || atualizadoMs > LIMITES.SEM_PARSER_MS)
  ) {
    alertas.push({
      regra: 'SEM_PARSER',
      nivel: HealthNiveis.ATENCAO,
      diagnostico: `XML disponível, porém o Parser ainda não concluiu (${formatarDuracao(atualizadoMs || 0)}).`,
      recomendacao: 'Reprocessar internamente (Parser → MIIP). Sem consulta à SEFAZ.',
      tempoParadoMs: atualizadoMs,
      autoRecuperavel: true,
      acaoInterna: 'processar_pendentes'
    });
  }

  // 5) Parser sem MIIP
  if (
    temParse
    && !temMiip
    && [DocumentoFiscalStatus.SINCRONIZADA, DocumentoFiscalStatus.EM_PROCESSAMENTO].includes(status)
    && (atualizadoMs == null || atualizadoMs > LIMITES.PARSER_SEM_MIIP_MS)
  ) {
    alertas.push({
      regra: 'PARSER_SEM_MIIP',
      nivel: HealthNiveis.ATENCAO,
      diagnostico: 'Parser concluído, porém o MIIP ainda não foi iniciado ou não gerou resumo.',
      recomendacao: 'Reprocessar internamente o documento (pipeline Parser → MIIP).',
      tempoParadoMs: atualizadoMs,
      autoRecuperavel: true,
      acaoInterna: 'processar_pendentes'
    });
  }

  // 6) MIIP sem Compra
  if (
    temMiip
    && !temCompra
    && [
      DocumentoFiscalStatus.AGUARDANDO_REVISAO,
      DocumentoFiscalStatus.REVISADA,
      DocumentoFiscalStatus.PRONTA_PARA_COMPRA
    ].includes(status)
    && (atualizadoMs == null || atualizadoMs > LIMITES.MIIP_SEM_COMPRA_MS)
  ) {
    alertas.push({
      regra: 'MIIP_SEM_COMPRA',
      nivel: status === DocumentoFiscalStatus.PRONTA_PARA_COMPRA
        ? HealthNiveis.CRITICO
        : HealthNiveis.ATENCAO,
      diagnostico: status === DocumentoFiscalStatus.AGUARDANDO_REVISAO
        ? `MIIP em revisão há ${formatarDuracao(atualizadoMs || 0)} — Compra ainda não criada.`
        : 'Parser/MIIP concluídos, porém a Compra ainda não foi criada.',
      recomendacao: status === DocumentoFiscalStatus.AGUARDANDO_REVISAO
        ? 'Abrir a Central de Revisão MIIP e confirmar os produtos pendentes.'
        : 'Abrir a Compra a partir do documento na Central.',
      tempoParadoMs: atualizadoMs,
      autoRecuperavel: false
    });
  }

  // 7) Sem Compra (pronta)
  if (
    status === DocumentoFiscalStatus.PRONTA_PARA_COMPRA
    && !temCompra
    && (atualizadoMs == null || atualizadoMs > LIMITES.SEM_COMPRA_MS)
  ) {
    if (!alertas.some((a) => a.regra === 'MIIP_SEM_COMPRA')) {
      alertas.push({
        regra: 'SEM_COMPRA',
        nivel: HealthNiveis.CRITICO,
        diagnostico: `Documento pronto para Compra parado há ${formatarDuracao(atualizadoMs || 0)}.`,
        recomendacao: 'Criar a Compra a partir do documento.',
        tempoParadoMs: atualizadoMs,
        autoRecuperavel: false
      });
    }
  }

  // 8) Muitas tentativas MIRX
  if (tentativas >= LIMITES.MUITAS_TENTATIVAS
    && status === DocumentoFiscalStatus.AGUARDANDO_XML_COMPLETO) {
    alertas.push({
      regra: 'MUITAS_TENTATIVAS',
      nivel: HealthNiveis.ATENCAO,
      diagnostico: `Documento com ${tentativas} tentativas de recuperação de XML (backoff ativo).`,
      recomendacao: 'Aguardar próxima tentativa automática. Não forçar consultas extras à SEFAZ.',
      tempoParadoMs: criadoMs,
      autoRecuperavel: false
    });
  }

  // 9) Sem atualização há muito tempo
  if (
    atualizadoMs != null
    && atualizadoMs > LIMITES.SEM_ATUALIZACAO_MS
    && !TERMINAIS.has(status)
  ) {
    if (!alertas.length) {
      alertas.push({
        regra: 'SEM_ATUALIZACAO',
        nivel: HealthNiveis.ATENCAO,
        diagnostico: `Documento sem atualização há ${formatarDuracao(atualizadoMs)}.`,
        recomendacao: 'Verificar se o fluxo está aguardando ação do operador ou do MIRX.',
        tempoParadoMs: atualizadoMs,
        autoRecuperavel: false
      });
    }
  }

  // 10) Parado em etapa intermediária
  if (
    [
      DocumentoFiscalStatus.EM_PROCESSAMENTO,
      DocumentoFiscalStatus.EM_COMPRA,
      DocumentoFiscalStatus.RECEBIDA
    ].includes(status)
    && atualizadoMs != null
    && atualizadoMs > LIMITES.PARADO_ETAPA_MS
  ) {
    alertas.push({
      regra: 'PARADO_ETAPA',
      nivel: HealthNiveis.CRITICO,
      diagnostico: `Documento parado na etapa ${status} há ${formatarDuracao(atualizadoMs)}.`,
      recomendacao: status === DocumentoFiscalStatus.EM_PROCESSAMENTO
        ? 'Reprocessar internamente (Parser/MIIP).'
        : 'Verificar o histórico e retomar o fluxo operacional.',
      tempoParadoMs: atualizadoMs,
      autoRecuperavel: status === DocumentoFiscalStatus.EM_PROCESSAMENTO,
      acaoInterna: status === DocumentoFiscalStatus.EM_PROCESSAMENTO
        ? 'processar_pendentes'
        : null
    });
  }

  return alertas;
}

/**
 * Consolida alertas → nível final + diagnóstico principal.
 * @param {HealthAvaliacao[]} alertas
 * @returns {{ nivel: string, alertaPrincipal: HealthAvaliacao|null, alertas: HealthAvaliacao[] }}
 */
function consolidar(alertas = []) {
  if (!alertas.length) {
    return { nivel: HealthNiveis.SAUDAVEL, alertaPrincipal: null, alertas: [] };
  }
  const ordem = {
    [HealthNiveis.CRITICO]: 4,
    [HealthNiveis.BLOQUEADO]: 3,
    [HealthNiveis.ATENCAO]: 2
  };
  const ordenados = [...alertas].sort(
    (a, b) => (ordem[b.nivel] || 0) - (ordem[a.nivel] || 0)
  );
  return {
    nivel: ordenados[0].nivel,
    alertaPrincipal: ordenados[0],
    alertas: ordenados
  };
}

module.exports = {
  LIMITES,
  TERMINAIS,
  avaliarDocumento,
  consolidar,
  formatarDuracao
};
