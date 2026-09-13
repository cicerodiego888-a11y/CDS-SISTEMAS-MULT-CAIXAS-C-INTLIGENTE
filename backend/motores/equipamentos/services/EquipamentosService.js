/**
 * EquipamentosService — Regras de negócio do cadastro de equipamentos (Sprint 9).
 *
 * Orquestra repositório, transporte TCP, drivers e logs.
 * Controllers devem delegar a este serviço.
 */

const equipamentosRepository = require('../repositories/EquipamentosRepository');
const driverManager = require('../core/DriverManager');
const connectionManager = require('../connection/ConnectionManager');
const { PORTA_PADRAO } = require('../drivers/toledo/ToledoProtocol');
const ToledoTimeouts = require('../drivers/toledo/ToledoTimeouts');
const equipamentosEvents = require('../events/EquipamentosEvents');
const loggerService = require('./LoggerService');
const diagnosticoService = require('../diagnostics/DiagnosticoService');
const layoutEtiquetaService = require('./LayoutEtiquetaService');

class EquipamentosService {
  /**
   * @param {Object} dados
   * @returns {Promise<Object>}
   * @private
   */
  async _resolverDriver(dados) {
    const payload = { ...dados };
    if (payload.driver_codigo) {
      try {
        const identity = require('../sdk/DriverIdentityResolver');
        payload.driver_codigo = identity.canonical(payload.driver_codigo) || payload.driver_codigo;
      } catch (_) { /* ignore */ }
    }
    if (payload.driver_codigo && !payload.driver_id) {
      const driverCat = await equipamentosRepository.buscarDriverCatalogoPorCodigo(payload.driver_codigo);
      if (driverCat) {
        payload.driver_id = driverCat.id;
        payload.fabricante = payload.fabricante || driverCat.fabricante;
        payload.modelo = payload.modelo || driverCat.modelo;
      }
    }
    return payload;
  }

  /**
   * @param {Object} eq
   * @returns {Object}
   */
  formatarParaApi(eq) {
    if (!eq) return null;
    const status = String(eq.status || 'desconhecido').toLowerCase();
    return {
      ...eq,
      status,
      status_label: status === 'online' ? 'Online'
        : status === 'offline' ? 'Offline'
        : status === 'erro' ? 'Erro'
        : 'Desconhecido'
    };
  }

  async listar(filtros = {}) {
    const apenasAtivos = filtros.todos !== '1' && filtros.todos !== true;
    const lista = await equipamentosRepository.listar({
      apenasAtivos,
      tipo: filtros.tipo || null,
      status: filtros.status || null,
      transporte: filtros.transporte || null,
      ativo: filtros.ativo,
      busca: filtros.busca || filtros.q || null
    });
    return lista.map((eq) => this.formatarParaApi(eq));
  }

  async buscarPorId(id) {
    const eq = await equipamentosRepository.buscarPorId(id);
    const formatado = this.formatarParaApi(eq);
    if (!formatado) return null;
    formatado.layout_etiqueta = await layoutEtiquetaService.obterLayoutEquipamento(id);
    return formatado;
  }

  async criar(dados) {
    const payload = await this._resolverDriver(dados);
    const { layout_etiqueta: layoutBody, layout_ativo: layoutAtivo, ...rest } = payload;
    const equipamento = await equipamentosRepository.salvar(rest);

    if (layoutBody) {
      await layoutEtiquetaService.salvarLayoutEquipamento(equipamento.id, layoutBody, {
        definirComoAtivo: layoutAtivo === true || layoutAtivo === 1 || layoutAtivo === '1'
      });
    }

    await equipamentosEvents.emitirEquipamentoCriado(equipamento);
    await loggerService.logOperacao(equipamento.id, 'cadastro', { equipamento });
    const formatado = this.formatarParaApi(equipamento);
    formatado.layout_etiqueta = await layoutEtiquetaService.obterLayoutEquipamento(equipamento.id);
    return formatado;
  }

