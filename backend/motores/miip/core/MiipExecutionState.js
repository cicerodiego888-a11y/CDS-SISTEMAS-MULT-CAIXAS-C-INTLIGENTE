/**
 * MiipExecutionState — Estados do ciclo de vida de uma execução do Pipeline.
 *
 * Sprint 2 Pipeline: somente constantes estruturais — sem transições automáticas.
 *
 * @module motores/miip/core/MiipExecutionState
 */

const MiipExecutionState = Object.freeze({
  CRIADO: 'CRIADO',
  INICIADO: 'INICIADO',
  EXECUTANDO: 'EXECUTANDO',
  CONSOLIDANDO: 'CONSOLIDANDO',
  FINALIZADO: 'FINALIZADO',
  ERRO: 'ERRO'
});

module.exports = MiipExecutionState;
