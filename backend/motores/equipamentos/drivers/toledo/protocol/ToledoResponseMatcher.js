/**
 * Sprint 15.2 — ToledoResponseMatcher
 * Relaciona TX/RX: comando esperado, timeout, sequência, integridade.
 */

'use strict';

const { UnexpectedResponseError, InvalidFrameError } = require('./ToledoProtocolErrors');

class ToledoResponseMatcher {
  /**
   * @param {object} [opcoes]
   * @param {string[]} [opcoes.accept] — comandos de resposta aceitos (ex: AK, RS)
   * @param {string[]} [opcoes.reject] — comandos que são erro (ex: NK)
   * @param {Function} [opcoes.validate] — validação custom
   */
  constructor(opcoes = {}) {
    this.accept = (opcoes.accept || ['AK']).map((c) => String(c).toUpperCase());
    this.reject = (opcoes.reject || ['NK']).map((c) => String(c).toUpperCase());
    this.validate = typeof opcoes.validate === 'function' ? opcoes.validate : null;
    this.requestCommand = opcoes.requestCommand || null;
  }

  /**
   * @param {object} parsed — retorno do FrameParser
   * @param {object} [ctx]
   */
  match(parsed, ctx = {}) {
    if (!parsed || parsed.valid === false) {
      throw new InvalidFrameError('Frame parseado inválido', { parsed });
    }
    const cmd = String(parsed.command || parsed.comando || '').toUpperCase();
    if (this.reject.includes(cmd)) {
      throw new UnexpectedResponseError(`Resposta NAK/rejeitada: ${cmd}`, {
        command: cmd,
        payload: parsed.payload,
        requestCommand: this.requestCommand || ctx.requestCommand
      });
    }
    if (this.accept.length && !this.accept.includes(cmd)) {
      throw new UnexpectedResponseError(
        `Resposta inesperada: ${cmd} (esperado: ${this.accept.join('|')})`,
        {
          command: cmd,
          expected: this.accept,
          requestCommand: this.requestCommand || ctx.requestCommand
        }
      );
    }
    if (this.validate) {
      const ok = this.validate(parsed, ctx);
      if (ok === false) {
        throw new UnexpectedResponseError('Validação custom falhou', { command: cmd });
      }
    }
    return {
      ok: true,
      command: cmd,
      payload: parsed.payload,
      checksum: parsed.checksum
    };
  }
}

module.exports = ToledoResponseMatcher;
module.exports.ToledoResponseMatcher = ToledoResponseMatcher;
