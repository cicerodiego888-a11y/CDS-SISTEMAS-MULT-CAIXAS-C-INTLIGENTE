'use strict';

/**
 * MRT-05 — Resolve topologia e ExecutionContext a partir de PDV / Registry / hostHints.
 * Não inicia pagamento, não chama DLL/INIT, não substitui Allocator (MRT-04).
 */

const {
  TOPOLOGIES,
  LOCALIDADE_EXECUCAO,
  EXEC_CODES,
  matrizProvedor,
  normalizarHost,
  normalizarMac,
  chaveEstacao,
  criarExecutionContext
} = require('./contracts');

function inferirTopologia(mapaPdvEstacao = [], pdvIdAtual = null) {
  const chaves = new Set();
  const porEstacao = new Map();

  for (const item of mapaPdvEstacao) {
    const chave = item.estacaoId
      || chaveEstacao({ hostname: item.hostname, mac: item.mac });
    if (!chave) continue;
    chaves.add(chave);
    if (!porEstacao.has(chave)) porEstacao.set(chave, new Set());
    if (item.pdvId != null) porEstacao.get(chave).add(String(item.pdvId));
  }

  if (chaves.size === 0) {
    return {
      topologia: TOPOLOGIES.DESCONHECIDA,
      estacoesDistintas: 0,
      pdvsNaEstacaoAtual: pdvIdAtual ? 1 : 0
    };
  }

  if (chaves.size > 1) {
    return {
      topologia: TOPOLOGIES.MULTI_ESTACAO,
      estacoesDistintas: chaves.size,
      pdvsNaEstacaoAtual: null
    };
  }

  const unica = [...chaves][0];
  const pdvs = porEstacao.get(unica) || new Set();
  if (pdvs.size > 1) {
    return {
      topologia: TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV,
      estacoesDistintas: 1,
      pdvsNaEstacaoAtual: pdvs.size
    };
  }

  return {
    topologia: TOPOLOGIES.ESTACAO_UNICA_PDV_UNICO,
    estacoesDistintas: 1,
    pdvsNaEstacaoAtual: pdvs.size || (pdvIdAtual ? 1 : 0)
  };
}

function avaliarDispositivo(dispositivo) {
  if (!dispositivo || !dispositivo.id) {
    return {
      presente: false,
      disponivel: false,
      motivo: 'Terminal lógico sem dispositivo físico vinculado',
      codigo: EXEC_CODES.TERMINAL_SEM_DISPOSITIVO
    };
  }
  if (dispositivo.ativo === false) {
    return {
      presente: true,
      disponivel: false,
      motivo: 'Dispositivo físico marcado inativo/indisponível',
      codigo: EXEC_CODES.DISPOSITIVO_INDISPONIVEL
    };
  }
  return {
    presente: true,
    disponivel: true,
    motivo: null,
    codigo: null
  };
}

function compararEstacaoLocal(estacaoPdv, hostHints = {}) {
  const hintHost = normalizarHost(hostHints.hostname);
  const hintMac = normalizarMac(hostHints.mac);
  const pdvHost = normalizarHost(estacaoPdv?.hostname);
  const pdvMac = normalizarMac(estacaoPdv?.mac);

  if (!hintHost && !hintMac) {
    return { local: null, motivo: 'hostHints ausentes — localidade indeterminada' };
  }
  if (!pdvHost && !pdvMac) {
    return { local: null, motivo: 'PDV sem hostname/MAC de estação vinculada' };
  }

  if (hintMac && pdvMac && hintMac === pdvMac) {
    return { local: true, motivo: 'MAC da estação coincide com hostHints' };
  }
  if (hintHost && pdvHost && hintHost === pdvHost) {
    return { local: true, motivo: 'hostname da estação coincide com hostHints' };
  }
  if ((hintHost || hintMac) && (pdvHost || pdvMac)) {
    return { local: false, motivo: 'Estação do PDV difere da estação local (hostHints)' };
  }
  return { local: null, motivo: 'Comparação incompleta' };
}

class ExecutionContextResolver {
  constructor(opcoes = {}) {
    this._mapaPadrao = Array.isArray(opcoes.mapaPdvEstacao) ? opcoes.mapaPdvEstacao : [];
  }

