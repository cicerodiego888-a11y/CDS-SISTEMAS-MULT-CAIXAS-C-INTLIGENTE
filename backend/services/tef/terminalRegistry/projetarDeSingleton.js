'use strict';

/**
 * Projeta visão lógica somente-leitura a partir do singleton atual
 * (tef_configuracao + tef_pinpads). Não cria cadastro Registry.
 */

const { TERMINAL_STATES, criarTerminalTef, criarDispositivo } = require('./contracts');

async function projetarVisaoSingleton(dependencias = {}) {
  const tefConfigRepository = dependencias.tefConfigRepository
    || require('../../../repositories/tefConfigRepository');

  const completa = typeof tefConfigRepository.buscarConfiguracaoCompleta === 'function'
    ? await tefConfigRepository.buscarConfiguracaoCompleta()
    : null;

  const principal = completa?.principal
    || (await tefConfigRepository.buscarConfiguracaoPrincipal());

  if (!principal) {
    return {
      ok: false,
      mensagem: 'Singleton TEF ausente',
      terminal: null,
      dispositivo: null
    };
  }

  let pinpad = completa?.pinpad || null;
  if (!pinpad && principal.id && typeof tefConfigRepository.buscarPinpadPorConfigId === 'function') {
    pinpad = await tefConfigRepository.buscarPinpadPorConfigId(principal.id);
  }

  const provedor = String(principal.provedor || '').toLowerCase() || null;
  const ambiente = String(principal.ambiente || 'simulacao').toLowerCase();
  const habilitado = principal.habilitado == null || Number(principal.habilitado) === 1;

  const dispositivo = pinpad
    ? criarDispositivo({
      id: `singleton-pinpad-${pinpad.id || '1'}`,
      tipo: pinpad.ip ? 'pinpad_ip' : 'pinpad',
      portaCom: pinpad.porta_com || pinpad.portaCom || null,
      ip: pinpad.ip || null,
      porta: pinpad.porta || null,
      serial: pinpad.serial || null,
      fabricante: pinpad.fabricante || null,
      modelo: pinpad.modelo || pinpad.codigo || null,
      ativo: pinpad.ativo == null || Number(pinpad.ativo) === 1
    })
    : null;

  const estado = !habilitado
    ? TERMINAL_STATES.INATIVO
    : (!provedor
      ? TERMINAL_STATES.NAO_PROVISIONADO
      : (dispositivo && dispositivo.ativo === false
        ? TERMINAL_STATES.INDISPONIVEL
        : TERMINAL_STATES.ATIVO));

  const terminal = criarTerminalTef({
    id: `singleton-tef-${principal.id}`,
    pdvId: null, // visão de instalação — não vinculada a um PDV específico
    empresaId: principal.empresa_codigo || null,
    lojaId: principal.loja_codigo || null,
    provedor,
    ambiente,
    codigoLogicoProvedor: principal.terminal_codigo || null,
    estado,
    dispositivo,
    adapterRegistro: null,
    meta: {
      origem: 'projecao_singleton',
      tefConfiguracaoId: principal.id,
      pdvCodigoCampoConfig: principal.pdv_codigo || null,
      caixaCodigoCampoConfig: principal.caixa_codigo || null,
      nota: 'Projeção read-only; hostname/MAC da estação não são pdvId'
    }
  });

  return {
    ok: true,
    mensagem: 'Visão lógica projetada do singleton (sem Registry persistido)',
    terminal,
    dispositivo,
    separacao: {
      terminalLogico: {
        id: terminal.id,
        codigoLogicoProvedor: terminal.codigoLogicoProvedor,
        provedor: terminal.provedor
      },
      dispositivoFisico: dispositivo
        ? { id: dispositivo.id, portaCom: dispositivo.portaCom, tipo: dispositivo.tipo }
        : null,
      identidadePdv: 'terminais.id (fora desta projeção)',
      identidadeEstacao: 'hostname/MAC (V$Pague / tabela terminais.hostname) — distinta'
    }
  };
}

module.exports = {
  projetarVisaoSingleton
};
