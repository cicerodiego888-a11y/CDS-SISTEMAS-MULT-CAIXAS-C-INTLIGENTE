/**
 * CentralNsuService — Único ponto oficial de atualização de ultNSU/maxNSU (RC3.3.3).
 *
 * Regras:
 * - nunca persistir ultNSU/maxNSU inválidos ou zerados após já haver progresso;
 * - nunca regredir ultNSU;
 * - cStat 656: preserva NSU + cooldown; RC3.7.5.1 pode avançar NSU via NsuRecoveryService
 *   somente quando SEFAZ informar ultNSU/maxNSU maiores que o cursor local;
 * - somente atualiza NSU após resposta DistDFe válida (137/138) com tags presentes
 *   (exceto recuperação automática 656 acima).
 *
 * @module motores/central-entradas/services/CentralNsuService
 */

const CentralNsuRepository = require('../repositories/CentralNsuRepository');
const NsuRecoveryService = require('./NsuRecoveryService');
const {
  NSU_ZERADO,
  normalizarNsu,
  normalizarNsuOuZero,
  extrairNsuTagDoXml
} = require('../../../services/fiscal/dfeRetornoParser');
const { logOperacaoCentral } = require('../utils/centralOperacaoLog');

const INTERVALO_COOLDOWN_MS = 60 * 60 * 1000;
const CSTAT_COM_NSU = new Set(['137', '138']);

function nsuNumerico(valor) {
  const normalizado = normalizarNsuOuZero(valor);
  return BigInt(normalizado.replace(/^0+(?=\d)/, '') || '0');
}

function nsuPresenteNoXml(xml, tag) {
  return extrairNsuTagDoXml(xml, tag) != null;
}

class CentralNsuService {
  /**
   * @param {Object} [deps]
   */
  constructor(deps = {}) {
    this._repository = deps.nsuRepository
      ?? new CentralNsuRepository({ db: deps.db ?? null });
    this._agora = deps.agora || (() => new Date());
    this._recovery = deps.nsuRecovery
      ?? new NsuRecoveryService({
        nsuRepository: this._repository,
        agora: this._agora,
        emitirEvento: deps.emitirEvento
      });
  }

  /** Expõe o repositório para callers que só leem. */
  get repository() {
    return this._repository;
  }

  obterOuCriar(cnpj, ambiente) {
    return this._repository.obterOuCriar(cnpj, ambiente);
  }

  buscarPorCnpjAmbiente(cnpj, ambiente) {
    return this._repository.buscarPorCnpjAmbiente(cnpj, ambiente);
  }

  obterUltimaSincronizacao() {
    return this._repository.obterUltimaSincronizacao();
  }

