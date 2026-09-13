/**
 * ToledoPrix4Protocol — Camada de protocolo Toledo Prix 4 Uno (Ethernet TCP).
 *
 * Sprint 11A: infraestrutura completa com frames temporários.
 * Sprint 11B: substituir payloads pelos comandos oficiais 90AX.
 *
 * Fluxo obrigatório: FrameBuilder → Transport → Parser
 *
 * @class ToledoPrix4Protocol
 */

const connectionManager = require('../../../transport/ConnectionManager');
const packetLogger = require('../../../communication/PacketLogger');
const connectionMonitor = require('../../../monitor/ConnectionMonitor');
const loggerService = require('../../../services/LoggerService');
const frameBuilder = require('./ToledoPrix4FrameBuilder');
const ToledoPrix4Parser = require('./ToledoPrix4Parser');
const { COMANDOS, TIMEOUTS, PORTAS_PADRAO } = require('./ToledoPrix4Constants');

class ToledoPrix4Protocol {
  constructor(config = {}) {
    this.config = this._normalizarConfig(config);
    this.conectado = false;
    /** @type {Object|null} */
    this._entrada = null;
    this._chave = null;
    this.parser = new ToledoPrix4Parser();
    this.frameBuilder = frameBuilder;
  }

  /**
   * @param {Object} config
   * @returns {Object}
   * @private
   */
  _normalizarConfig(config = {}) {
    return {
      ...config,
      host: config.host || config.ip || '127.0.0.1',
      porta: Number(config.porta || config.port || PORTAS_PADRAO.ethernet),
      timeout: Number(config.timeout ?? config.timeout_ms ?? TIMEOUTS.conexao),
      heartbeatInterval: Number(
        config.heartbeatInterval ?? config.heartbeat_ms ?? TIMEOUTS.heartbeat
      ),
      tentativas: Number(config.tentativas ?? config.maxReconexoes ?? 3),
      intervaloReconexao: Number(config.intervaloReconexao ?? 2000),
      equipamento_id: config.equipamento_id ?? null,
      driver: config.driver || 'TOLEDO_PRIX4_UNO'
    };
  }

  /**
   * @returns {import('../../../transport/EthernetTransport')}
   * @private
   */
  _transport() {
    if (!this._entrada || !this._entrada.transport) {
      throw new Error('ToledoPrix4Protocol: não conectado');
    }
    return this._entrada.transport;
  }

  /**
   * @param {Object} [extras]
   * @returns {Object}
   * @private
   */
  _resposta(extras = {}) {
    return {
      sucesso: true,
      simulado: true,
      comunicacao_real: true,
      protocolo: 'toledo-prix4',
      transporte: 'ethernet',
      host: this.config.host,
      porta: this.config.porta,
      conectado: this.conectado,
      infraestrutura: '11A',
      timestamp: new Date().toISOString(),
      ...extras
    };
  }

  /**
   * RC14.14.10 — normaliza RX: Buffer | {dados|buffer} | null → Buffer|null
   * @param {*} raw
   * @returns {Buffer|null}
   * @private
   */
  _extrairBufferRx(raw) {
    if (raw == null) return null;
    if (Buffer.isBuffer(raw)) return raw.length ? raw : null;
    if (typeof raw === 'string') {
      const b = Buffer.from(raw);
      return b.length ? b : null;
    }
    if (typeof raw === 'object') {
      if (Buffer.isBuffer(raw.dados)) return raw.dados.length ? raw.dados : null;
      if (Buffer.isBuffer(raw.buffer)) return raw.buffer.length ? raw.buffer : null;
      if (raw.dados != null) {
        try {
          const b = Buffer.from(raw.dados);
          return b.length ? b : null;
        } catch (_) {
          return null;
        }
      }
    }
    return null;
  }

  /**
   * @param {Object} meta
   * @private
   */
  async _registrarComando(meta = {}) {
    const contexto = {
      driver: this.config.driver,
      equipamento_id: this.config.equipamento_id,
      comando: meta.comando || null,
      operacao: meta.operacao || null,
      resultado: meta.resultado || null,
      tempo_ms: meta.tempo_ms ?? null,
      hex_enviado: meta.hex_enviado || null,
      hex_recebido: meta.hex_recebido || null,
      ack: meta.ack === true,
      nak: meta.nak === true,
      timeout: meta.timeout === true,
      retry: meta.retry ?? null
    };

    const nivel = meta.nak || meta.timeout ? 'warn' : 'info';
    await loggerService[nivel]('Comando protocolo Toledo', {
      operacao: `protocol.comando.${meta.operacao || 'exec'}`,
      equipamento_id: this.config.equipamento_id,
      contexto
    });
  }

