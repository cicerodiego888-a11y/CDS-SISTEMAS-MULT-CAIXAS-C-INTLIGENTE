/**
 * RC3.7.5.1 / RC3.7.5.2 — NsuRecoveryService
 * Recuperação automática do cursor NSU após cStat 656 (Consumo Indevido).
 *
 * RC3.7.5.2:
 * - params.ultNsu/maxNsu null → fallback XML (namespace-tolerant);
 * - nunca tratar ausência como zero fabricado;
 * - logar origem: Parser | Fallback XML | Ausente.
 *
 * @module motores/central-entradas/services/NsuRecoveryService
 */

'use strict';

const CentralNsuRepository = require('../repositories/CentralNsuRepository');
const {
  NSU_ZERADO,
  normalizarNsu,
  normalizarNsuOuZero,
  extrairNsuTagDoXml
} = require('../../../services/fiscal/dfeRetornoParser');
const { logOperacaoCentral } = require('../utils/centralOperacaoLog');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');

/** Eventos já recuperados nesta execução do processo (anti-duplicação). */
const _eventosProcessados = new Set();

const ORIGEM_NSU = Object.freeze({
  PARSER: 'Parser',
  FALLBACK_XML: 'Fallback XML',
  AUSENTE: 'Ausente'
});

function nsuNumerico(valor) {
  const normalizado = normalizarNsuOuZero(valor);
  return BigInt(normalizado.replace(/^0+(?=\d)/, '') || '0');
}

function nsuInformado(valor) {
  return valor != null && String(valor).trim() !== '';
}

function chaveEvento(correlationId, cnpj, ambiente, local, remoto) {
  if (correlationId) return `cid:${correlationId}`;
  return `nsu:${cnpj || ''}:${ambiente || ''}:${local}:${remoto}`;
}

/**
 * Resolve NSU a partir de param do parser ou fallback XML.
 * @returns {{ valor: string|null, origem: string, recuperadoDoXml: boolean }}
 */
function resolverNsu(paramValor, xml, tag) {
  if (nsuInformado(paramValor)) {
    return {
      valor: normalizarNsu(paramValor),
      origem: ORIGEM_NSU.PARSER,
      recuperadoDoXml: false
    };
  }
  const doXml = extrairNsuTagDoXml(xml, tag);
  if (doXml) {
    return {
      valor: doXml,
      origem: ORIGEM_NSU.FALLBACK_XML,
      recuperadoDoXml: true
    };
  }
  return {
    valor: null,
    origem: ORIGEM_NSU.AUSENTE,
    recuperadoDoXml: false
  };
}

