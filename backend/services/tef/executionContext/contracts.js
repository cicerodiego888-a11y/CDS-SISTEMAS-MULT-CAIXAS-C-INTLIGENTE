'use strict';

/**
 * MRT-05 — Contrato ExecutionContext (topologias e identidade física × comercial).
 *
 * Separação obrigatória:
 * - pdvId          → identidade comercial (terminais.id)
 * - terminalTefId  → terminal lógico do provedor
 * - dispositivoId  → PinPad / dispositivo físico
 * - estacao.*      → hostname/MAC da máquina de execução (≠ pdvId)
 */

const TOPOLOGIES = Object.freeze({
  /** Um computador / um PDV. */
  ESTACAO_UNICA_PDV_UNICO: 'ESTACAO_UNICA_PDV_UNICO',
  /** Um computador / vários PDVs (concorrência limitada pelo Allocator). */
  ESTACAO_UNICA_MULTI_PDV: 'ESTACAO_UNICA_MULTI_PDV',
  /** Vários computadores / PDVs independentes. */
  MULTI_ESTACAO: 'MULTI_ESTACAO',
  /** Sem evidência suficiente (ex. singleton sem mapa). */
  DESCONHECIDA: 'DESCONHECIDA'
});

const LOCALIDADE_EXECUCAO = Object.freeze({
  LOCAL: 'LOCAL',
  REMOTA_REQUERIDA: 'REMOTA_REQUERIDA',
  INDETERMINADA: 'INDETERMINADA'
});

const EXEC_CODES = Object.freeze({
  EXEC_OK: 'EXEC_OK',
  ESTACAO_NAO_VINCULADA: 'ESTACAO_NAO_VINCULADA',
  ESTACAO_REMOTA_NAO_SUPORTADA: 'ESTACAO_REMOTA_NAO_SUPORTADA',
  DISPOSITIVO_INDISPONIVEL: 'DISPOSITIVO_INDISPONIVEL',
  TERMINAL_SEM_DISPOSITIVO: 'TERMINAL_SEM_DISPOSITIVO',
  TOPOLOGIA_INCOMPATIVEL_PROVEDOR: 'TOPOLOGIA_INCOMPATIVEL_PROVEDOR',
  HOSTNAME_MAC_NAO_SAO_PDV: 'HOSTNAME_MAC_NAO_SAO_PDV',
  EXEC_INDETERMINADO: 'EXEC_INDETERMINADO'
});

/**
 * Matriz de compatibilidade provedor × topologia (sem inventar multi-terminal Destaxa).
 */
const PROVIDER_TOPOLOGY_MATRIX = Object.freeze({
  destaxa: Object.freeze({
    provedor: 'destaxa',
    runtimeSingleton: true,
    isolamento: 'GLOBAL_SERIALIZE',
    runtimeKey: 'runtime:destaxa:global',
    topologias: {
      [TOPOLOGIES.ESTACAO_UNICA_PDV_UNICO]: {
        suportado: true,
        execucao: 'LOCAL_NATIVE_HOST',
        pagamentosSimultaneos: false
      },
      [TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV]: {
        suportado: true,
        execucao: 'LOCAL_NATIVE_HOST_SERIALIZADO',
        pagamentosSimultaneos: false,
        nota: 'Allocator GLOBAL_SERIALIZE — um lease por vez na estação'
      },
      [TOPOLOGIES.MULTI_ESTACAO]: {
        suportado: false,
        execucao: 'REQUER_COMUNICACAO_ENTRE_PCS',
        pagamentosSimultaneos: false,
        nota: 'Native Host / V$Pague por hostname-MAC; remote-future fora do escopo'
      }
    }
  }),
  sitef: Object.freeze({
    provedor: 'sitef',
    runtimeSingleton: false,
    isolamento: 'PER_TERMINAL',
    runtimeKey: null,
    topologias: {
      [TOPOLOGIES.ESTACAO_UNICA_PDV_UNICO]: { suportado: true, execucao: 'LOCAL', pagamentosSimultaneos: false },
      [TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV]: {
        suportado: true,
        execucao: 'LOCAL_POR_TERMINAL',
        pagamentosSimultaneos: false,
        nota: 'Paralelo só se Allocator PER_TERMINAL e evidência SDK — não liberado nesta sprint'
      },
      [TOPOLOGIES.MULTI_ESTACAO]: {
        suportado: 'parcial',
        execucao: 'LOCAL_POR_ESTACAO',
        pagamentosSimultaneos: false,
        nota: 'Cada PC precisa do próprio runtime/SDK; sem bridge remota CDS'
      }
    }
  }),
  paygo: Object.freeze({
    provedor: 'paygo',
    runtimeSingleton: false,
    isolamento: 'PER_TERMINAL',
    runtimeKey: null,
    topologias: {
      [TOPOLOGIES.ESTACAO_UNICA_PDV_UNICO]: { suportado: true, execucao: 'LOCAL', pagamentosSimultaneos: false },
      [TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV]: {
        suportado: true,
        execucao: 'LOCAL_POR_TERMINAL',
        pagamentosSimultaneos: false
      },
      [TOPOLOGIES.MULTI_ESTACAO]: {
        suportado: 'parcial',
        execucao: 'LOCAL_POR_ESTACAO',
        pagamentosSimultaneos: false
      }
    }
  }),
  default: Object.freeze({
    provedor: 'default',
    runtimeSingleton: false,
    isolamento: 'PER_TERMINAL',
    runtimeKey: null,
    topologias: {
      [TOPOLOGIES.ESTACAO_UNICA_PDV_UNICO]: { suportado: true, execucao: 'LOCAL', pagamentosSimultaneos: false },
      [TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV]: { suportado: true, execucao: 'LOCAL_POR_TERMINAL', pagamentosSimultaneos: false },
      [TOPOLOGIES.MULTI_ESTACAO]: { suportado: 'parcial', execucao: 'LOCAL_POR_ESTACAO', pagamentosSimultaneos: false }
    }
  })
});