  /**
   * Envia frame e aguarda resposta parseada.
   * @param {Buffer} frame
   * @param {Object} opcoes
   * @returns {Promise<Object>}
   * @private
   */
  async _executarComando(operacao, frame, opcoes = {}) {
    const inicio = Date.now();
    const comando = opcoes.comando || operacao;
    const timeoutLeitura = opcoes.timeout ?? TIMEOUTS.comando;

    if (!this.conectado) {
      await this.connect();
    }

    let hexEnviado = null;
    let hexRecebido = null;

    try {
      const writeRes = await this.write(frame, { comando, operacao });
      hexEnviado = writeRes.hex || null;

      let rawRes;
      try {
        rawRes = await this.read({ timeout: timeoutLeitura, comando, operacao });
      } catch (err) {
        const tempo = Date.now() - inicio;
        await this._registrarComando({
          comando,
          operacao,
          resultado: 'TIMEOUT',
          tempo_ms: tempo,
          hex_enviado: hexEnviado,
          timeout: true
        });
        throw err;
      }

      // RC14.14.10 — receber() pode devolver Buffer|null (timeout sem RX)
      const dados = this._extrairBufferRx(rawRes);
      if (!dados || !dados.length) {
        const tempo = Date.now() - inicio;
        await this._registrarComando({
          comando,
          operacao,
          resultado: 'TIMEOUT',
          tempo_ms: tempo,
          hex_enviado: hexEnviado,
          timeout: true
        });
        const err = new Error('Nenhuma resposta recebida da balança.');
        err.code = 'RX_TIMEOUT';
        err.statusCode = 408;
        err.hex_enviado = hexEnviado;
        throw err;
      }
      const historico = packetLogger.listar(this._chave);
      hexRecebido = historico.length ? historico[historico.length - 1].hex : null;

      const parsed = this.parser.parseFrame(dados);
      const tempo = Date.now() - inicio;

      if (parsed?.tipo === 'NAK') {
        const nak = this.parser.parseNAK(dados);
        await this._registrarComando({
          comando,
          operacao,
          resultado: 'NAK',
          tempo_ms: tempo,
          hex_enviado: hexEnviado,
          hex_recebido: hexRecebido,
          nak: true
        });
        return this._resposta({
          metodo: operacao,
          sucesso: false,
          ack: false,
          nak: true,
          parsed,
          nakDetalhe: nak,
          tempo_ms: tempo,
          hex_enviado: hexEnviado,
          hex_recebido: hexRecebido
        });
      }

      if (parsed?.tipo === 'ACK' || parsed?.tipo === 'STATUS' || parsed?.tipo === 'PESO') {
        await this._registrarComando({
          comando,
          operacao,
          resultado: parsed.tipo === 'ACK' ? 'ACK' : parsed.tipo,
          tempo_ms: tempo,
          hex_enviado: hexEnviado,
          hex_recebido: hexRecebido,
          ack: parsed.tipo === 'ACK'
        });
        return this._resposta({
          metodo: operacao,
          sucesso: true,
          ack: parsed.tipo === 'ACK',
          parsed,
          tempo_ms: tempo,
          hex_enviado: hexEnviado,
          hex_recebido: hexRecebido
        });
      }

      const erro = this.parser.parseErro(dados, 'resposta não reconhecida');
      await this._registrarComando({
        comando,
        operacao,
        resultado: 'ERRO',
        tempo_ms: tempo,
        hex_enviado: hexEnviado,
        hex_recebido: hexRecebido
      });

      return this._resposta({
        metodo: operacao,
        sucesso: false,
        parsed: erro,
        tempo_ms: tempo,
        hex_enviado: hexEnviado,
        hex_recebido: hexRecebido
      });
    } catch (err) {
      if (!/timeout/i.test(err.message)) {
        await this._registrarComando({
          comando,
          operacao,
          resultado: 'ERRO',
          tempo_ms: Date.now() - inicio,
          hex_enviado: hexEnviado
        });
      }
      throw err;
    }
  }