  async editar(id, dados) {
    const payload = await this._resolverDriver(dados);
    const { layout_etiqueta: layoutBody, layout_ativo: layoutAtivo, ...rest } = payload;
    const equipamento = await equipamentosRepository.editar(id, rest);

    if (layoutBody) {
      await layoutEtiquetaService.salvarLayoutEquipamento(id, layoutBody, {
        definirComoAtivo: layoutAtivo === true || layoutAtivo === 1 || layoutAtivo === '1'
      });
    } else if (layoutAtivo === true || layoutAtivo === 1 || layoutAtivo === '1') {
      const existente = await layoutEtiquetaService.obterLayoutEquipamento(id);
      if (existente) {
        await layoutEtiquetaService.definirLayoutAtivo(existente, { equipamentoId: id });
      }
    }

    await equipamentosEvents.emitirEquipamentoEditado(equipamento);
    await loggerService.logOperacao(id, 'edicao', { equipamento });
    const formatado = this.formatarParaApi(equipamento);
    formatado.layout_etiqueta = await layoutEtiquetaService.obterLayoutEquipamento(id);
    return formatado;
  }

  async remover(id) {
    const existente = await equipamentosRepository.buscarPorId(id);
    if (!existente) throw Object.assign(new Error('Equipamento não encontrado'), { statusCode: 404 });

    await connectionManager.disconnect({ equipamentoId: id, id }).catch(() => {});
    const resultado = await equipamentosRepository.remover(id);
    await equipamentosEvents.emitirEquipamentoRemovido({ id: Number(id), equipamento: existente });
    await loggerService.logOperacao(id, 'remocao', { equipamento: existente, resultado });
    return resultado;
  }

  async duplicar(id) {
    const equipamento = await equipamentosRepository.duplicar(id);
    await equipamentosEvents.emitirEquipamentoCriado(equipamento);
    await loggerService.logOperacao(equipamento.id, 'duplicar', { origem_id: id, equipamento });
    return this.formatarParaApi(equipamento);
  }

  async ativar(id) {
    const equipamento = await equipamentosRepository.editar(id, { ativo: true });
    await loggerService.logOperacao(id, 'ativar', { equipamento });
    return this.formatarParaApi(equipamento);
  }

  async desativar(id) {
    await connectionManager.disconnect({ equipamentoId: id, id }).catch(() => {});
    const equipamento = await equipamentosRepository.editar(id, { ativo: false, status: 'offline' });
    await loggerService.logOperacao(id, 'desativar', { equipamento });
    return this.formatarParaApi(equipamento);
  }

  async listarDrivers() {
    return driverManager.listarDriversCompleto();
  }

  async obterResumo() {
    return equipamentosRepository.obterResumoDashboard();
  }