function matrizProvedor(provedor) {
  const p = String(provedor || '').toLowerCase();
  return PROVIDER_TOPOLOGY_MATRIX[p] || PROVIDER_TOPOLOGY_MATRIX.default;
}

function normalizarHost(v) {
  if (v == null || v === '') return null;
  return String(v).trim().toLowerCase();
}

function normalizarMac(v) {
  if (v == null || v === '') return null;
  const hex = String(v).replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  return hex.length === 12 ? hex : String(v).trim().toUpperCase();
}

function chaveEstacao({ hostname, mac } = {}) {
  const macN = normalizarMac(mac);
  if (macN) return `mac:${macN}`;
  const host = normalizarHost(hostname);
  if (host) return `host:${host}`;
  return null;
}

/**
 * @typedef {object} ExecutionContext
 */
function criarExecutionContext(parcial = {}) {
  const estacao = parcial.estacao || {};
  return {
    topologia: parcial.topologia || TOPOLOGIES.DESCONHECIDA,
    pdvId: parcial.pdvId != null ? String(parcial.pdvId) : null,
    terminalTefId: parcial.terminalTefId != null ? String(parcial.terminalTefId) : null,
    dispositivoId: parcial.dispositivoId != null ? String(parcial.dispositivoId) : null,
    estacao: {
      id: estacao.id || chaveEstacao(estacao) || null,
      hostname: estacao.hostname != null ? String(estacao.hostname) : null,
      mac: estacao.mac != null ? String(estacao.mac) : null,
      local: estacao.local === true,
      origem: estacao.origem || null,
      identidadeEhPdv: false,
      identidadeEhTerminalTef: false
    },
    localidadeExecucao: parcial.localidadeExecucao || LOCALIDADE_EXECUCAO.INDETERMINADA,
    runtime: parcial.runtime || {
      provedor: null,
      isolamento: null,
      runtimeKey: null,
      singletonDestaxa: false
    },
    dispositivo: parcial.dispositivo || {
      presente: false,
      disponivel: null,
      motivo: null,
      codigo: null
    },
    codigo: parcial.codigo || EXEC_CODES.EXEC_INDETERMINADO,
    mensagem: parcial.mensagem || '',
    limitacoes: Array.isArray(parcial.limitacoes) ? parcial.limitacoes : [],
    compatibilidade: parcial.compatibilidade || null,
    identidades: {
      comercial: 'pdvId = terminais.id',
      terminalLogico: 'terminalTefId',
      dispositivoFisico: 'dispositivoId',
      estacaoExecucao: 'hostname/MAC — nunca pdvId',
      ...(parcial.identidades || {})
    },
    meta: parcial.meta || null
  };
}

module.exports = {
  TOPOLOGIES,
  LOCALIDADE_EXECUCAO,
  EXEC_CODES,
  PROVIDER_TOPOLOGY_MATRIX,
  matrizProvedor,
  normalizarHost,
  normalizarMac,
  chaveEstacao,
  criarExecutionContext
};
