/**
 * ToledoPrix4UnoDriver — Driver oficial Toledo Prix 4 Uno.
 *
 * Herda BaseDriver. Arquitetura completa sem comunicação real.
 * Firmware conhecido: 90AX | Comunicação prevista: Ethernet TCP
 *
 * @class ToledoPrix4UnoDriver
 */

const BaseDriver = require('../../BaseDriver');
const ToledoPrix4Protocol = require('./ToledoPrix4Protocol');
const ToledoPrix4Parser = require('./ToledoPrix4Parser');
const ToledoPrix4Validator = require('./ToledoPrix4Validator');
const ToledoPrix4Mapper = require('./ToledoPrix4Mapper');
const ToledoPrix4Discovery = require('./ToledoPrix4Discovery');
const ToledoPrix4Diagnostics = require('./ToledoPrix4Diagnostics');
const {
  FABRICANTE,
  MODELO,
  CODIGO_DRIVER,
  VERSAO_DRIVER,
  PROTOCOLOS,
  TRANSPORTES,
  PORTAS_PADRAO,
  FIRMWARE_CONHECIDO
} = require('./ToledoPrix4Constants');
const { ToledoPrix4ValidationError } = require('./ToledoPrix4Errors');
const connectionMonitor = require('../../../monitor/ConnectionMonitor');
const perfilOficial = require('./ToledoOficialPerfil');
const core = require('../../comum/oficial/DriverOficialCore');
const frameBuilder = require('./ToledoPrix4FrameBuilder');

class ToledoPrix4UnoDriver extends BaseDriver {
  /**
   * Sprint 15.0 — metadados de discovery Ethernet (auto-detecção).
   * Portas: 9000 (implantação V1) + 9100/4001 (legado Prix 4).
   */
  static get discovery() {
    return {
      transport: 'ethernet',
      ports: [Number(PORTAS_PADRAO.ethernet) || 9000, 9100, Number(PORTAS_PADRAO.alternativa) || 4001],
      timeout: 500,
      priority: 1,
      driver: CODIGO_DRIVER
    };
  }

  getDiscoveryProfile() {
    return ToledoPrix4UnoDriver.discovery;
  }

  /**
   * Frame de identificação enviado no probe TCP.
   * @returns {Buffer}
   */
  buildProbe() {
    return frameBuilder.buildHandshake();
  }

  /**
   * @param {Buffer} rx
   * @returns {boolean}
   */
  matches(rx) {
    const buf = Buffer.isBuffer(rx) ? rx : Buffer.from(rx || []);
    if (!buf.length) return false;
    // STX + comando 2 bytes (HS/AK/RS/ST/PN…)
    if (buf[0] === 0x02 && buf.length >= 3) {
      const cmd = buf.slice(1, 3).toString('ascii');
      if (/^[A-Z0-9]{2}$/.test(cmd)) return true;
    }
    // Resposta ASCII com marcas Toledo / Prix
    const ascii = buf.toString('ascii').toUpperCase();
    if (ascii.includes('TOLEDO') || ascii.includes('PRIX') || ascii.includes('90AX')) {
      return true;
    }
    // Qualquer frame com STX/ETX
    return buf.includes(0x02) && buf.includes(0x03);
  }

  /**
   * @param {Buffer} rx
   * @returns {object}
   */
  parseIdentity(rx) {
    const buf = Buffer.isBuffer(rx) ? rx : Buffer.from(rx || []);
    let versao = FIRMWARE_CONHECIDO[0] || '90AX';
    let confianca = 0.85;
    try {
      const parsed = this.parser?.parseFrame?.(buf);
      if (parsed) {
        confianca = 0.98;
        if (parsed.comando === 'RS' || parsed.comando === 'AK' || parsed.comando === 'ST') {
          try {
            const status = this.parser.parseStatus?.(buf);
            if (status?.firmware) versao = status.firmware;
          } catch (_) { /* ignore */ }
        }
      } else if (this.matches(buf)) {
        confianca = 0.9;
      }
      const ascii = buf.toString('ascii');
      const m = /90A[X0-9]/i.exec(ascii);
      if (m) versao = m[0].toUpperCase();
    } catch (_) { /* ignore */ }

    return {
      driver: CODIGO_DRIVER,
      fabricante: FABRICANTE,
      modelo: MODELO,
      versao,
      firmware: versao,
      protocolo: PROTOCOLOS[0] || 'toledo-prix4',
      confianca,
      timeout: ToledoPrix4UnoDriver.discovery.timeout
    };
  }

