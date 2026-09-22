'use strict';

/**
 * Simulador de respostas iniciaTransacao / continua / finaliza Destaxa.
 * Não substitui a DLL em produção — injetado apenas em testes e modo mock explícito.
 */

class DestaxaTransacaoMockDriver {
  constructor(passos = []) {
    this.definirCenario(passos);
  }

  definirCenario(passos = []) {
    this._passos = Array.isArray(passos) ? [...passos] : [];
    this._indice = 0;
    this.contadores = {
      iniciaTransacaoDestaxa: 0,
      continuaTransacaoDestaxa: 0,
      finalizaTransacaoDestaxa: 0
    };
  }

  _proximo(tipo) {
    const passo = this._passos[this._indice];
    if (!passo || passo.fn !== tipo) {
      return {
        codigo: 'FF',
        saida: `erro=sequencia_invalida;esperado=${tipo}`,
        tamanhoSaida: 0
      };
    }
    this._indice += 1;
    const saida = passo.saida || '';
    return {
      codigo: String(passo.codigo || 'FF').toUpperCase(),
      saida,
      tamanhoSaida: saida.length
    };
  }

  iniciaTransacaoDestaxa(operacao, entrada) {
    this.contadores.iniciaTransacaoDestaxa += 1;
    return this._proximo('inicia');
  }

  continuaTransacaoDestaxa(entrada) {
    this.contadores.continuaTransacaoDestaxa += 1;
    return this._proximo('continua');
  }

  finalizaTransacaoDestaxa(confirmacao) {
    this.contadores.finalizaTransacaoDestaxa += 1;
    return this._proximo('finaliza');
  }
}

module.exports = DestaxaTransacaoMockDriver;
