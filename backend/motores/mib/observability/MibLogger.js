'use strict';

/**
 * Logs operacionais do MIB.
 * Em produção nunca registra termos de pesquisa — só métricas/eventos.
 */
class MibLogger {
  /**
   * @param {{ modoDesenvolvimento?: boolean }} [opcoes]
   */
  constructor(opcoes = {}) {
    this.modoDesenvolvimento = opcoes.modoDesenvolvimento === true;
  }

  setModoDesenvolvimento(ativo) {
    this.modoDesenvolvimento = ativo === true;
  }

  _log(nivel, evento, meta = {}) {
    const payload = {
      ts: new Date().toISOString(),
      motor: 'MIB',
      nivel,
      evento,
      ...meta
    };
    // Nunca logar termo de busca em produção
    if (!this.modoDesenvolvimento && payload.termo != null) {
      delete payload.termo;
    }
    const linha = `[MIB][${nivel}] ${evento}`;
    if (nivel === 'error') console.error(linha, meta);
    else if (nivel === 'warn') console.warn(linha, meta);
    else if (this.modoDesenvolvimento) console.log(linha, meta);
    else if (['refresh', 'swap', 'benchmark', 'memory'].includes(evento)) {
      console.log(linha, {
        tempoMs: meta.tempoMs,
        versao: meta.versao,
        tamanho: meta.tamanho
      });
    }
    return payload;
  }

  info(evento, meta) { return this._log('info', evento, meta); }
  warn(evento, meta) { return this._log('warn', evento, meta); }
  error(evento, meta) { return this._log('error', evento, meta); }
}

module.exports = MibLogger;