  constructor(config = {}) {
    super(config);
    this.modo = 'oficial';
    this.protocol = new ToledoPrix4Protocol(config);
    this.parser = new ToledoPrix4Parser();
    this.validator = new ToledoPrix4Validator();
    this.mapper = new ToledoPrix4Mapper();
    this.discovery = new ToledoPrix4Discovery();
    this.diagnostics = new ToledoPrix4Diagnostics(this);
    this._identidadeOficial = core.montarIdentidade(perfilOficial);
    this._configRuntime = {};
    this._configBackup = null;
    this._ultimaLatenciaMs = null;
    this._filaSync = 0;
    this._metricasHealth = {
      latencia_ms: null,
      erro_protocolo: false,
      fila: 0,
      timeout: false,
      firmware_incompativel: false,
      desconectado: true
    };
    for (const c of core.schemaConfigPadrao(perfilOficial).campos) {
      this._configRuntime[c.chave] = c.padrao;
    }
  }

  fabricante() { return FABRICANTE; }
  modelo() { return MODELO; }
  versao() { return perfilOficial.versao || VERSAO_DRIVER; }

  transportesSuportados() {
    return [...TRANSPORTES];
  }

  heartbeatPerfil() {
    return { ...perfilOficial.heartbeat };
  }

  contribuirHealth(metricas = {}) {
    this._metricasHealth = {
      ...this._metricasHealth,
      ...metricas,
      desconectado: this.protocol?.conectado !== true,
      fila: this._filaSync
    };
    if (metricas.latencia_ms != null) this._ultimaLatenciaMs = metricas.latencia_ms;
    return core.calcularHealthDriver(perfilOficial, this._metricasHealth);
  }

  healthScore(metricas = {}) {
    return this.contribuirHealth(metricas);
  }

  informacoes() {
    return {
      codigo: CODIGO_DRIVER,
      fabricante: this.fabricante(),
      modelo: this.modelo(),
      versao: this.versao(),
      firmware_conhecido: [...perfilOficial.firmware_conhecido],
      protocolos: [...PROTOCOLOS],
      transportes: this.transportesSuportados(),
      status: this.modo,
      modo: this.modo,
      oficial: true,
      capacidades: core.montarCapacidades(perfilOficial),
      identidade: { ...this._identidadeOficial },
      heartbeat: this.heartbeatPerfil(),
      suporta_comunicacao_real: true,
      comunicacao_real: this.protocol?.conectado === true
    };
  }

  async handshake() {
    const passos = [...(perfilOficial.handshake?.passos || [])];
    const evidencias = [];
    let comunicacaoReal = false;

    if (this.protocol?.conectado) {
      try {
        const inicio = Date.now();
        if (typeof this.protocol.handshake === 'function') {
          await this.protocol.handshake();
        } else if (typeof this.protocol.ping === 'function') {
          await this.protocol.ping();
        }
        this._ultimaLatenciaMs = Date.now() - inicio;
        comunicacaoReal = true;
        for (const passo of passos) {
          evidencias.push({ passo, ok: true, em: new Date().toISOString() });
        }
      } catch (err) {
        for (const passo of passos) {
          evidencias.push({ passo, ok: false, erro: err.message, em: new Date().toISOString() });
        }
        this.contribuirHealth({ erro_protocolo: true, timeout: /timeout/i.test(err.message) });
      }
    } else {
      for (const passo of passos) {
        evidencias.push({ passo, ok: true, simulado: true, em: new Date().toISOString() });
      }
    }

    this._identidadeOficial = core.montarIdentidade(perfilOficial, {
      numero_serie: this._identidadeOficial.numero_serie
        || `TOL-${Date.now().toString(36).toUpperCase()}`,
      firmware: this.config?.firmware || this._identidadeOficial.firmware || '90AX',
      handshake_em: new Date().toISOString()
    });

    return {
      sucesso: true,
      simulado: !comunicacaoReal,
      comunicacao_real: comunicacaoReal,
      oficial: true,
      metodo: 'handshake',
      passos,
      evidencias,
      identidade: this._identidadeOficial,
      latencia_ms: this._ultimaLatenciaMs,
      driver: this.informacoes(),
      timestamp: new Date().toISOString()
    };
  }