  /**
   * @param {Object} novaConfig
   * @returns {Object}
   */
  configurar(novaConfig = {}) {
    this.config = this._normalizarConfig({ ...this.config, ...novaConfig });
    return this._resposta({
      metodo: 'configurar',
      config: {
        host: this.config.host,
        porta: this.config.porta,
        timeout: this.config.timeout,
        heartbeatInterval: this.config.heartbeatInterval
      }
    });
  }

  /**
   * Abre conexão TCP via ConnectionManager.
   * @returns {Promise<Object>}
   */
  async connect() {
    if (this.conectado && this._entrada?.transport?.isConnected()) {
      return this._resposta({ metodo: 'connect', mensagem: 'Já conectado' });
    }

    try {
      this._entrada = await connectionManager.abrir(this.config);
      this._chave = this._entrada.chave;
      this.conectado = true;

      await loggerService.info('Socket aberto', {
        operacao: 'protocol.socket.aberto',
        equipamento_id: this.config.equipamento_id,
        contexto: {
          chave: this._chave,
          host: this.config.host,
          porta: this.config.porta
        }
      });

      return this._resposta({
        metodo: 'connect',
        mensagem: 'Conectado',
        chave: this._chave,
        monitor: connectionMonitor.obterStatus(this._chave)
      });
    } catch (err) {
      this.conectado = false;
      this._entrada = null;
      this._chave = null;

      await loggerService.error('Erro ao abrir socket', {
        operacao: 'protocol.socket.erro',
        equipamento_id: this.config.equipamento_id,
        contexto: { erro: err.message, host: this.config.host, porta: this.config.porta }
      });

      throw err;
    }
  }

  /**
   * Fecha conexão TCP.
   * @returns {Promise<Object>}
   */
  async disconnect() {
    if (!this._chave) {
      this.conectado = false;
      return this._resposta({ metodo: 'disconnect', mensagem: 'Já desconectado', conectado: false });
    }

    const chave = this._chave;

    try {
      await connectionManager.fechar(chave);
    } finally {
      this.conectado = false;
      this._entrada = null;
      this._chave = null;
    }

    await loggerService.info('Socket fechado', {
      operacao: 'protocol.socket.fechado',
      equipamento_id: this.config.equipamento_id,
      contexto: { chave }
    });

    return this._resposta({
      metodo: 'disconnect',
      mensagem: 'Desconectado',
      conectado: false
    });
  }

  /**
   * Ciclo de heartbeat (ping protocolo + reconexão se necessário).
   * @returns {Promise<Object>}
   */
  async heartbeat() {
    if (!this.conectado || !this._chave) {
      return {
        sucesso: false,
        comunicacao_real: true,
        metodo: 'heartbeat',
        mensagem: 'Não conectado'
      };
    }

    try {
      if (!this._transport().isConnected()) {
        await loggerService.warn('Reconexão via heartbeat', {
          operacao: 'protocol.reconexao',
          equipamento_id: this.config.equipamento_id,
          contexto: { chave: this._chave }
        });
        await connectionManager.reconectar(this._chave);
        this._entrada = connectionManager.obter(this._chave);
      }

      const ping = await this.ping();
      return this._resposta({
        metodo: 'heartbeat',
        ping,
        monitor: connectionMonitor.obterStatus(this._chave)
      });
    } catch (err) {
      await loggerService.error('Heartbeat falhou', {
        operacao: 'protocol.heartbeat.erro',
        equipamento_id: this.config.equipamento_id,
        contexto: { erro: err.message, chave: this._chave }
      });
      throw err;
    }
  }

  /**
   * Ping de protocolo (frame PN via FrameBuilder).
   * @returns {Promise<Object>}
   */
  async ping() {
    if (!this.conectado) {
      return {
        sucesso: false,
        comunicacao_real: true,
        metodo: 'ping',
        mensagem: 'Não conectado'
      };
    }

    const frame = frameBuilder.buildPing();
    const resultado = await this._executarComando('ping', frame, {
      comando: COMANDOS.PING,
      timeout: TIMEOUTS.ping
    });

    return this._resposta({
      metodo: 'ping',
      latencia_ms: resultado.tempo_ms ?? null,
      ...resultado
    });
  }

  /**
   * Handshake de protocolo.
   * @returns {Promise<Object>}
   */
  async handshake() {
    const frame = frameBuilder.buildHandshake();
    return this._executarComando('handshake', frame, {
      comando: COMANDOS.HANDSHAKE,
      timeout: TIMEOUTS.handshake
    });
  }

