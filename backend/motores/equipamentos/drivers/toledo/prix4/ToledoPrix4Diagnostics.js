/**
 * ToledoPrix4Diagnostics — Diagnóstico oficial RC4.0
 */

const ToledoPrix4Validator = require('./ToledoPrix4Validator');
const { FIRMWARE_CONHECIDO, TIMEOUTS } = require('./ToledoPrix4Constants');
const perfil = require('./ToledoOficialPerfil');
const core = require('../../comum/oficial/DriverOficialCore');

class ToledoPrix4Diagnostics {
  /**
   * @param {import('./ToledoPrix4UnoDriver')} driver
   */
  constructor(driver) {
    this.driver = driver;
    this.validator = new ToledoPrix4Validator();
  }

  async verificarConexao() {
    const conectado = this.driver?.protocol?.conectado === true;
    if (conectado) {
      try {
        const ping = await this.driver.protocol.ping();
        return {
          ok: true,
          simulado: false,
          comunicacao_real: true,
          mensagem: 'Conexão TCP ativa',
          ping,
          timeout: TIMEOUTS.conexao
        };
      } catch (err) {
        return {
          ok: false,
          simulado: false,
          comunicacao_real: true,
          mensagem: err.message,
          timeout: TIMEOUTS.conexao
        };
      }
    }
    return {
      ok: false,
      simulado: true,
      comunicacao_real: false,
      mensagem: 'Não conectado — execute conectar() ou discovery',
      timeout: TIMEOUTS.conexao
    };
  }

  async verificarFirmware() {
    const detectado = this.driver?._identidadeOficial?.firmware
      || this.driver?.config?.firmware
      || null;
    const ok = !detectado || FIRMWARE_CONHECIDO.includes(String(detectado).toUpperCase())
      || perfil.firmware_conhecido.includes(String(detectado));
    return {
      ok,
      simulado: !detectado,
      firmwareEsperado: [...perfil.firmware_conhecido],
      firmwareDetectado: detectado,
      mensagem: ok
        ? 'Firmware compatível ou ainda não lido'
        : 'Firmware incompatível com driver oficial'
    };
  }

  gerarRelatorio() {
    const info = this.driver?.informacoes?.() || null;
    return {
      driver: info,
      componentes: {
        protocol: !!this.driver?.protocol,
        parser: !!this.driver?.parser,
        validator: !!this.driver?.validator,
        mapper: !!this.driver?.mapper,
        discovery: !!this.driver?.discovery,
        oficial: true
      },
      comunicacao_real: this.driver?.protocol?.conectado === true,
      timestamp: new Date().toISOString()
    };
  }

  async executar() {
    const conexao = await this.verificarConexao();
    const firmware = await this.verificarFirmware();
    const health = typeof this.driver?.contribuirHealth === 'function'
      ? this.driver.contribuirHealth({
        desconectado: !conexao.ok,
        firmware_incompativel: firmware.ok === false,
        timeout: conexao.ok === false && /timeout/i.test(conexao.mensagem || ''),
        erro_protocolo: false,
        latencia_ms: this.driver._ultimaLatenciaMs || null,
        fila: this.driver._filaSync || 0
      })
      : null;

    const diag = core.montarDiagnostico(perfil, {
      simulado: !conexao.comunicacao_real,
      comunicacao_real: !!conexao.comunicacao_real,
      identidade: this.driver?._identidadeOficial || null,
      health,
      componentes: this.gerarRelatorio().componentes,
      ativos: {
        OFFLINE: !conexao.ok,
        FIRMWARE: firmware.ok === false,
        TIMEOUT: /timeout/i.test(conexao.mensagem || '')
      }
    });

    return {
      sucesso: true,
      simulado: diag.simulado,
      comunicacao_real: diag.comunicacao_real,
      oficial: true,
      mensagem: 'Diagnóstico oficial Toledo Prix 4 Uno',
      driver: this.driver?.informacoes?.() || null,
      conexao,
      firmware,
      alertas: diag.alertas,
      problemas: diag.problemas,
      solucoes: diag.solucoes,
      recomendacoes: diag.recomendacoes,
      itens: diag.itens,
      health,
      comandos: perfil.comandos_diagnostico,
      relatorio: this.gerarRelatorio(),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = ToledoPrix4Diagnostics;