  async identificar() {
    if (!this._identidadeOficial.numero_serie) {
      await this.handshake();
    }
    return {
      sucesso: true,
      oficial: true,
      metodo: 'identificar',
      identidade: {
        ...this._identidadeOficial,
        modelo: this.modelo(),
        versao: this.versao()
      },
      driver: this.informacoes(),
      timestamp: new Date().toISOString()
    };
  }

  async lerConfiguracao() {
    return {
      sucesso: true,
      oficial: true,
      metodo: 'lerConfiguracao',
      configuracao: { ...this._configRuntime, ...this.config },
      schema: core.schemaConfigPadrao(perfilOficial),
      driver: this.informacoes(),
      timestamp: new Date().toISOString()
    };
  }

  async compararConfiguracao(desejada = {}) {
    const cmp = core.compararConfig(
      { ...this._configRuntime, ...this.config },
      desejada
    );
    return {
      sucesso: true,
      oficial: true,
      metodo: 'compararConfiguracao',
      ...cmp,
      driver: this.informacoes()
    };
  }

  async aplicarConfiguracao(cfg = {}) {
    this._configRuntime = { ...this._configRuntime, ...(cfg || {}) };
    this.config = { ...this.config, ...this._configRuntime };
    if (this.protocol && typeof this.protocol.configurar === 'function') {
      this.protocol.configurar(this.config);
    }
    return {
      sucesso: true,
      oficial: true,
      metodo: 'aplicarConfiguracao',
      configuracao: { ...this._configRuntime },
      driver: this.informacoes(),
      timestamp: new Date().toISOString()
    };
  }

  async backupConfiguracao() {
    this._configBackup = {
      em: new Date().toISOString(),
      configuracao: { ...this._configRuntime, ...this.config }
    };
    return {
      sucesso: true,
      oficial: true,
      metodo: 'backupConfiguracao',
      backup: this._configBackup,
      driver: this.informacoes(),
      timestamp: new Date().toISOString()
    };
  }

  async restaurarConfiguracao(backup = null) {
    const fonte = backup?.configuracao || this._configBackup?.configuracao;
    if (!fonte) {
      return {
        sucesso: false,
        oficial: true,
        metodo: 'restaurarConfiguracao',
        mensagem: 'Nenhum backup disponível',
        driver: this.informacoes()
      };
    }
    return this.aplicarConfiguracao(fonte);
  }

  async sincronizarConfiguracoes(cfg = {}) {
    return this.aplicarConfiguracao(cfg);
  }


  /**
   * @param {string} metodo
   * @param {Object} protocolo
   * @param {Object} [extras]
   * @returns {Object}
   * @private
   */
  _resultadoProtocolo(metodo, protocolo, extras = {}) {
    return {
      sucesso: protocolo?.sucesso !== false,
      simulado: protocolo?.simulado !== false,
      comunicacao_real: protocolo?.comunicacao_real !== false,
      driver: this.informacoes(),
      metodo,
      protocolo,
      timestamp: new Date().toISOString(),
      ...extras
    };
  }