  /**
   * Status da balança via protocolo.
   * @returns {Promise<Object>}
   */
  async status() {
    if (!this.conectado) {
      return this._resposta({
        metodo: 'status',
        sucesso: false,
        online: false,
        mensagem: 'Não conectado'
      });
    }

    const frame = frameBuilder.buildStatus();
    const resultado = await this._executarComando('status', frame, {
      comando: COMANDOS.STATUS,
      timeout: TIMEOUTS.comando
    });

    const statusParse = resultado.parsed
      ? this.parser.parseStatus(resultado.parsed.bruto || resultado.hex_recebido)
      : null;

    return this._resposta({
      metodo: 'status',
      online: statusParse?.online ?? resultado.sucesso,
      status: statusParse,
      monitor: this.obterMonitor(),
      ...resultado
    });
  }

  /** @deprecated Use status() */
  async obterStatus() {
    return this.status();
  }

  /**
   * @param {Object} produtoToledo
   * @returns {Promise<Object>}
   */
  async enviarProduto(produtoToledo) {
    const frame = frameBuilder.buildProduto(produtoToledo);
    return this._executarComando('enviarProduto', frame, {
      comando: COMANDOS.ENVIAR_PRODUTO
    });
  }

  /**
   * @param {Object} produtoToledo
   * @returns {Promise<Object>}
   */
  async atualizarProduto(produtoToledo) {
    const frame = frameBuilder.buildFrame(COMANDOS.ATUALIZAR_PRODUTO, produtoToledo);
    return this._executarComando('atualizarProduto', frame, {
      comando: COMANDOS.ATUALIZAR_PRODUTO
    });
  }

  /**
   * @param {string|number} codigo
   * @returns {Promise<Object>}
   */
  async removerProduto(codigo) {
    const frame = frameBuilder.buildRemocaoProduto(codigo);
    return this._executarComando('removerProduto', frame, {
      comando: COMANDOS.REMOVER_PRODUTO
    });
  }

  /**
   * @param {Object} promocaoToledo
   * @returns {Promise<Object>}
   */
  async enviarPromocao(promocaoToledo) {
    const frame = frameBuilder.buildPromocao(promocaoToledo);
    return this._executarComando('enviarPromocao', frame, {
      comando: COMANDOS.ENVIAR_PROMOCAO
    });
  }

  /**
   * @param {Object} departamentoToledo
   * @returns {Promise<Object>}
   */
  async enviarDepartamento(departamentoToledo) {
    const frame = frameBuilder.buildDepartamento(departamentoToledo);
    return this._executarComando('enviarDepartamento', frame, {
      comando: COMANDOS.ENVIAR_DEPARTAMENTO
    });
  }

  /**
   * @param {Object} etiquetaToledo
   * @returns {Promise<Object>}
   */
  async enviarEtiqueta(etiquetaToledo) {
    const frame = frameBuilder.buildFrame(COMANDOS.ENVIAR_ETIQUETA, etiquetaToledo);
    return this._executarComando('enviarEtiqueta', frame, {
      comando: COMANDOS.ENVIAR_ETIQUETA
    });
  }

  /**
   * @param {Object[]} itens
   * @returns {Promise<Object>}
   */
  async enviarLote(itens) {
    const frame = frameBuilder.buildFrame(COMANDOS.ENVIAR_LOTE, { itens: itens || [] });
    return this._executarComando('enviarLote', frame, {
      comando: COMANDOS.ENVIAR_LOTE,
      timeout: TIMEOUTS.comando * 2
    });
  }

  /**
   * Solicita leitura de peso.
   * @returns {Promise<Object>}
   */
  async receberPeso() {
    const frame = frameBuilder.buildFrame(COMANDOS.RECEBER_PESO, null);
    const resultado = await this._executarComando('receberPeso', frame, {
      comando: COMANDOS.RECEBER_PESO,
      timeout: TIMEOUTS.receberPeso
    });

    const peso = this.parser.parsePeso(resultado.parsed?.bruto);
    return this._resposta({
      metodo: 'receberPeso',
      peso,
      ...resultado
    });
  }

  /**
   * @returns {Promise<Object>}
   */
  async receberStatus() {
    return this.status();
  }

