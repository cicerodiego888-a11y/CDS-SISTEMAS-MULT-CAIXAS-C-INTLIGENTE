/**
 * Diagnóstico / reconciliação read-only do cursor distNSU (Sprint 3).
 * NÃO corrige cursor automaticamente.
 *
 * @module motores/central-entradas/descoberta-nsu/CentralDistNsuDiagnosticoService
 */
'use strict';

const CentralNsuService = require('../services/CentralNsuService');
const CentralDocumentosRepository = require('../repositories/CentralDocumentosRepository');
const { DistNsuStatus, labelDistNsuStatus } = require('./DistNsuStatus');
const { existemDocumentosPosteriores } = require('./DistNsuCursorPolitica');
const { obterDistNsuSyncLock } = require('./DistNsuSyncLock');

class CentralDistNsuDiagnosticoService {
  constructor(deps = {}) {
    this._nsuService = deps.nsuService
      ?? new CentralNsuService({ nsuRepository: deps.nsuRepository });
    this._documentosRepository = deps.documentosRepository
      ?? new CentralDocumentosRepository({ db: deps.db || null });
    this._syncLock = deps.syncLock || obterDistNsuSyncLock();
  }

  /**
   * Painel por CNPJ + ambiente.
   * @param {string} cnpj
   * @param {number} ambiente
   */
  async obterPainel(cnpj, ambiente) {
    const c = String(cnpj || '').replace(/\D/g, '');
    const amb = Number(ambiente) === 1 ? 1 : 2;
    const controle = await this._nsuService.buscarPorCnpjAmbiente(c, amb);
    const cooldown = this._nsuService.avaliarCooldown(controle);
    const syncAtivo = this._syncLock.estaExecutando(c, amb);

    const ult = controle?.ultNsu || null;
    const max = controle?.maxNsu || null;
    const posteriores = existemDocumentosPosteriores(ult, max);

    let status = DistNsuStatus.AGUARDANDO;
    if (syncAtivo) status = DistNsuStatus.SINCRONIZANDO;
    else if (cooldown.ativo) status = DistNsuStatus.BLOQUEADO;
    else if (String(controle?.ultimoCstat) === '656') status = DistNsuStatus.BLOQUEADO;
    else if (String(controle?.ultimoCstat) === '137' && !posteriores) {
      status = DistNsuStatus.SEM_NOVOS_DOCUMENTOS;
    } else if (controle?.ultimoStatusSync === DistNsuStatus.ERRO
      || controle?.ultimoStatusSync === DistNsuStatus.ERRO_PARSER
      || controle?.ultimoStatusSync === DistNsuStatus.ERRO_BANCO) {
      status = controle.ultimoStatusSync;
    } else if (posteriores) {
      status = DistNsuStatus.DOCUMENTOS_POSTERIORES;
    }

    let aguardandoXml = 0;
    try {
      if (typeof this._documentosRepository.contar === 'function') {
        aguardandoXml = await this._documentosRepository.contar({
          status: 'RESUMO_RECEBIDO'
        });
      }
    } catch { /* ignore */ }

    return {
      cnpj: c,
      ambiente: amb,
      ultimoNsuProcessado: ult,
      ultimoMaxNsuConhecido: max,
      ultimaSincronizacao: controle?.dataSincronizacao || controle?.updatedAt || null,
      ultimoRequestId: controle?.ultimoRequestId || null,
      quantidadeDocumentosUltimoLote: Number(controle?.ultimoLoteQtd || 0),
      ultimoCstat: controle?.ultimoCstat || null,
      ultimoXmotivo: controle?.ultimoXmotivo || null,
      status,
      statusLabel: labelDistNsuStatus(status),
      documentosPosterioresDisponiveis: posteriores,
      mensagemPosteriores: posteriores
        ? 'Existem documentos posteriores disponíveis para processamento.'
        : null,
      lacunas: safeParseJson(controle?.lacunasJson),
      cooldownAtivo: Boolean(cooldown.ativo),
      proximaConsultaEm: cooldown.proximaConsultaEm || controle?.cooldownAte || null,
      sincronizacaoEmAndamento: syncAtivo,
      documentosAguardandoXmlCompleto: aguardandoXml,
      // Reconciliação — somente leitura
      reconciliacao: {
        cursorPersistido: ult,
        maxNsuConhecido: max,
        diferencaMaxUlt: posteriores,
        observacao: 'Diagnóstico somente leitura — cursor não é corrigido automaticamente.'
      }
    };
  }
}

function safeParseJson(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

module.exports = CentralDistNsuDiagnosticoService;