  /**
   * Teste de conexão TCP — RC14.14.8: abre/reutiliza sessão persistente (não fecha o socket).
   * @param {number|string} equipamentoId
   * @returns {Promise<Object>}
   */
  async testarConexao(equipamentoId) {
    const equipamento = await equipamentosRepository.buscarPorId(equipamentoId);
    if (!equipamento) throw Object.assign(new Error('Equipamento não encontrado'), { statusCode: 404 });

    await equipamentosRepository.atualizarUltimoTeste(equipamentoId);

    const driverRegistrado = equipamento.fabricante && equipamento.modelo
      ? driverManager.possuiDriver(equipamento.fabricante, equipamento.modelo)
      : false;

    const driverInfo = driverRegistrado
      ? driverManager.buscarDriver(equipamento.fabricante, equipamento.modelo)
      : null;

    if (equipamento.transporte !== 'ethernet' || !equipamento.ip) {
      const resultado = {
        success: true,
        sucesso: true,
        simulado: true,
        comunicacao_real: false,
        mensagem: 'Teste simulado — configure transporte Ethernet e IP para teste TCP real',
        equipamento_id: Number(equipamentoId),
        equipamento: this.formatarParaApi(equipamento),
        driver_registrado: driverRegistrado,
        timestamp: new Date().toISOString()
      };
      await loggerService.logOperacao(equipamentoId, 'teste', resultado);
      return resultado;
    }

    const config = {
      equipamento_id: Number(equipamentoId),
      host: equipamento.ip,
      porta: equipamento.porta_tcp || PORTA_PADRAO,
      timeoutMs: equipamento.timeout_ms || ToledoTimeouts.CONNECT,
      persistir: true
    };

    try {
      await loggerService.info('Teste de conexão iniciado', {
        operacao: 'teste.conexao',
        equipamento_id: equipamentoId,
        contexto: { host: config.host, porta: config.porta }
      });

      const conexao = await connectionManager.connect({
        host: config.host,
        porta: config.porta,
        timeoutMs: config.timeoutMs,
        equipamentoId: config.equipamento_id,
        persistir: true
      });
      const ping = connectionManager.isConnected({
        host: config.host,
        porta: config.porta
      });
      // RC14.14.8 — NÃO desconectar: sessão permanece CONNECTED + heartbeat

      await equipamentosRepository.atualizarComunicacao(equipamentoId, {
        status: 'online',
        ultimoErro: null
      });

      const atualizado = await equipamentosRepository.buscarPorId(equipamentoId);
      const session = typeof connectionManager.getSessionSnapshot === 'function'
        ? connectionManager.getSessionSnapshot({ host: config.host, porta: config.porta })
        : null;

      const resultado = {
        success: true,
        sucesso: true,
        simulado: false,
        comunicacao_real: true,
        mensagem: conexao.reutilizada
          ? 'Sessão TCP reutilizada (persistente)'
          : 'Conexão TCP estabelecida e mantida (sessão persistente)',
        equipamento_id: Number(equipamentoId),
        equipamento: this.formatarParaApi(atualizado),
        driver_registrado: driverRegistrado,
        driver: driverInfo,
        latencia: conexao.latencia,
        ping,
        conexao: {
          host: config.host,
          porta: config.porta,
          conectado: ping === true,
          reutilizada: Boolean(conexao.reutilizada),
          persistente: true
        },
        session: session?.session || null,
        detalhe_conexao: conexao,
        timestamp: new Date().toISOString()
      };

      await loggerService.logOperacao(equipamentoId, 'teste', resultado);
      await loggerService.info('Conexão testada com sucesso', {
        operacao: 'conexao',
        equipamento_id: equipamentoId
      });

      return resultado;
    } catch (err) {
      await equipamentosRepository.atualizarComunicacao(equipamentoId, {
        status: 'erro',
        ultimoErro: err.message
      });

      await loggerService.error('Erro no teste de conexão', {
        operacao: 'erro',
        equipamento_id: equipamentoId,
        contexto: { erro: err.message }
      });

      const atualizado = await equipamentosRepository.buscarPorId(equipamentoId);

      const resultado = {
        success: false,
        sucesso: false,
        simulado: false,
        comunicacao_real: true,
        mensagem: `Falha na conexão TCP: ${err.message}`,
        equipamento_id: Number(equipamentoId),
        equipamento: this.formatarParaApi(atualizado),
        driver_registrado: driverRegistrado,
        ultimo_erro: err.message,
        timestamp: new Date().toISOString()
      };

      await loggerService.logOperacao(equipamentoId, 'teste', resultado);
      return resultado;
    }
  }

  async obterStatusConexao(equipamentoId) {
    const equipamento = await equipamentosRepository.buscarPorId(equipamentoId);
    if (!equipamento) throw Object.assign(new Error('Equipamento não encontrado'), { statusCode: 404 });

    const conexaoAtiva = connectionManager.health({
      equipamentoId: Number(equipamentoId),
      host: equipamento.ip,
      porta: equipamento.porta_tcp || PORTA_PADRAO
    });

    return {
      equipamento_id: Number(equipamentoId),
      equipamento: this.formatarParaApi(equipamento),
      conexao: conexaoAtiva,
      ultima_comunicacao: equipamento.ultima_comunicacao,
      ultimo_erro: equipamento.ultimo_erro || null
    };
  }