  /**
   * Leitura TCP bruta (com PacketLogger).
   * @param {Object} [opcoes]
   * @returns {Promise<Object>}
   */
  async read(opcoes = {}) {
    try {
      const res = await this._transport().read(opcoes);
      // RC14.14.10 — nunca acessar .dados em null (CM.receive → Buffer|null)
      const dados = this._extrairBufferRx(res);
      if (dados && dados.length) {
        packetLogger.log('RX', dados, {
          chave: this._chave,
          equipamento_id: this.config.equipamento_id,
          host: this.config.host,
          ip: this.config.ip ?? this.config.host,
          porta: this.config.porta,
          driver: this.config.driver,
          firmware: this.config.firmware ?? null,
          comando: opcoes.comando || null,
          operacao: opcoes.operacao || null,
          tempo_ms: opcoes.tempo_ms ?? null,
          tentativa: opcoes.tentativa ?? opcoes.retry ?? null
        });
      } else {
        await loggerService.warn('Timeout de leitura — nenhuma resposta da balança', {
          operacao: 'protocol.timeout',
          equipamento_id: this.config.equipamento_id,
          contexto: { chave: this._chave, operacao: 'read' }
        });
        return this._resposta({
          metodo: 'read',
          sucesso: false,
          timeout: true,
          dados: null,
          mensagem: 'Nenhuma resposta recebida da balança.'
        });
      }
      const base = (res && typeof res === 'object' && !Buffer.isBuffer(res)) ? res : {};
      return this._resposta({ metodo: 'read', dados, ...base });
    } catch (err) {
      if (/timeout|Nenhuma resposta/i.test(err.message)) {
        await loggerService.warn('Timeout de leitura', {
          operacao: 'protocol.timeout',
          equipamento_id: this.config.equipamento_id,
          contexto: { chave: this._chave, operacao: 'read' }
        });
      }
      throw err;
    }
  }

  /**
   * Escrita TCP bruta (com PacketLogger).
   * @param {Buffer|string} dados
   * @param {Object} [meta]
   * @returns {Promise<Object>}
   */
  async write(dados, meta = {}) {
    const buf = Buffer.isBuffer(dados) ? dados : Buffer.from(String(dados));

    const entry = packetLogger.log('TX', buf, {
      chave: this._chave,
      equipamento_id: this.config.equipamento_id,
      host: this.config.host,
      ip: this.config.ip ?? this.config.host,
      porta: this.config.porta,
      driver: this.config.driver,
      firmware: this.config.firmware ?? null,
      comando: meta.comando || null,
      operacao: meta.operacao || null,
      tempo_ms: meta.tempo_ms ?? null,
      tentativa: meta.tentativa ?? meta.retry ?? null
    });

    const res = await this._transport().write(buf);
    const bytes = typeof res === 'number' ? res : (res?.bytes ?? buf.length);
    const extras = (res && typeof res === 'object') ? res : {};
    return this._resposta({ metodo: 'write', hex: entry.hex, bytes, ...extras });
  }

  /**
   * @param {number} [ms]
   * @returns {number}
   */
  timeout(ms) {
    return this._transport().timeout(ms);
  }

  /**
   * @returns {Promise<Object>}
   */
  async reconnect() {
    if (!this._chave) {
      return this.connect();
    }

    try {
      const resultado = await connectionManager.reconectar(this._chave);
      this._entrada = connectionManager.obter(this._chave);
      this.conectado = this._entrada?.transport?.isConnected() === true;

      await loggerService.info('Reconexão concluída', {
        operacao: 'protocol.reconexao',
        equipamento_id: this.config.equipamento_id,
        contexto: { chave: this._chave }
      });

      return this._resposta({
        metodo: 'reconnect',
        ...resultado,
        monitor: connectionMonitor.obterStatus(this._chave)
      });
    } catch (err) {
      await loggerService.error('Reconexão falhou', {
        operacao: 'protocol.reconexao.erro',
        equipamento_id: this.config.equipamento_id,
        contexto: { erro: err.message, chave: this._chave }
      });
      throw err;
    }
  }

  /**
   * @returns {Object}
   */
  obterMonitor() {
    if (!this._chave) {
      return connectionMonitor.obterStatus(`${this.config.host}:${this.config.porta}`);
    }
    return connectionMonitor.obterStatus(this._chave);
  }
}

module.exports = ToledoPrix4Protocol;
