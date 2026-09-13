'use strict';

/**
 * RC11.3 / RC11.5 — Lazy Services
 *
 * Carrega routers/singletons apenas no primeiro uso e reutiliza cache.
 * Não altera contratos de API — apenas adia o require().
 */

/** @type {Map<string, { router: Function, createdMs: number, reuses: number }>} */
const cache = new Map();

/** @type {Map<string, { instance: any, createdMs: number, reuses: number }>} */
const singletonCache = new Map();

function lazyLog(evento, extra = {}) {
  console.log(JSON.stringify({
    tag: 'LAZY',
    evento,
    ts: new Date().toISOString(),
    ...extra
  }));
  // RC12.1 — observe-only
  try {
    require('../observabilidade/adapters/lazyAdapter').publishLazyEvent(evento, extra);
  } catch (_) { /* ignore */ }
}

/**
 * Resolve o export padrão de uma rota (Router Express ou { router }).
 * @param {any} mod
 * @param {string|null} exportKey
 * @returns {import('express').Router}
 */
function resolverRouter(mod, exportKey) {
  if (exportKey) {
    if (!mod || typeof mod[exportKey] !== 'function') {
      throw new Error(`Lazy export "${exportKey}" inválido`);
    }
    return mod[exportKey];
  }
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.router === 'function') return mod.router;
  throw new Error('Módulo lazy não exporta Router Express');
}

/**
 * Cria middleware Express que instancia o serviço na primeira requisição.
 *
 * @param {string} serviceId - id estável (ex.: miip, laboratorio-equipamentos)
 * @param {() => any} factory - função que faz require() do módulo
 * @param {{ exportKey?: string }} [options]
 * @returns {import('express').RequestHandler}
 */
function createLazyRouter(serviceId, factory, options = {}) {
  const exportKey = options.exportKey || null;

  return function lazyRouterMiddleware(req, res, next) {
    try {
      const existente = cache.get(serviceId);
      if (existente) {
        existente.reuses += 1;
        if (existente.reuses === 1) {
          lazyLog('SERVICE REUSED', { service: serviceId, reuses: existente.reuses });
        }
        return existente.router(req, res, next);
      }

      lazyLog('LAZY INIT', { service: serviceId });
      const t0 = Date.now();
      const mod = factory();
      const router = resolverRouter(mod, exportKey);
      const createdMs = Date.now() - t0;

      cache.set(serviceId, { router, createdMs, reuses: 0 });
      lazyLog('SERVICE CREATED', { service: serviceId, createdMs });

      return router(req, res, next);
    } catch (err) {
      lazyLog('SERVICE ERROR', {
        service: serviceId,
        erro: err && err.message ? err.message : String(err)
      });
      return next(err);
    }
  };
}

/**
 * Singleton lazy genérico (serviços, não routers).
 * Primeiro uso: factory() + cache. Demais: mesma instância.
 *
 * @param {string} serviceId
 * @param {() => any} factory
 * @returns {any}
 */
function getLazySingleton(serviceId, factory) {
  const existente = singletonCache.get(serviceId);
  if (existente) {
    existente.reuses += 1;
    if (existente.reuses === 1) {
      lazyLog('SERVICE REUSED', { service: serviceId, reuses: existente.reuses });
    }
    return existente.instance;
  }

  lazyLog('LAZY INIT', { service: serviceId });
  const t0 = Date.now();
  const instance = factory();
  const createdMs = Date.now() - t0;
  singletonCache.set(serviceId, { instance, createdMs, reuses: 0 });
  lazyLog('SERVICE CREATED', { service: serviceId, createdMs });
  return instance;
}

function wasLoaded(serviceId) {
  return cache.has(serviceId) || singletonCache.has(serviceId);
}

function getLoadedServices() {
  return Array.from(new Set([...cache.keys(), ...singletonCache.keys()]));
}

function getServiceStats(serviceId) {
  const routerEntry = cache.get(serviceId);
  if (routerEntry) {
    return {
      service: serviceId,
      kind: 'router',
      createdMs: routerEntry.createdMs,
      reuses: routerEntry.reuses
    };
  }
  const singletonEntry = singletonCache.get(serviceId);
  if (!singletonEntry) return null;
  return {
    service: serviceId,
    kind: 'singleton',
    createdMs: singletonEntry.createdMs,
    reuses: singletonEntry.reuses
  };
}

/** Apenas para testes */
function _resetLazyCacheForTests() {
  cache.clear();
  singletonCache.clear();
}

module.exports = {
  createLazyRouter,
  getLazySingleton,
  wasLoaded,
  getLoadedServices,
  getServiceStats,
  _resetLazyCacheForTests
};