  /**
   * @param {string} metodo
   * @param {Object} [extras]
   * @returns {Object}
   * @private
   */
  _stub(metodo, extras = {}) {
    return {
      sucesso: true,
      simulado: true,
      comunicacao_real: false,
      driver: this.informacoes(),
      metodo,
      mensagem: `${metodo} simulado — fora do escopo Sprint 11A`,
      timestamp: new Date().toISOString(),
      ...extras
    };
  }

  /**
   * @param {Object} val
   * @param {string} contexto
   * @private
   */
  _garantirValido(val, contexto) {
    if (!val.valido) {
      throw new ToledoPrix4ValidationError(
        `Validação falhou: ${contexto}`,
        val.erros
      );
    }
  }

  async conectar() {
    const val = this.validator.validarConfiguracao(this.config);
    if (!val.valido) {
      throw new ToledoPrix4ValidationError('Configuração inválida', val.erros);
    }

    this.protocol.configurar(this.config);
    const resultado = await this.protocol.connect();
    this.modo = 'tcp';

    return {
      sucesso: true,
      simulado: false,
      comunicacao_real: true,
      driver: this.informacoes(),
      metodo: 'conectar',
      validacao: val,
      conexao: resultado,
      monitor: this.protocol.obterMonitor()
    };
  }

  async desconectar() {
    const resultado = await this.protocol.disconnect();
    this.modo = 'estrutura';

    return {
      sucesso: true,
      simulado: false,
      comunicacao_real: true,
      driver: this.informacoes(),
      metodo: 'desconectar',
      conexao: resultado,
      monitor: connectionMonitor.obterStatus(`${this.config.host || this.config.ip}:${this.config.porta || PORTAS_PADRAO.ethernet || 9000}`)
    };
  }

  async configurar(cfg) {
    const config = cfg || this.config;
    const val = this.validator.validarConfiguracao(config);
    if (!val.valido) {
      throw new ToledoPrix4ValidationError('Configuração inválida', val.erros);
    }

    this.config = { ...this.config, ...config };
    const proto = this.protocol.configurar(this.config);

    return {
      sucesso: true,
      simulado: false,
      comunicacao_real: true,
      driver: this.informacoes(),
      metodo: 'configurar',
      validacao: val,
      protocolo: proto
    };
  }

  async status() {
    if (!this.protocol.conectado) {
      return this._resultadoProtocolo('status', {
        sucesso: false,
        online: false,
        mensagem: 'Não conectado'
      }, { online: false });
    }

    const proto = await this.protocol.status();
    return this._resultadoProtocolo('status', proto, {
      online: proto.online === true,
      monitor: this.protocol.obterMonitor()
    });
  }

  async diagnostico() {
    return this.diagnostics.executar();
  }

  async descobrir(opcoes = {}) {
    const resultado = await this.discovery.descobrir({
      ...this.config,
      ...opcoes,
      transporte: 'ethernet'
    });
    const candidatos = Array.isArray(resultado?.candidatos) ? resultado.candidatos : [];
    const erros = Array.isArray(resultado?.erros) ? resultado.erros : [];
    return {
      sucesso: true,
      simulado: false,
      comunicacao_real: true,
      candidatos,
      erros,
      meta: resultado?.meta || {},
      driver: this.informacoes(),
      metodo: 'descobrir',
      timestamp: new Date().toISOString()
    };
  }

  async sincronizarProduto(produto) {
    const val = this.validator.validarProduto(produto);
    this._garantirValido(val, 'produto');
    const toledo = this.mapper.mapProduto(produto);
    const plu = core.mapearProdutoPlu(produto, perfilOficial);

    if (!this.protocol?.conectado) {
      return this._resultadoProtocolo('sincronizarProduto', {
        sucesso: true,
        simulado: true,
        comunicacao_real: false,
        mensagem: 'Sync PLU estruturado — conecte para envio real'
      }, { validacao: val, produto: toledo, plu });
    }

    const proto = await this.protocol.enviarProduto(toledo);
    return this._resultadoProtocolo('sincronizarProduto', proto, {
      validacao: val,
      produto: toledo,
      plu
    });
  }

