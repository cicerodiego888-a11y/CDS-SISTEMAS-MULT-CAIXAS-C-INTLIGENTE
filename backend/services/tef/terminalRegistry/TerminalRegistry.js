'use strict';

/**
 * CDS TEF Terminal Registry — MRT-03
 *
 * Consulta e resolução lógica de TerminalTEF por PDV.
 * Não aloca, não inicia pagamento, não chama DLL/INIT.
 * Sem cadastro no Registry → MISS (Router usa singleton fallback).
 */

const {
  TERMINAL_STATES,
  REGISTRY_CODES,
  criarTerminalTef
} = require('./contracts');
const { criarMemoryStore } = require('./memoryStore');
const { projetarVisaoSingleton } = require('./projetarDeSingleton');

function texto(v) {
  return v == null ? '' : String(v).trim();
}

class TerminalRegistry {
  constructor(opcoes = {}) {
    this._store = opcoes.store || criarMemoryStore(opcoes.sementes || []);
    this._projetarSingleton = opcoes.projetarVisaoSingleton || projetarVisaoSingleton;
    this._depsProjecao = opcoes.projecaoDeps || {};
  }

  /** Cadastro lógico em memória (testes / futuro sync). Não grava banco oficial. */
  registrar(terminal) {
    return this._store.upsert(terminal);
  }

  remover(terminalId) {
    return this._store.remove(terminalId);
  }

  listarTodos() {
    return this._store.listAll();
  }

  listarPorPdv(pdvId) {
    if (pdvId == null || pdvId === '') return [];
    return this._store.listByPdv(pdvId);
  }

  obterPorId(terminalId) {
    return this._store.getById(terminalId);
  }

  /**
   * Visão read-only do singleton atual (separação lógico × físico).
   */
  async consultarProjecaoSingleton() {
    return this._projetarSingleton(this._depsProjecao);
  }

  /**
   * Resolve terminal TEF para um PDV validado.
   * @returns {Promise<object>} resultado tipado REGISTRY_*
   */
  async resolverPorPdv(contexto = {}) {
    const pdvId = texto(contexto.pdvId);
    if (!pdvId) {
      return {
        ok: false,
        codigo: REGISTRY_CODES.REGISTRY_MISS,
        mensagem: 'pdvId ausente — Registry não aplica; usar singleton fallback',
        terminal: null,
        candidatos: [],
        ambíguo: false
      };
    }

    const empresaId = texto(contexto.empresaId);
    const lojaId = texto(contexto.lojaId);
    const provedorPreferido = texto(contexto.provedorPreferido).toLowerCase();

    let candidatos = this._store.listByPdv(pdvId);

    if (empresaId) {
      const filtrados = candidatos.filter((t) => !t.empresaId || t.empresaId === empresaId);
      if (candidatos.length && filtrados.length === 0) {
        return {
          ok: false,
          codigo: REGISTRY_CODES.EMPRESA_LOJA_INCOMPATIVEL,
          mensagem: `Nenhum terminal TEF do PDV ${pdvId} compatível com empresaId=${empresaId}`,
          terminal: null,
          candidatos,
          ambíguo: false
        };
      }
      candidatos = filtrados;
    }

    if (lojaId) {
      const filtrados = candidatos.filter((t) => !t.lojaId || t.lojaId === lojaId);
      if (candidatos.length && filtrados.length === 0) {
        return {
          ok: false,
          codigo: REGISTRY_CODES.EMPRESA_LOJA_INCOMPATIVEL,
          mensagem: `Nenhum terminal TEF do PDV ${pdvId} compatível com lojaId=${lojaId}`,
          terminal: null,
          candidatos,
          ambíguo: false
        };
      }
      candidatos = filtrados;
    }

    if (candidatos.length === 0) {
      return {
        ok: false,
        codigo: REGISTRY_CODES.REGISTRY_MISS,
        mensagem: `PDV ${pdvId} sem terminal TEF associado no Registry — fallback singleton`,
        terminal: null,
        candidatos: [],
        ambíguo: false
      };
    }

    if (provedorPreferido) {
      const porProvedor = candidatos.filter(
        (t) => t.provedor === provedorPreferido
          || (t.provedoresAlternativos || []).includes(provedorPreferido)
      );
      if (porProvedor.length) candidatos = porProvedor;
    }

    const ativos = candidatos.filter((t) => t.estado === TERMINAL_STATES.ATIVO);

    if (ativos.length > 1) {
      return {
        ok: false,
        codigo: REGISTRY_CODES.TERMINAL_AMBIGUO,
        mensagem: `Seleção ambígua: PDV ${pdvId} possui ${ativos.length} terminais TEF ativos`,
        terminal: null,
        candidatos: ativos,
        ambíguo: true
      };
    }

    if (ativos.length === 1) {
      const terminal = ativos[0];
      return {
        ok: true,
        codigo: REGISTRY_CODES.REGISTRY_HIT,
        mensagem: 'Terminal TEF resolvido pelo Registry',
        terminal,
        candidatos: ativos,
        ambíguo: false,
        dispositivo: terminal.dispositivo || null,
        separacao: {
          terminalLogicoId: terminal.id,
          codigoLogicoProvedor: terminal.codigoLogicoProvedor,
          dispositivoId: terminal.dispositivo?.id || null,
          portaCom: terminal.dispositivo?.portaCom || null,
          pdvId: terminal.pdvId,
          hostnameNaoUsadoComoPdv: true
        }
      };
    }

    // Sem ATIVO: reportar o estado mais específico do primeiro candidato
    const primeiro = candidatos[0];
    if (primeiro.estado === TERMINAL_STATES.INATIVO) {
      return {
        ok: false,
        codigo: REGISTRY_CODES.TERMINAL_INATIVO,
        mensagem: `Terminal TEF inativo para PDV ${pdvId}`,
        terminal: primeiro,
        candidatos,
        ambíguo: false
      };
    }
    if (primeiro.estado === TERMINAL_STATES.INDISPONIVEL) {
      return {
        ok: false,
        codigo: REGISTRY_CODES.TERMINAL_INDISPONIVEL,
        mensagem: `Terminal TEF indisponível para PDV ${pdvId}`,
        terminal: primeiro,
        candidatos,
        ambíguo: false
      };
    }
    return {
      ok: false,
      codigo: REGISTRY_CODES.TERMINAL_NAO_PROVISIONADO,
      mensagem: `Terminal TEF não provisionado para PDV ${pdvId}`,
      terminal: primeiro,
      candidatos,
      ambíguo: false
    };
  }

