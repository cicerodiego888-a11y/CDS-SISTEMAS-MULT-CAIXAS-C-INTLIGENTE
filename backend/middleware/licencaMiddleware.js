/**
 * Middleware de licença comercial — Hotfix RC1
 * Protege TODAS as rotas /api exceto allowlist pública.
 * Chamado APÓS autenticação (via apiAuthLicencaGate).
 *
 * Após vencimento: PDV operacional permanece liberado por DIAS_TOLERANCIA_PDV.
 * A tela/API de Assinatura (/api/licenca) é pública no gate e nunca depende deste middleware.
 */

'use strict';

const verificarLicenca = require('../services/verificarLicenca');
const licencaService = require('../services/licencaService');
const { responderLicencaInvalida } = require('./errosLicenciamento');
const { isPublicApiPath, normalizeApiPath } = require('./apiPublicPaths');

const DIAS_TOLERANCIA_PDV = licencaService.DIAS_TOLERANCIA_PDV;

/** Rotas necessárias para o PDV operar durante a tolerância pós-vencimento. */
const PDV_GRACE_PREFIXES = [
  '/api/vendas',
  '/api/caixa',
  '/api/produtos',
  '/api/clientes',
  '/api/categorias',
  '/api/subcategorias',
  '/api/marcas',
  '/api/pix',
  '/api/tef',
  '/api/fiscal',
  '/api/impressao',
  '/api/terminais',
  '/api/equipamentos',
  '/api/configuracoes',
  '/api/configuracoes-avancadas',
  '/api/plataforma'
];

function isAllowedDuringExpired(req) {
  const method = req.method.toUpperCase();
  const apiPath = normalizeApiPath(req);

  if (apiPath.startsWith('/api/clientes')) {
    return ['GET', 'POST'].includes(method);
  }
  if (apiPath.startsWith('/api/produtos')) {
    return method === 'GET';
  }
  if (apiPath.startsWith('/api/vendas') && method === 'GET') {
    return true;
  }
  return false;
}

function isAllowedDuringPdvGrace(req) {
  const apiPath = normalizeApiPath(req);
  return PDV_GRACE_PREFIXES.some((prefix) => apiPath === prefix || apiPath.startsWith(`${prefix}/`));
}

function isProtectedRoute(req) {
  const apiPath = normalizeApiPath(req);
  if (isPublicApiPath(apiPath)) return false;
  return apiPath.startsWith('/api/');
}

async function licencaMiddleware(req, res, next) {
  if (!isProtectedRoute(req)) {
    return next();
  }

  const apiPath = normalizeApiPath(req);
  const resultado = await verificarLicenca();

  if (!resultado.valido) {
    if (resultado.motivo === 'DATA_ALTERADA') {
      licencaService.gravarLog(
        'Tentativa de alteração de data',
        `Tentativa de uso com data alterada. Última execução: ${resultado.ultima_execucao}`
      );
      return responderLicencaInvalida(
        res,
        'DATA_ALTERADA',
        'Foi detectada inconsistência na data do computador.'
      );
    }

    if (resultado.motivo === 'VENCIDA') {
      const emTolerancia = resultado.emToleranciaPdv === true
        || licencaService.estaEmToleranciaPdv(resultado.data_expiracao, DIAS_TOLERANCIA_PDV);

      if (emTolerancia && isAllowedDuringPdvGrace(req)) {
        return next();
      }

      if (isAllowedDuringExpired(req)) {
        return next();
      }

      const diasRestantesTolerancia = emTolerancia
        ? (resultado.diasToleranciaRestantes
          ?? licencaService.diasToleranciaPdvRestantes(resultado.data_expiracao, DIAS_TOLERANCIA_PDV))
        : 0;

      licencaService.gravarLog('Licença vencida', `Tentativa de uso bloqueado em rota ${apiPath}`);

      if (emTolerancia) {
        return responderLicencaInvalida(
          res,
          'LICENCA_VENCIDA',
          `Assinatura expirada. O PDV permanece liberado por mais ${diasRestantesTolerancia} dia(s). Renove em Assinatura.`
        );
      }

      return responderLicencaInvalida(
        res,
        'LICENCA_VENCIDA',
        'Assinatura expirada. Renove o código em Assinatura ou entre em contato com o suporte.'
      );
    }

    return responderLicencaInvalida(
      res,
      'LICENCA_AUSENTE',
      'Sistema não ativado.',
      { codigo_instalacao: resultado.codigo_instalacao || null }
    );
  }

  return next();
}

module.exports = licencaMiddleware;
module.exports.isProtectedRoute = isProtectedRoute;
module.exports.isAllowedDuringExpired = isAllowedDuringExpired;
module.exports.isAllowedDuringPdvGrace = isAllowedDuringPdvGrace;
module.exports.DIAS_TOLERANCIA_PDV = DIAS_TOLERANCIA_PDV;
module.exports.PDV_GRACE_PREFIXES = PDV_GRACE_PREFIXES;