  /**
   * @param {object} entrada
   * @param {string|null} [entrada.pdvId]
   * @param {object|null} [entrada.pdv] - do identity validator (hostname metadado)
   * @param {object} [entrada.hostHints]
   * @param {string|null} [entrada.terminalTefId]
   * @param {object|null} [entrada.dispositivo]
   * @param {string|null} [entrada.provedor]
   * @param {Array} [entrada.mapaPdvEstacao]
   * @param {boolean} [entrada.exigirExecucaoLocal]
   * @param {boolean} [entrada.exigirDispositivo]
   */
  resolver(entrada = {}) {
    const pdvId = entrada.pdvId != null ? String(entrada.pdvId) : null;
    const hostHints = entrada.hostHints || {};
    const mapa = (entrada.mapaPdvEstacao && entrada.mapaPdvEstacao.length)
      ? entrada.mapaPdvEstacao
      : this._mapaPadrao;

    const estacaoPdv = {
      hostname: entrada.pdv?.hostname
        || entrada.estacaoHostname
        || entrada.dispositivo?.estacaoHostname
        || null,
      mac: entrada.pdv?.mac || entrada.estacaoMac || null
    };

    const mapaEfetivo = [...mapa];
    if (pdvId || estacaoPdv.hostname || estacaoPdv.mac) {
      const ja = mapaEfetivo.some((m) => String(m.pdvId) === String(pdvId));
      if (!ja && (estacaoPdv.hostname || estacaoPdv.mac || pdvId)) {
        mapaEfetivo.push({
          pdvId,
          hostname: estacaoPdv.hostname,
          mac: estacaoPdv.mac
        });
      }
    }

    const topo = inferirTopologia(mapaEfetivo, pdvId);
    const provedor = String(entrada.provedor || 'default').toLowerCase();
    const matriz = matrizProvedor(provedor);
    const topoInfo = matriz.topologias[topo.topologia]
      || matriz.topologias[TOPOLOGIES.ESTACAO_UNICA_PDV_UNICO];

    const cmp = compararEstacaoLocal(estacaoPdv, hostHints);
    const temVinculoEstacao = Boolean(estacaoPdv.hostname || estacaoPdv.mac);

    let localidade = LOCALIDADE_EXECUCAO.INDETERMINADA;
    if (cmp.local === true) localidade = LOCALIDADE_EXECUCAO.LOCAL;
    else if (cmp.local === false) localidade = LOCALIDADE_EXECUCAO.REMOTA_REQUERIDA;

    const disp = avaliarDispositivo(entrada.dispositivo);
    const limitacoes = [];

    if (!temVinculoEstacao && pdvId) {
      limitacoes.push({
        codigo: EXEC_CODES.ESTACAO_NAO_VINCULADA,
        mensagem: 'PDV sem hostname/MAC de estação — execução física indeterminada'
      });
    }

    if (localidade === LOCALIDADE_EXECUCAO.REMOTA_REQUERIDA) {
      limitacoes.push({
        codigo: EXEC_CODES.ESTACAO_REMOTA_NAO_SUPORTADA,
        mensagem: 'Dispositivo/estação em outro computador — requer comunicação entre PCs (não implementada)'
      });
    }

    if (disp.codigo === EXEC_CODES.TERMINAL_SEM_DISPOSITIVO) {
      limitacoes.push({
        codigo: EXEC_CODES.TERMINAL_SEM_DISPOSITIVO,
        mensagem: disp.motivo
      });
    }
    if (disp.codigo === EXEC_CODES.DISPOSITIVO_INDISPONIVEL) {
      limitacoes.push({
        codigo: EXEC_CODES.DISPOSITIVO_INDISPONIVEL,
        mensagem: disp.motivo
      });
    }

    if (topo.topologia === TOPOLOGIES.MULTI_ESTACAO && matriz.runtimeSingleton) {
      limitacoes.push({
        codigo: EXEC_CODES.TOPOLOGIA_INCOMPATIVEL_PROVEDOR,
        mensagem: 'Destaxa runtime singleton não cobre MULTI_ESTACAO sem bridge remota'
      });
    }

    if (topo.topologia === TOPOLOGIES.ESTACAO_UNICA_MULTI_PDV && matriz.isolamento === 'GLOBAL_SERIALIZE') {
      limitacoes.push({
        codigo: 'SERIALIZACAO_GLOBAL_OBRIGATORIA',
        mensagem: 'Vários PDVs na mesma estação Destaxa — Allocator GLOBAL_SERIALIZE (MRT-04)'
      });
    }

    // Código principal (prioridade: dispositivo → remota → estação → ok)
    let codigo = EXEC_CODES.EXEC_OK;
    let mensagem = 'Contexto de execução resolvido';
    let bloqueante = false;

    if (disp.codigo === EXEC_CODES.DISPOSITIVO_INDISPONIVEL) {
      codigo = EXEC_CODES.DISPOSITIVO_INDISPONIVEL;
      mensagem = disp.motivo;
      bloqueante = entrada.exigirDispositivo !== false; // default: bloqueia se dispositivo inativo
    } else if (disp.codigo === EXEC_CODES.TERMINAL_SEM_DISPOSITIVO && entrada.exigirDispositivo === true) {
      codigo = EXEC_CODES.TERMINAL_SEM_DISPOSITIVO;
      mensagem = disp.motivo;
      bloqueante = true;
    } else if (localidade === LOCALIDADE_EXECUCAO.REMOTA_REQUERIDA
      && (entrada.exigirExecucaoLocal === true || matriz.runtimeSingleton)) {
      // Destaxa: remoto não suportado — marca código; bloqueia só se exigirExecucaoLocal
      codigo = EXEC_CODES.ESTACAO_REMOTA_NAO_SUPORTADA;
      mensagem = 'Estação remota incompatível com runtime local singleton Destaxa / sem bridge';
      bloqueante = entrada.exigirExecucaoLocal === true;
    } else if (!temVinculoEstacao && pdvId && entrada.exigirEstacaoVinculada === true) {
      codigo = EXEC_CODES.ESTACAO_NAO_VINCULADA;
      mensagem = 'PDV sem estação vinculada';
      bloqueante = true;
    } else if (!temVinculoEstacao && pdvId) {
      // Prioridade: estação comercial ausente > ausência de dispositivo (ambos em limitacoes)
      codigo = EXEC_CODES.ESTACAO_NAO_VINCULADA;
      mensagem = 'PDV sem estação vinculada — topologia/localidade indeterminadas';
      bloqueante = false;
    } else if (disp.codigo === EXEC_CODES.TERMINAL_SEM_DISPOSITIVO) {
      codigo = EXEC_CODES.TERMINAL_SEM_DISPOSITIVO;
      mensagem = disp.motivo;
      bloqueante = false; // anota; preserva fallback / fluxo sem device hard-fail
    }

    const estacaoId = chaveEstacao(estacaoPdv)
      || chaveEstacao(hostHints)
      || null;

    const ctx = criarExecutionContext({
      topologia: topo.topologia,
      pdvId,
      terminalTefId: entrada.terminalTefId || null,
      dispositivoId: entrada.dispositivo?.id || null,
      estacao: {
        id: estacaoId,
        hostname: estacaoPdv.hostname || hostHints.hostname || null,
        mac: estacaoPdv.mac || hostHints.mac || null,
        local: cmp.local === true,
        origem: estacaoPdv.hostname || estacaoPdv.mac
          ? 'pdv.estacao'
          : (hostHints.hostname || hostHints.mac ? 'hostHints' : null)
      },
      localidadeExecucao: localidade,
      runtime: {
        provedor,
        isolamento: matriz.isolamento,
        runtimeKey: matriz.runtimeKey,
        singletonDestaxa: matriz.runtimeSingleton === true && provedor === 'destaxa'
      },
      dispositivo: {
        presente: disp.presente,
        disponivel: disp.disponivel,
        motivo: disp.motivo,
        codigo: disp.codigo,
        portaCom: entrada.dispositivo?.portaCom || null,
        tipo: entrada.dispositivo?.tipo || null
      },
      codigo,
      mensagem,
      limitacoes,
      compatibilidade: {
        matriz: topoInfo,
        topologiaSuportada: topoInfo?.suportado,
        pagamentosSimultaneos: false
      },
      meta: {
        inferencia: topo,
        comparacaoEstacao: cmp,
        bloqueante,
        hostHintsUsadosComoIdentidadeComercial: false,
        allocatorPreservado: true
      }
    });

    return {
      ok: !bloqueante,
      bloqueante,
      codigo,
      mensagem,
      executionContext: ctx
    };
  }

  inferirTopologia(mapaPdvEstacao, pdvId) {
    return inferirTopologia(mapaPdvEstacao, pdvId);
  }
}

function criarExecutionContextResolver(opcoes = {}) {
  return new ExecutionContextResolver(opcoes);
}

let compartilhado = null;
function obterExecutionContextResolver() {
  if (!compartilhado) compartilhado = criarExecutionContextResolver();
  return compartilhado;
}

function resetExecutionContextResolverParaTestes() {
  compartilhado = null;
}

module.exports = {
  ExecutionContextResolver,
  criarExecutionContextResolver,
  obterExecutionContextResolver,
  resetExecutionContextResolverParaTestes,
  inferirTopologia,
  avaliarDispositivo,
  compararEstacaoLocal
};
