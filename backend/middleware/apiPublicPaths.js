/**
 * Rotas /api públicas (sem Auth + sem Licença comercial).
 * Hotfix RC1 — fonte única para gate e licença.
 */

'use strict';

function normalizeApiPath(req) {
  const url = (req && (req.originalUrl || req.url)) || '';
  return String(url).split('?')[0];
}

function isPublicApiPath(apiPath) {
  if (!apiPath || !apiPath.startsWith('/api')) return true;
  if (apiPath === '/api/ping') return true;
  if (apiPath.startsWith('/api/auth')) return true;
  if (apiPath.startsWith('/api/licenca')) return true;
  if (apiPath.startsWith('/api/configuracoes/login_background')) return true;
  if (apiPath === '/api/terminais/auto' || apiPath === '/api/terminais/auto/offline') return true;
  // RC12.2 — ingest RUM (whitelist + sanitização); summary permanece autenticado
  if (apiPath === '/api/observabilidade/rum') return true;
  return false;
}

module.exports = {
  normalizeApiPath,
  isPublicApiPath
};