  /**
   * Monta adapterBinding a partir de um TerminalTef + opcional singleton base.
   */
  montarBinding(terminal, singletonBinding = null) {
    if (!terminal) return null;
    const base = singletonBinding?.registro || {};
    const registro = {
      ...base,
      ...(terminal.adapterRegistro || {}),
      provedor: terminal.provedor || base.provedor,
      ambiente: terminal.ambiente || base.ambiente,
      terminal_codigo: terminal.codigoLogicoProvedor || base.terminal_codigo,
      empresa_codigo: terminal.empresaId || base.empresa_codigo,
      loja_codigo: terminal.lojaId || base.loja_codigo,
      portaCom: terminal.dispositivo?.portaCom || base.portaCom || base.porta_com || null,
      porta_com: terminal.dispositivo?.portaCom || base.porta_com || base.portaCom || null
    };
    return {
      fonte: 'tef_terminal_registry',
      modo: 'REGISTRY_RESOLVE',
      registro,
      executionMode: String(registro.provedor || '').toLowerCase() === 'destaxa'
        ? 'native-host'
        : 'adapter-default',
      terminalTefId: terminal.id,
      dispositivoId: terminal.dispositivo?.id || null,
      pinpadPortaCom: terminal.dispositivo?.portaCom || null,
      estadoTerminal: terminal.estado
    };
  }
}

function criarTerminalRegistry(opcoes = {}) {
  return new TerminalRegistry(opcoes);
}

let compartilhado = null;
function obterTerminalRegistry() {
  if (!compartilhado) compartilhado = criarTerminalRegistry();
  return compartilhado;
}

function resetTerminalRegistryParaTestes() {
  if (compartilhado) compartilhado._store.clear();
  compartilhado = null;
}

module.exports = {
  TerminalRegistry,
  criarTerminalRegistry,
  obterTerminalRegistry,
  resetTerminalRegistryParaTestes,
  criarTerminalTef
};
