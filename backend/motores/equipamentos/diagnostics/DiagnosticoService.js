/**
 * DiagnosticoService — Diagnóstico do Motor de Equipamentos (sem comunicação real)
 */

const driverManager = require('../core/DriverManager');
const equipamentosRepository = require('../repositories/EquipamentosRepository');
const loggerService = require('../services/LoggerService');

class DiagnosticoService {
  async _verificarBanco() {
    try {
      await equipamentosRepository.listar();
      return { acessivel: true, mensagem: 'Tabelas equipamentos acessíveis' };
    } catch (error) {
      return { acessivel: false, mensagem: error.message };
    }
  }

  async executarDiagnostico() {
    const banco = await this._verificarBanco();
    const equipamentos = await equipamentosRepository.listarAtivos();
    const driversMemoria = driverManager.listarDrivers();
    const driversCatalogo = await equipamentosRepository.listarDriversCatalogo();
    const fila = await equipamentosRepository.contarFilaPendente();

    const pendencias = [];
    if (!banco.acessivel) pendencias.push('Banco de dados inacessível');
    if (driversMemoria.length === 0) {
      pendencias.push('Nenhum driver implementado em memória (esperado nesta sprint)');
    }

    const resultado = {
      sucesso: banco.acessivel,
      mensagem: banco.acessivel ? 'Diagnóstico básico concluído' : 'Falha no diagnóstico',
      timestamp: new Date().toISOString(),
      equipamentos_cadastrados: equipamentos.length,
      drivers_catalogo: driversCatalogo.length,
      drivers_memoria: driversMemoria.length,
      fila_pendente: fila,
      pendencias,
      comunicacao_real: false
    };

    await loggerService.info('Diagnóstico básico executado', {
      operacao: 'diagnostico',
      contexto: resultado
    });

    return resultado;
  }

  async executarDiagnosticoCompleto(opcoes = {}) {
    const basico = await this.executarDiagnostico();
    const drivers = await driverManager.listarDriversCompleto();
    const resumo = await equipamentosRepository.obterResumoDashboard();

    return {
      ...basico,
      sucesso: basico.sucesso,
      mensagem: 'Diagnóstico completo concluído (sem comunicação hardware)',
      secoes: {
        banco: await this._verificarBanco(),
        equipamentos: await equipamentosRepository.listar(),
        drivers,
        resumo,
        fila: { pendente: basico.fila_pendente }
      },
      equipamento_id: opcoes.equipamento_id || null
    };
  }

  async diagnosticarEquipamento(equipamentoId) {
    const equipamento = await equipamentosRepository.buscarPorId(equipamentoId);
    if (!equipamento) {
      throw new Error('Equipamento não encontrado');
    }

    await equipamentosRepository.atualizarUltimoDiagnostico(equipamentoId);

    const driverRegistrado = equipamento.fabricante && equipamento.modelo
      ? driverManager.possuiDriver(equipamento.fabricante, equipamento.modelo)
      : false;

    const resultado = {
      equipamento_id: Number(equipamentoId),
      sucesso: true,
      mensagem: 'Diagnóstico simulado — comunicação hardware não implementada',
      equipamento,
      driver_registrado: driverRegistrado,
      comunicacao_testada: false,
      timestamp: new Date().toISOString()
    };

    await loggerService.logOperacao(equipamentoId, 'diagnostico_equipamento', resultado);

    return resultado;
  }
}

const diagnosticoService = new DiagnosticoService();

module.exports = diagnosticoService;
