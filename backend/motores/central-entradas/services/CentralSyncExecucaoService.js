/**
 * CentralSyncExecucaoService — Execução de sincronização com mutex único (RC3.3.3).
 *
 * Proteção:
 * - nunca duas DistDFe simultâneas no processo;
 * - `forcar` ignora apenas cooldown/horário, NÃO o mutex;
 * - ciclo-dfe / diagnóstico devem usar `comLockDistDfe`.
 *
 * @class CentralSyncExecucaoService
 */

const CentralSincronizacaoService = require('./CentralSincronizacaoService');
const CentralConfiguracaoService = require('./CentralConfiguracaoService');
const CentralNotificacoesService = require('./CentralNotificacoesService');
const CentralNsuRepository = require('../repositories/CentralNsuRepository');
const CentralNsuService = require('./CentralNsuService');
const { TIPOS_EVENTO, ORIGENS } = require('../config/centralEventosTipos');
const { emitirEvento } = require('../utils/centralEventosEmitter');
const { logCentral, logCentralErro } = require('../utils/centralLog');
const { criarCorrelationId, logOperacaoCentral } = require('../utils/centralOperacaoLog');
const SincronizacaoResultadoDTO = require('../contracts/SincronizacaoResultadoDTO');

class CentralSyncExecucaoService {
  constructor(deps = {}) {
    this._nsuRepository = deps.nsuRepository ?? new CentralNsuRepository({ db: deps.db ?? null });
    this._nsuService = deps.nsuService
      ?? new CentralNsuService({ nsuRepository: this._nsuRepository });
    this._sincronizacao = deps.sincronizacaoService ?? new CentralSincronizacaoService({
      nsuRepository: this._nsuRepository,
      nsuService: this._nsuService,
      configuracaoService: deps.configuracaoService ?? deps.configService
    });
    this._config = deps.configuracaoService
      ?? deps.configService
      ?? new CentralConfiguracaoService();
    this._notificacoes = deps.notificacoesService ?? new CentralNotificacoesService();
    this._emitirEvento = deps.emitirEvento || emitirEvento;
    this._executando = false;
    this._lockDono = null;
    this._ultimaExecucao = null;
    this._proximaExecucao = null;
    this._ultimoResultado = null;
  }

  estaExecutando() {
    return this._executando;
  }

  definirProximaExecucao(data) {
    this._proximaExecucao = data;
  }

  obterEstado() {
    return {
      executando: this._executando,
      lockDono: this._lockDono,
      ultimaExecucao: this._ultimaExecucao,
      proximaExecucao: this._proximaExecucao,
      ultimoResultado: this._ultimoResultado
    };
  }

  /**
   * Mutex único para qualquer DistDFe (sync, ciclo-dfe, diagnóstico).
   * @param {string} dono
   * @param {Function} fn
   * @returns {Promise<*>}
   */
  async comLockDistDfe(dono, fn) {
    if (this._executando) {
      return {
        sucesso: false,
        ignorado: true,
        codigo: 'SYNC_EM_ANDAMENTO',
        mensagem: `Sincronização já em andamento (${this._lockDono || 'desconhecido'})`,
        erros: ['Sincronização já em andamento']
      };
    }

    this._executando = true;
    this._lockDono = dono || 'dist-dfe';
    try {
      return await fn();
    } finally {
      this._executando = false;
      this._lockDono = null;
    }
  }