class NsuRecoveryService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._repository = deps.nsuRepository
      ?? new CentralNsuRepository({ db: deps.db ?? null });
    this._agora = deps.agora || (() => new Date());
    this._emitirEvento = deps.emitirEvento || null;
    this._processados = deps.processados || _eventosProcessados;
  }

  /**
   * @param {Object} params
   */
  async tentarRecuperar(params = {}) {
    const cStat = String(params.cStat || '');
    const controle = params.controle || null;
    const correlationId = params.correlationId || null;
    const xml = params.xmlRetorno || '';

    const base = {
      atualizou: false,
      motivo: null,
      nsuLocal: controle ? normalizarNsuOuZero(controle.ultNsu) : null,
      nsuRemoto: null,
      nsuAtualizado: null,
      maxNsuAtualizado: null,
      origemUltNsu: ORIGEM_NSU.AUSENTE,
      origemMaxNsu: ORIGEM_NSU.AUSENTE,
      controle: controle || null
    };

    if (cStat !== '656') {
      return { ...base, motivo: 'CSTAT_DIFERENTE' };
    }

    if (!controle?.id) {
      return { ...base, motivo: 'CONTROLE_AUSENTE' };
    }

    const resolucaoUlt = resolverNsu(params.ultNsu, xml, 'ultNSU');
    const resolucaoMax = resolverNsu(params.maxNsu, xml, 'maxNSU');
    base.origemUltNsu = resolucaoUlt.origem;
    base.origemMaxNsu = resolucaoMax.origem;
    base.nsuRemoto = resolucaoUlt.valor;

    this._logNsu({
      correlationId,
      nsuLocal: base.nsuLocal,
      nsuRemoto: resolucaoUlt.valor,
      atualizado: false,
      motivo: 'avaliacao',
      origem: resolucaoUlt.origem
    });

    if (!resolucaoUlt.valor || !resolucaoMax.valor) {
      this._logNsu({
        correlationId,
        nsuLocal: base.nsuLocal,
        nsuRemoto: resolucaoUlt.valor,
        atualizado: false,
        motivo: '656 sem ultNSU/maxNSU válidos',
        origem: ORIGEM_NSU.AUSENTE
      });
      return { ...base, motivo: 'SEM_ULT_NSU' };
    }

    if (resolucaoUlt.recuperadoDoXml || resolucaoMax.recuperadoDoXml) {
      await this._auditarFallbackXml({
        empresa: params.empresa || controle.cnpj || null,
        cnpj: controle.cnpj,
        ambiente: controle.ambiente,
        nsuRemoto: resolucaoUlt.valor,
        maxNsu: resolucaoMax.valor,
        correlationId,
        origemUltNsu: resolucaoUlt.origem,
        origemMaxNsu: resolucaoMax.origem
      });
    }

    const nsuRemoto = resolucaoUlt.valor;
    const maxRemoto = resolucaoMax.valor;
    const nsuLocal = normalizarNsuOuZero(controle.ultNsu);

    if (nsuNumerico(nsuRemoto) <= nsuNumerico(nsuLocal)) {
      this._logNsu({
        correlationId,
        nsuLocal,
        nsuRemoto,
        atualizado: false,
        motivo: 'SEFAZ <= local (sem alteração)',
        origem: resolucaoUlt.origem
      });
      return { ...base, motivo: 'SEFAZ_NAO_MAIOR', nsuLocal, nsuRemoto };
    }

    const chave = chaveEvento(
      correlationId,
      controle.cnpj,
      controle.ambiente,
      nsuLocal,
      nsuRemoto
    );
    if (this._processados.has(chave)) {
      return { ...base, motivo: 'JA_PROCESSADO', nsuLocal, nsuRemoto };
    }

    const agora = this._agora();
    const atualizado = await this._repository.atualizarSincronizacaoSegura(controle.id, {
      ultNsu: nsuRemoto,
      maxNsu: maxRemoto,
      ultimoCstat: '656',
      dataSincronizacao: agora.toISOString()
    });

    const novoLocal = normalizarNsuOuZero(atualizado?.ultNsu || nsuLocal);
    if (nsuNumerico(novoLocal) < nsuNumerico(nsuLocal)) {
      this._logNsu({
        correlationId,
        nsuLocal,
        nsuRemoto,
        atualizado: false,
        motivo: 'REGRESSAO_BLOQUEADA',
        origem: resolucaoUlt.origem
      });
      return {
        ...base,
        motivo: 'REGRESSAO_BLOQUEADA',
        nsuLocal,
        nsuRemoto,
        controle: atualizado || controle
      };
    }

    this._processados.add(chave);

    this._logNsu({
      correlationId,
      nsuLocal,
      nsuRemoto,
      atualizado: true,
      motivo: '656 Consumo Indevido',
      origem: resolucaoUlt.origem
    });

    await this._auditar({
      empresa: params.empresa || controle.cnpj || null,
      cnpj: controle.cnpj,
      ambiente: controle.ambiente,
      nsuLocal,
      nsuRemoto,
      nsuAtualizado: novoLocal,
      maxNsu: normalizarNsuOuZero(atualizado?.maxNsu || maxRemoto),
      correlationId,
      data: agora.toISOString(),
      origemUltNsu: resolucaoUlt.origem,
      origemMaxNsu: resolucaoMax.origem
    });

    logOperacaoCentral({
      correlationId,
      operacao: 'AUTO_SYNC_NSU',
      nsu: novoLocal,
      cStat: '656',
      resultado: 'ATUALIZADO',
      origem: 'NsuRecoveryService',
      detalhe: {
        nsuLocal,
        nsuRemoto,
        nsuAtualizado: novoLocal,
        maxNsu: maxRemoto,
        origemUltNsu: resolucaoUlt.origem,
        origemMaxNsu: resolucaoMax.origem
      }
    });

    return {
      atualizou: true,
      motivo: 'RECUPERADO',
      nsuLocal,
      nsuRemoto,
      nsuAtualizado: novoLocal,
      maxNsuAtualizado: normalizarNsuOuZero(atualizado?.maxNsu || maxRemoto),
      origemUltNsu: resolucaoUlt.origem,
      origemMaxNsu: resolucaoMax.origem,
      controle: atualizado || controle
    };
  }

  statusDiagnostico(controle, recuperacao = null) {
    const nsuLocal = controle ? normalizarNsuOuZero(controle.ultNsu) : null;
    const ultimoCstat = controle?.ultimoCstat || null;
    const cooldownAtivo = Boolean(
      controle?.cooldownAte && new Date(controle.cooldownAte).getTime() > this._agora().getTime()
    );

    let status = 'Sincronizado';
    if (recuperacao?.atualizou) {
      status = 'Atualizado automaticamente';
    } else if (cooldownAtivo && String(ultimoCstat) === '656') {
      status = 'Aguardando cooldown';
    } else if (String(ultimoCstat) === '656') {
      status = 'Consumo indevido (656)';
    }

    return {
      nsuLocal,
      nsuSefaz: recuperacao?.nsuRemoto || controle?.maxNsu || null,
      ultimoCstat,
      status,
      cooldownAte: controle?.cooldownAte || null,
      recuperadoAutomaticamente: Boolean(recuperacao?.atualizou),
      origemNsu: recuperacao?.origemUltNsu || null
    };
  }

  /** @private */
  _logNsu({ correlationId, nsuLocal, nsuRemoto, atualizado, motivo, origem, cooldownAte }) {
    if (motivo === 'avaliacao') {
      console.log([
        '[NSU]',
        `Origem: ${origem || ORIGEM_NSU.AUSENTE}`,
        `Local: ${nsuLocal ?? '—'}`,
        `Remoto: ${nsuRemoto ?? '—'}`,
        correlationId ? `CorrelationId: ${correlationId}` : null
      ].filter(Boolean).join('\n'));
      return;
    }

    const linhas = [
      '[NSU]',
      `Origem: ${origem || ORIGEM_NSU.AUSENTE}`,
      `Local: ${nsuLocal ?? '—'}`,
      `Remoto: ${nsuRemoto ?? '—'}`,
      `Atualizado: ${atualizado ? 'Sim' : 'Não'}`,
      `Motivo: ${motivo || '—'}`,
      `Cooldown: ${cooldownAte || '—'}`,
      `Data: ${this._agora().toISOString()}`,
      correlationId ? `CorrelationId: ${correlationId}` : null
    ].filter(Boolean);
    console.log(linhas.join('\n'));
  }

  logCooldown(dados = {}) {
    this._logNsu({
      correlationId: dados.correlationId,
      nsuLocal: dados.nsuLocal,
      nsuRemoto: dados.nsuRemoto,
      atualizado: Boolean(dados.atualizado),
      motivo: dados.motivo || '656 Consumo Indevido',
      origem: dados.origem || ORIGEM_NSU.AUSENTE,
      cooldownAte: dados.cooldownAte || null
    });
  }

  /** @private */
  async _auditarFallbackXml(dados) {
    try {
      const emitir = this._emitirEvento || require('../utils/centralEventosEmitter').emitirEvento;
      await emitir({
        tipo: TIPOS_EVENTO.NSU_RECOVERED_FROM_XML,
        origem: ORIGENS.SISTEMA,
        descricao: 'NSU obtido via fallback XML (namespace) após parser sem tag.',
        resultado: 'FALLBACK_XML',
        sucesso: true,
        detalhe: {
          categoria: 'NSU_RECOVERED_FROM_XML',
          empresa: dados.empresa,
          cnpj: dados.cnpj,
          ambiente: dados.ambiente,
          nsuRemoto: dados.nsuRemoto,
          maxNsu: dados.maxNsu,
          origemUltNsu: dados.origemUltNsu,
          origemMaxNsu: dados.origemMaxNsu,
          correlationId: dados.correlationId
        }
      });
    } catch (err) {
      console.warn('[NsuRecoveryService] Falha ao registrar NSU_RECOVERED_FROM_XML:', err.message);
    }
  }

  /** @private */
  async _auditar(dados) {
    try {
      const emitir = this._emitirEvento || require('../utils/centralEventosEmitter').emitirEvento;
      await emitir({
        tipo: TIPOS_EVENTO.AUTO_SYNC_NSU,
        origem: ORIGENS.SISTEMA,
        descricao: 'Cursor NSU sincronizado automaticamente após retorno 656.',
        resultado: 'ATUALIZADO',
        sucesso: true,
        detalhe: {
          categoria: 'AUTO_SYNC_NSU',
          empresa: dados.empresa,
          cnpj: dados.cnpj,
          ambiente: dados.ambiente,
          nsuLocal: dados.nsuLocal,
          nsuRemoto: dados.nsuRemoto,
          nsuAtualizado: dados.nsuAtualizado,
          maxNsu: dados.maxNsu,
          origemUltNsu: dados.origemUltNsu,
          origemMaxNsu: dados.origemMaxNsu,
          correlationId: dados.correlationId,
          data: dados.data,
          mensagem: 'Cursor NSU sincronizado automaticamente após retorno 656.'
        }
      });
    } catch (err) {
      console.warn('[NsuRecoveryService] Falha ao registrar auditoria AUTO_SYNC_NSU:', err.message);
    }
  }

  static limparCacheEventos() {
    _eventosProcessados.clear();
  }
}

NsuRecoveryService.nsuNumerico = nsuNumerico;
NsuRecoveryService.ORIGEM_NSU = ORIGEM_NSU;
NsuRecoveryService.extrairNsuTagDoXml = extrairNsuTagDoXml;

module.exports = NsuRecoveryService;
