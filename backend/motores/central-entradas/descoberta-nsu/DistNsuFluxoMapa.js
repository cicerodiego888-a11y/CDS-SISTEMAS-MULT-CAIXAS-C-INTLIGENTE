/**
 * Sprint 3 — Mapa de auditoria do fluxo distNSU / CentralNsuService.
 * Somente documentação operacional (sem efeitos colaterais).
 *
 * @module motores/central-entradas/descoberta-nsu/DistNsuFluxoMapa
 */
'use strict';

/**
 * @typedef {{ arquivo: string, funcao: string, responsabilidade: string, origemNsu: string, destinoNsu: string }} FluxoNsuItem
 */

/** @type {ReadonlyArray<FluxoNsuItem>} */
const FLUXO_DIST_NSU = Object.freeze([
  {
    arquivo: 'backend/motores/central-entradas/services/CentralNsuService.js',
    funcao: 'aplicarRetornoDistDfe / obterOuCriar',
    responsabilidade: 'Única fonte de verdade do cursor ultNSU/maxNSU',
    origemNsu: 'Retorno SEFAZ (ultNSU/maxNSU) + controle local',
    destinoNsu: 'central_entradas_nsu via CentralNsuRepository'
  },
  {
    arquivo: 'backend/motores/central-entradas/repositories/CentralNsuRepository.js',
    funcao: 'atualizarSincronizacaoSegura',
    responsabilidade: 'Persistência monotônica (sem regressão) do cursor',
    origemNsu: 'CentralNsuService',
    destinoNsu: 'Tabela central_entradas_nsu (UNIQUE cnpj+ambiente)'
  },
  {
    arquivo: 'backend/services/fiscal/distribuicaoDFe.js',
    funcao: 'sincronizarDistribuicaoDFe',
    responsabilidade: 'Loop distNSU: consulta → persistir lote → avançar cursor',
    origemNsu: 'controle.ultNsu (CentralNsuService.obterOuCriar)',
    destinoNsu: 'CentralNsuService.aplicarRetornoDistDfe após lote seguro'
  },
  {
    arquivo: 'backend/services/fiscal/distribuicaoDFe.js',
    funcao: 'executarEnvioConsultaDfe',
    responsabilidade: 'Envio SOAP exclusivamente via SEFAZQueryGate',
    origemNsu: 'XML distNSU (ultNSU solicitado)',
    destinoNsu: 'Resposta SOAP (não persiste cursor)'
  },
  {
    arquivo: 'backend/services/fiscal/dfeRetornoParser.js',
    funcao: 'extrairMetadadosRetorno / extrairDocumentosZip',
    responsabilidade: 'Parser cStat/ultNSU/maxNSU/docZip',
    origemNsu: 'XML retDistDFeInt',
    destinoNsu: 'Metadados em memória + NSU por docZip'
  },
  {
    arquivo: 'backend/motores/central-entradas/services/CentralDfePersistenciaService.js',
    funcao: 'persistirDocumentoDfe',
    responsabilidade: 'Persistência idempotente de documentos (chave + NSU)',
    origemNsu: 'NSU do docZip',
    destinoNsu: 'central_entradas_documentos.nsu (não é o cursor)'
  },
  {
    arquivo: 'backend/motores/central-entradas/services/CentralSyncExecucaoService.js',
    funcao: 'comLockDistDfe / executar',
    responsabilidade: 'Mutex de sincronização por CNPJ+ambiente',
    origemNsu: '—',
    destinoNsu: '—'
  },
  {
    arquivo: 'backend/motores/central-entradas/services/CentralSincronizacaoService.js',
    funcao: 'sincronizar',
    responsabilidade: 'Entrada de sync com contexto fiscal + nsuService oficial',
    origemNsu: 'Contexto CNPJ/ambiente',
    destinoNsu: 'sincronizarDistribuicaoDFe'
  },
  {
    arquivo: 'backend/motores/central-entradas/services/NsuRecoveryService.js',
    funcao: 'tentarRecuperar',
    responsabilidade: 'Recuperação 656 quando SEFAZ > local (sem fabricar NSU)',
    origemNsu: 'XML/params 656',
    destinoNsu: 'atualizarSincronizacaoSegura'
  },
  {
    arquivo: 'backend/motores/central-entradas/descoberta-nsu/NsuLacunaDetector.js',
    funcao: 'detectarLacunasNsu',
    responsabilidade: 'Diagnóstico de lacunas aparentes (não altera cursor)',
    origemNsu: 'NSUs dos docZip do lote',
    destinoNsu: 'Registro LACUNA_DETECTADA (diagnóstico)'
  }
]);

const REGRA_AVANCO = Object.freeze({
  avancaApos: 'Lote processado com sucesso (persistência sem falha crítica)',
  naoAvancaEm: [
    'timeout / erro transporte',
    'erro SOAP/HTTP/certificado',
    'erro de parser',
    'erro de banco na persistência',
    'ZIP/schema inválido no lote',
    'cStat 656 (preserva; recovery só se remoto > local)'
  ],
  ultNsu: 'Posição processada pelo sistema',
  maxNsu: 'Posição máxima informada pela SEFAZ no retorno'
});

module.exports = {
  FLUXO_DIST_NSU,
  REGRA_AVANCO
};