  /**
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async executar(opcoes = {}) {
    const origem = opcoes.origem || ORIGENS.MANUAL;
    const ignorarHorario = Boolean(opcoes.ignorarHorario);
    const forcar = Boolean(opcoes.forcar);
    const usuarioId = opcoes.usuarioId ?? null;
    const correlationId = opcoes.correlationId || criarCorrelationId();

    // RC7.4.2 — Gate operacional único (656/593). forcar NÃO bypassa.
    if (opcoes.ignorarBloqueio656 !== true) {
      try {
        const gate = require('./CentralSefazOperationalGate');
        const auth = await gate.autorizarConsultaDistDfe({
          correlationId,
          origem,
          forcar: forcar,
          forcarAdminConfirmado: opcoes.forcarAdminConfirmado === true,
          confirmacaoAdmin: opcoes.confirmacaoAdmin === true,
          motivo: 'Aguardando liberação da SEFAZ'
        });
        if (!auth.permitido) {
          return {
            ...auth,
            origem,
            correlationId
          };
        }
      } catch { /* ignore */ }
    }

    if (!forcar && opcoes.ignorarCooldown !== true) {
      const cooldown = await this._verificarCooldownDfe();
      if (cooldown.ativo) {
        return {
          sucesso: true,
          ignorado: true,
          codigo: 'AGUARDAR_JANELA_DFE',
          mensagem: 'Consulta DF-e adiada para respeitar a janela de 1 hora da NT 2014.002.',
          proximaConsultaEm: cooldown.proximaConsultaEm,
          ultNsu: cooldown.ultNsu,
          maxNsu: cooldown.maxNsu,
          correlationId
        };
      }
    }

    if (!ignorarHorario && origem === ORIGENS.BACKGROUND) {
      const horario = await this._config.verificarHorarioPermitido();
      if (!horario.permitido) {
        return {
          sucesso: false,
          ignorado: true,
          mensagem: horario.motivo,
          erros: [horario.motivo],
          correlationId
        };
      }
    }

    return this.comLockDistDfe(`sync:${origem}`, async () => {
      const inicio = Date.now();
      this._ultimaExecucao = new Date().toISOString();

      logOperacaoCentral({
        correlationId,
        operacao: 'SYNC_DFE',
        origem,
        resultado: 'INICIO',
        area: 'SYNC'
      });

      await this._emitirEvento({
        tipo: TIPOS_EVENTO.SYNC_INICIADA,
        origem,
        descricao: 'Sincronização SEFAZ iniciada',
        resultado: 'em_andamento',
        sucesso: null,
        usuarioId,
        detalhe: { correlationId }
      });

      try {
        const cfg = await this._config.obterResumo();
        const maxIteracoes = Math.max(1, Math.min(200, opcoes.maxIteracoes ?? cfg.syncMaxDocumentos ?? 50));

        const resultado = await this._sincronizacao.sincronizar({
          maxIteracoes,
          correlationId
        });

        const duracaoMs = Date.now() - inicio;
        this._ultimoResultado = resultado;

        if (String(resultado.cStat) === '656' || String(resultado.cStat) === '593') {
          try {
            await require('./CentralSefazOperationalGate').processarRespostaSefaz(resultado, {
              correlationId,
              nsu: resultado.ultNsu || null
            });
            resultado.gateProcessado = true;
          } catch { /* ignore */ }
        } else if (resultado.cStat) {
          try {
            await require('./CentralSefazOperationalGate').processarRespostaSefaz(resultado, {
              correlationId,
              nsu: resultado.ultNsu || null
            });
            resultado.gateProcessado = true;
          } catch { /* ignore */ }
        }

        await this._emitirEvento({
          tipo: resultado.sucesso ? TIPOS_EVENTO.SYNC_CONCLUIDA : TIPOS_EVENTO.SYNC_ERRO,
          origem,
          descricao: resultado.mensagem || (resultado.sucesso ? 'Sincronização concluída' : 'Falha na sincronização'),
          resultado: resultado.sucesso ? 'sucesso' : 'erro',
          sucesso: resultado.sucesso,
          notasNovas: resultado.notasNovas || 0,
          notasDuplicadas: resultado.notasDuplicadas || 0,
          duracaoMs,
          usuarioId,
          detalhe: {
            correlationId,
            notasNovas: resultado.notasNovas || 0,
            notasDuplicadas: resultado.notasDuplicadas || 0,
            cStat: resultado.cStat || null,
            ultNsu: resultado.ultNsu || null,
            maxNsu: resultado.maxNsu || null
          }
        });

        const cfgNotif = await this._config.obterResumo();
        await this._notificacoes.notificarSyncConcluida({
          notasNovas: resultado.notasNovas || 0,
          sucesso: resultado.sucesso,
          mensagem: resultado.mensagem,
          origem,
          notificarNovas: cfgNotif.notificarNovasNotas
        });

        logOperacaoCentral({
          correlationId,
          operacao: 'SYNC_DFE',
          nsu: resultado.ultNsu,
          cStat: resultado.cStat,
          tempoMs: duracaoMs,
          resultado: resultado.sucesso ? 'OK' : 'ERRO',
          origem,
          area: 'SYNC'
        });

        return { ...resultado, duracaoMs, origem, correlationId };
      } catch (error) {
        const duracaoMs = Date.now() - inicio;
        const falha = SincronizacaoResultadoDTO.create({
          sucesso: false,
          erros: [error.message]
        }).toJSON();

        this._ultimoResultado = falha;
        logCentralErro('SYNC', error, { origem, duracaoMs, correlationId });

        await this._emitirEvento({
          tipo: TIPOS_EVENTO.SYNC_ERRO,
          origem,
          descricao: error.message,
          resultado: 'erro',
          sucesso: false,
          duracaoMs,
          usuarioId,
          detalhe: { erro: error.message, correlationId }
        });

        await this._notificacoes.notificarSyncConcluida({
          sucesso: false,
          mensagem: error.message,
          origem,
          notasNovas: 0
        });

        return { ...falha, duracaoMs, origem, correlationId };
      }
    });
  }

  /** @private */
  async _verificarCooldownDfe() {
    try {
      const contexto = await this._config.obterContextoOperacional();
      if (!contexto.ok) return { ativo: false };

      const ambiente = Number(contexto.contexto.ambiente) === 1 ? 1 : 2;
      const controle = await this._nsuService.buscarPorCnpjAmbiente(
        contexto.contexto.cnpj,
        ambiente
      );
      return this._nsuService.avaliarCooldown(controle);
    } catch {
      return { ativo: false };
    }
  }
}

module.exports = new CentralSyncExecucaoService();
module.exports.CentralSyncExecucaoService = CentralSyncExecucaoService;