  /**
   * Aplica retorno DistDFe com regras de hardening.
   *
   * @param {Object} params
   * @param {Object} params.controle Controle atual (id, ultNsu, maxNsu)
   * @param {string} params.cStat
   * @param {string} [params.xmlRetorno]
   * @param {string} [params.ultNsu]
   * @param {string} [params.maxNsu]
   * @param {string} [params.correlationId]
   * @returns {Promise<{ controle: Object, atualizouNsu: boolean, preservado: boolean, cooldownAtivo: boolean, proximaConsultaEm: string|null }>}
   */
  async aplicarRetornoDistDfe(params = {}) {
    const controle = params.controle;
    if (!controle?.id) {
      throw new Error('Controle NSU é obrigatório para aplicar retorno DistDFe.');
    }

    const cStat = String(params.cStat || '');
    const xml = params.xmlRetorno || '';
    const correlationId = params.correlationId || null;
    const agora = this._agora();

    if (cStat === '656') {
      const cooldownAte = new Date(agora.getTime() + INTERVALO_COOLDOWN_MS);
      const cooldownIso = cooldownAte.toISOString();

      // RC3.7.5.1 — recuperação automática se SEFAZ > local (banco restaurado).
      const recuperacao = await this._recovery.tentarRecuperar({
        controle,
        cStat: '656',
        xmlRetorno: xml,
        ultNsu: params.ultNsu,
        maxNsu: params.maxNsu,
        correlationId,
        empresa: params.empresa || params.cnpj || controle.cnpj || null
      });

      const controleBase = recuperacao.controle || controle;
      const atualizado = await this._repository.atualizarSincronizacaoSegura(controleBase.id, {
        preservarNsu: true,
        ultimoCstat: '656',
        cooldownAte: cooldownIso,
        dataSincronizacao: agora.toISOString()
      });

      this._recovery.logCooldown({
        correlationId,
        nsuLocal: recuperacao.nsuLocal || (atualizado || controleBase).ultNsu,
        nsuRemoto: recuperacao.nsuRemoto,
        atualizado: recuperacao.atualizou,
        motivo: recuperacao.atualizou
          ? '656 Consumo Indevido'
          : (recuperacao.motivo || '656 Consumo Indevido'),
        origem: recuperacao.origemUltNsu,
        cooldownAte: cooldownIso
      });

      logOperacaoCentral({
        correlationId,
        operacao: recuperacao.atualizou ? 'NSU_RECUPERAR_656' : 'NSU_PRESERVAR_656',
        nsu: (atualizado || controleBase).ultNsu,
        cStat: '656',
        resultado: recuperacao.atualizou ? 'RECUPERADO' : 'PRESERVADO',
        origem: 'CentralNsuService',
        detalhe: {
          nsuLocal: recuperacao.nsuLocal,
          nsuRemoto: recuperacao.nsuRemoto,
          motivo: recuperacao.motivo,
          cooldownAte: cooldownIso
        }
      });

      return {
        controle: atualizado || controleBase,
        atualizouNsu: Boolean(recuperacao.atualizou),
        preservado: !recuperacao.atualizou,
        recuperacaoNsu: recuperacao,
        cooldownAtivo: true,
        proximaConsultaEm: cooldownIso,
        ultNsu: (atualizado || controleBase).ultNsu,
        maxNsu: (atualizado || controleBase).maxNsu
      };
    }

    const temUlt = nsuPresenteNoXml(xml, 'ultNSU') || Boolean(params.ultNsuRaw) || params.ultNsu != null;
    const temMax = nsuPresenteNoXml(xml, 'maxNSU') || Boolean(params.maxNsuRaw) || params.maxNsu != null;
    const candidataUlt = normalizarNsu(params.ultNsu) || extrairNsuTagDoXml(xml, 'ultNSU');
    const candidataMax = normalizarNsu(params.maxNsu) || extrairNsuTagDoXml(xml, 'maxNSU');
    const atualUlt = normalizarNsuOuZero(controle.ultNsu);
    const atualMax = normalizarNsuOuZero(controle.maxNsu);

    if (!CSTAT_COM_NSU.has(cStat) || !temUlt || !temMax || !candidataUlt || !candidataMax) {
      const atualizado = await this._repository.atualizarSincronizacaoSegura(controle.id, {
        preservarNsu: true,
        ultimoCstat: cStat || null,
        dataSincronizacao: agora.toISOString()
      });
      return {
        controle: atualizado || controle,
        atualizouNsu: false,
        preservado: true,
        cooldownAtivo: false,
        proximaConsultaEm: null,
        ultNsu: atualUlt,
        maxNsu: atualMax
      };
    }

    // Nunca regredir: só avança se novo ult >= atual.
    if (nsuNumerico(candidataUlt) < nsuNumerico(atualUlt)) {
      const atualizado = await this._repository.atualizarSincronizacaoSegura(controle.id, {
        preservarNsu: true,
        ultimoCstat: cStat,
        dataSincronizacao: agora.toISOString()
      });
      logOperacaoCentral({
        correlationId,
        operacao: 'NSU_REJEITAR_REGRESSAO',
        nsu: atualUlt,
        cStat,
        resultado: 'PRESERVADO',
        origem: 'CentralNsuService',
        detalhe: { candidataUlt, candidataMax }
      });
      return {
        controle: atualizado || controle,
        atualizouNsu: false,
        preservado: true,
        cooldownAtivo: false,
        proximaConsultaEm: null,
        ultNsu: atualUlt,
        maxNsu: atualMax
      };
    }

    // Evita gravar zeros após progresso real.
    if (
      candidataUlt === NSU_ZERADO
      && atualUlt !== NSU_ZERADO
    ) {
      const atualizado = await this._repository.atualizarSincronizacaoSegura(controle.id, {
        preservarNsu: true,
        ultimoCstat: cStat,
        dataSincronizacao: agora.toISOString()
      });
      return {
        controle: atualizado || controle,
        atualizouNsu: false,
        preservado: true,
        cooldownAtivo: false,
        proximaConsultaEm: null,
        ultNsu: atualUlt,
        maxNsu: atualMax
      };
    }

    const atualizado = await this._repository.atualizarSincronizacaoSegura(controle.id, {
      ultNsu: candidataUlt,
      maxNsu: candidataMax,
      ultimoCstat: cStat,
      cooldownAte: null,
      dataSincronizacao: agora.toISOString()
    });

    logOperacaoCentral({
      correlationId,
      operacao: 'NSU_ATUALIZAR',
      nsu: candidataUlt,
      cStat,
      resultado: 'OK',
      origem: 'CentralNsuService',
      detalhe: { maxNsu: candidataMax }
    });

    return {
      controle: atualizado,
      atualizouNsu: true,
      preservado: false,
      cooldownAtivo: false,
      proximaConsultaEm: null,
      ultNsu: candidataUlt,
      maxNsu: candidataMax
    };
  }

  /**
   * @param {Object|null} controle
   * @returns {{ ativo: boolean, proximaConsultaEm?: string, motivo?: string, ultNsu?: string, maxNsu?: string }}
   */
  avaliarCooldown(controle) {
    if (!controle) return { ativo: false };

    const agora = this._agora().getTime();
    if (controle.cooldownAte) {
      const ate = new Date(controle.cooldownAte).getTime();
      if (!Number.isNaN(ate) && agora < ate) {
        return {
          ativo: true,
          motivo: 'COOLDOWN_EXPLICITO',
          proximaConsultaEm: new Date(ate).toISOString(),
          ultNsu: controle.ultNsu,
          maxNsu: controle.maxNsu
        };
      }
    }

    if (
      controle.dataSincronizacao
      && String(controle.ultNsu || '') === String(controle.maxNsu || '')
    ) {
      const ultima = new Date(controle.dataSincronizacao).getTime();
      if (!Number.isNaN(ultima)) {
        const proxima = ultima + INTERVALO_COOLDOWN_MS;
        if (agora < proxima) {
          return {
            ativo: true,
            motivo: 'FILA_ESGOTADA',
            proximaConsultaEm: new Date(proxima).toISOString(),
            ultNsu: controle.ultNsu,
            maxNsu: controle.maxNsu
          };
        }
      }
    }

    return { ativo: false, ultNsu: controle.ultNsu, maxNsu: controle.maxNsu };
  }
}

CentralNsuService.INTERVALO_COOLDOWN_MS = INTERVALO_COOLDOWN_MS;
CentralNsuService.nsuPresenteNoXml = nsuPresenteNoXml;
CentralNsuService.nsuNumerico = nsuNumerico;

module.exports = CentralNsuService;
