/**
 * Sprint 14.1 / 15.0 — DiscoveryController
 */

'use strict';

const discoveryEngineV1 = require('./DiscoveryEngineV1');
const ethernetDiscovery = require('./EthernetDiscovery');
const discoveryManager = require('./DiscoveryManager');
const DiscoveryRepository = require('./DiscoveryRepository');
const NetworkScanner = require('./NetworkScanner');

function responderErro(res, error, mensagemPadrao, statusPadrao = 500) {
  const status = error.statusCode || statusPadrao;
  return res.status(status).json({
    success: false,
    error: error.message || mensagemPadrao,
    code: error.code || null
  });
}

/**
 * POST /api/equipamentos/discovery
 * Aceite Sprint 14.1: retorna array [{host, porta, status, latencia}]
 * Query/body engine=v1 (padrão neste controller). Body meta=1 inclui metadados.
 */
async function discovery(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const incluirMeta = body.meta === true || body.meta === 1 || req.query.meta === '1';

    const resultado = await discoveryEngineV1.executar({
      timeoutMs: body.timeoutMs,
      concorrencia: body.concorrencia,
      maxHosts: body.maxHosts,
      portas: body.portas,
      persistir: body.persistir !== false
    });

    if (incluirMeta) {
      return res.json({
        success: true,
        equipamentos: resultado.equipamentos,
        meta: resultado.meta
      });
    }

    // Formato oficial do aceite da sprint
    return res.json(resultado.equipamentos || []);
  } catch (error) {
    return responderErro(res, error, 'Erro ao executar Discovery Engine.');
  }
}

/**
 * Sprint 15.0 — GET /api/equipamentos/discovery/ethernet
 * Resposta: [{ endpoint, driver, confiança }]
 * Query meta=1 inclui estatísticas / sub-redes / lab.
 */
async function discoveryEthernet(req, res) {
  try {
    const q = req.query || {};
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const incluirMeta = q.meta === '1' || body.meta === true || body.meta === 1;

    // Cache: ?cache=1 devolve último resultado sem rescan
    if (q.cache === '1') {
      const ultimo = ethernetDiscovery.obterUltimoResultado();
      if (ultimo) {
        const lista = (ultimo.equipamentos || []).map((c) => ({
          endpoint: c.endpoint,
          driver: c.driver,
          confiança: c.confiança != null ? c.confiança : c.confianca
        }));
        if (incluirMeta) {
          return res.json({
            success: true,
            equipamentos: lista,
            candidatos: ultimo.candidatos,
            meta: ultimo.meta
          });
        }
        return res.json(lista);
      }
    }

    const resultado = await ethernetDiscovery.executar({
      timeoutTcpMs: Number(q.timeoutTcpMs || body.timeoutTcpMs || q.timeoutMs || body.timeoutMs) || undefined,
      concorrencia: Number(q.concorrencia || body.concorrencia) || undefined,
      maxHosts: Number(q.maxHosts || body.maxHosts) || undefined,
      portas: body.portas || (q.portas ? String(q.portas).split(',').map(Number) : undefined),
      persistir: body.persistir !== false && q.persistir !== '0',
      lab: q.lab !== '0' && body.lab !== false
    });

    const lista = (resultado.equipamentos || []).map((c) => ({
      endpoint: c.endpoint,
      driver: c.driver,
      confiança: c.confiança != null ? c.confiança : c.confianca
    }));

    if (incluirMeta) {
      return res.json({
        success: true,
        equipamentos: lista,
        candidatos: resultado.candidatos,
        meta: resultado.meta
      });
    }

    return res.json(lista);
  } catch (error) {
    return responderErro(res, error, 'Erro no Discovery Ethernet.');
  }
}

/**
 * Sprint 15.0 — GET /api/equipamentos/discovery/interfaces
 */
async function listarInterfaces(req, res) {
  try {
    const scanner = new NetworkScanner();
    const subRedes = scanner.listarSubRedes();
    res.json({
      success: true,
      interfaces: subRedes.map((s) => ({
        ip: s.ip,
        subnet: s.subnet,
        broadcast: s.broadcast,
        nome: s.nome,
        mascara: s.mascara
      }))
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar interfaces de rede.');
  }
}

/**
 * Sprint 15.0 — POST /api/equipamentos/discovery/all
 * USB + Serial + Ethernet em paralelo.
 */
async function discoveryAll(req, res) {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const resultado = await discoveryManager.descobrir(body);
    res.json({
      success: resultado.sucesso !== false,
      candidatos: resultado.candidatos,
      erros: resultado.erros,
      meta: resultado.meta
    });
  } catch (error) {
    responderErro(res, error, 'Erro no Discovery Manager.');
  }
}

async function listarDescobertos(req, res) {
  try {
    const repo = new DiscoveryRepository();
    const rows = await repo.listar({ limite: Number(req.query.limite) || 100 });
    res.json({ success: true, equipamentos: rows });
  } catch (error) {
    responderErro(res, error, 'Erro ao listar equipamentos descobertos.');
  }
}

async function cancelar(req, res) {
  try {
    discoveryEngineV1.cancelar();
    ethernetDiscovery.cancelar();
    discoveryManager.cancelar();
    res.json({
      success: true,
      cancelado: true,
      em_execucao: discoveryEngineV1.estaEmExecucao()
        || ethernetDiscovery.estaEmExecucao()
        || discoveryManager.estaEmExecucao()
    });
  } catch (error) {
    responderErro(res, error, 'Erro ao cancelar discovery.');
  }
}

module.exports = {
  discovery,
  discoveryEthernet,
  listarInterfaces,
  discoveryAll,
  listarDescobertos,
  cancelar
};