  async diagnosticarEquipamento(equipamentoId) {
    const equipamento = await equipamentosRepository.buscarPorId(equipamentoId);
    if (!equipamento) throw Object.assign(new Error('Equipamento não encontrado'), { statusCode: 404 });

    await equipamentosRepository.atualizarUltimoDiagnostico(equipamentoId);

    const drivers = await this.listarDrivers();
    const driverMeta = drivers.find((d) => d.codigo === equipamento.driver_codigo)
      || drivers.find((d) => d.fabricante === equipamento.fabricante && d.modelo === equipamento.modelo);

    let ping = null;
    let tempoRespostaMs = null;
    const { montarEtapasConexao } = require('../connection/ConnectionStages');
    let etapasConexao = montarEtapasConexao({});
    const porta = equipamento.porta_tcp || PORTA_PADRAO;

    if (equipamento.transporte === 'ethernet' && equipamento.ip) {
      const t0 = Date.now();
      const { classificarErroTcp } = require('../connection/TcpConnectStatus');
      try {
        // RC14.14.8 — diagnóstico reutiliza/mantém a mesma sessão (sem disconnect)
        const r = await connectionManager.connect({
          host: equipamento.ip,
          porta,
          timeoutMs: equipamento.timeout_ms || ToledoTimeouts.CONNECT,
          equipamentoId: Number(equipamentoId),
          persistir: true
        });
        const ok = connectionManager.isConnected({ host: equipamento.ip, porta });
        tempoRespostaMs = r.latencia != null ? r.latencia : (Date.now() - t0);
        ping = { sucesso: ok === true, latencia_ms: tempoRespostaMs };
        etapasConexao = montarEtapasConexao({
          tcp: true,
          tcpCodigo: r.connectCodigo || 'TCP_CONNECT_OK',
          tcpLatenciaMs: tempoRespostaMs,
          handshake: null,
          health: ok === true,
          driver: Boolean(driverMeta),
          incluirRead: true,
          read: null
        });
      } catch (err) {
        const codigo = err.connectCodigo || classificarErroTcp(err);
        ping = { sucesso: false, mensagem: err.message, codigo };
        etapasConexao = montarEtapasConexao({
          tcp: false,
          tcpCodigo: codigo,
          tcpErro: err.message,
          handshake: null,
          health: false,
          healthErro: err.message,
          driver: Boolean(driverMeta),
          incluirRead: true,
          read: null
        });
      }
    } else {
      etapasConexao = montarEtapasConexao({
        tcp: false,
        tcpCodigo: 'TCP_CONNECT_SOCKET_EXCEPTION',
        tcpErro: 'Transporte não ethernet ou IP ausente',
        handshake: null,
        health: false,
        driver: Boolean(driverMeta),
        incluirRead: true,
        read: null
      });
    }

    const resultado = {
      equipamento_id: Number(equipamentoId),
      sucesso: etapasConexao.sucesso,
      mensagem: etapasConexao.sucesso
        ? 'Diagnóstico de equipamento concluído'
        : `Falha na etapa: ${etapasConexao.etapaFalhaTitulo || etapasConexao.etapaFalha}`,
      equipamento: this.formatarParaApi(equipamento),
      etapas_conexao: etapasConexao,
      diagnostico: {
        ping: ping?.sucesso === true ? 'OK' : 'Falhou',
        tempo_resposta_ms: tempoRespostaMs,
        porta,
        ip: equipamento.ip,
        driver: driverMeta?.nome_exibicao || equipamento.driver_nome || equipamento.driver_codigo,
        driver_codigo: equipamento.driver_codigo,
        transporte: equipamento.transporte,
        versao_driver: driverMeta?.versao_driver || driverMeta?.versao || null,
        ultimo_erro: equipamento.ultimo_erro,
        ultima_comunicacao: equipamento.ultima_comunicacao,
        driver_registrado: Boolean(driverMeta?.implementado),
        comunicacao_real: equipamento.transporte === 'ethernet' && Boolean(equipamento.ip)
      },
      timestamp: new Date().toISOString()
    };

    await loggerService.logOperacao(equipamentoId, 'diagnostico', resultado);
    return resultado;
  }

  async executarDiagnosticoGeral(opcoes = {}) {
    return diagnosticoService.executarDiagnosticoCompleto(opcoes);
  }

  async listarLogs(equipamentoId, limite = 50) {
    return equipamentosRepository.listarLogs(equipamentoId, limite);
  }

  listarPresetsLayout() {
    return layoutEtiquetaService.listarPresets();
  }

  async obterLayoutAtivo() {
    return layoutEtiquetaService.obterLayoutAtivo();
  }

  async definirLayoutAtivo(layout) {
    return layoutEtiquetaService.definirLayoutAtivo(layout);
  }

  async obterLayoutEquipamento(id) {
    return layoutEtiquetaService.obterLayoutEquipamento(id);
  }

  async salvarLayoutEquipamento(id, layout, opcoes = {}) {
    return layoutEtiquetaService.salvarLayoutEquipamento(id, layout, opcoes);
  }

  testarParseLayout(codigo, layout) {
    return layoutEtiquetaService.testarParse(codigo, layout);
  }

  async interpretarEtiqueta(codigo, opcoes = {}) {
    return layoutEtiquetaService.interpretarEtiqueta(codigo, opcoes);
  }
}

const equipamentosService = new EquipamentosService();

module.exports = equipamentosService;
module.exports.EquipamentosService = EquipamentosService;