  async sincronizarProdutos(produtos) {
    const lista = produtos || [];
    const mapeados = [];
    const erros = [];

    for (const item of lista) {
      try {
        const val = this.validator.validarProduto(item);
        if (!val.valido) {
          erros.push({ item, erros: val.erros });
          continue;
        }
        mapeados.push(this.mapper.mapProduto(item));
      } catch (error) {
        erros.push({ item, erros: [error.message] });
      }
    }

    this._filaSync = mapeados.length;
    this.contribuirHealth({ fila: this._filaSync });

    if (!this.protocol?.conectado) {
      return this._resultadoProtocolo('sincronizarProdutos', {
        sucesso: erros.length === 0,
        simulado: true,
        comunicacao_real: false
      }, {
        quantidade: lista.length,
        mapeados: mapeados.length,
        plus: mapeados.map((p) => core.mapearProdutoPlu(p, perfilOficial)),
        erros,
        plu: true
      });
    }

    const proto = mapeados.length > 0
      ? await this.protocol.enviarLote(mapeados)
      : null;

    return this._resultadoProtocolo('sincronizarProdutos', proto || { sucesso: erros.length === 0 }, {
      quantidade: lista.length,
      mapeados: mapeados.length,
      erros,
      plu: true
    });
  }

  async sincronizarPromocao(promocao) {
    const val = this.validator.validarPromocao(promocao);
    this._garantirValido(val, 'promoção');
    const toledo = this.mapper.mapPromocao(promocao);
    if (!this.protocol?.conectado) {
      return this._resultadoProtocolo('sincronizarPromocao', {
        sucesso: true, simulado: true, comunicacao_real: false
      }, { validacao: val, promocao: toledo });
    }
    const proto = await this.protocol.enviarPromocao(toledo);
    return this._resultadoProtocolo('sincronizarPromocao', proto, {
      validacao: val,
      promocao: toledo
    });
  }

  async sincronizarDepartamento(departamento) {
    const val = this.validator.validarDepartamento(departamento);
    this._garantirValido(val, 'departamento');
    const toledo = this.mapper.mapDepartamento(departamento);
    if (!this.protocol?.conectado) {
      return this._resultadoProtocolo('sincronizarDepartamento', {
        sucesso: true, simulado: true, comunicacao_real: false
      }, { validacao: val, departamento: toledo });
    }
    const proto = await this.protocol.enviarDepartamento(toledo);
    return this._resultadoProtocolo('sincronizarDepartamento', proto, {
      validacao: val,
      departamento: toledo
    });
  }

  async sincronizarEtiqueta(etiqueta) {
    const val = this.validator.validarEtiqueta(etiqueta);
    this._garantirValido(val, 'etiqueta');
    const toledo = this.mapper.mapEtiqueta(etiqueta);
    if (!this.protocol?.conectado) {
      return this._resultadoProtocolo('sincronizarEtiqueta', {
        sucesso: true, simulado: true, comunicacao_real: false
      }, { validacao: val, etiqueta: toledo });
    }
    const proto = await this.protocol.enviarEtiqueta(toledo);
    return this._resultadoProtocolo('sincronizarEtiqueta', proto, {
      validacao: val,
      etiqueta: toledo
    });
  }

  async removerProduto(codigo) {
    if (!this.protocol?.conectado) {
      return this._resultadoProtocolo('removerProduto', {
        sucesso: true, simulado: true, comunicacao_real: false
      }, { codigo });
    }
    const proto = await this.protocol.removerProduto(codigo);
    return this._resultadoProtocolo('removerProduto', proto, { codigo });
  }

  async obterPeso() {
    const proto = await this.protocol.receberPeso();
    const peso = proto.peso || this.parser.parsePeso(proto.parsed?.bruto);
    const val = this.validator.validarPeso(peso);
    return this._resultadoProtocolo('obterPeso', proto, { ...peso, validacao: val });
  }

  async zerar() {
    return this._stub('zerar');
  }

  async reiniciar() {
    return this._stub('reiniciar');
  }
}

module.exports = ToledoPrix4UnoDriver;
