'use strict';

const BaseAdapter = require('./BaseAdapter');
const SimulatedGatewayAdapter = require('./SimulatedGatewayAdapter');
const tefContrato = require('../tefContrato');

const CODIGO_INDISPONIVEL = 'STONE_REAL_ADAPTER_INDISPONIVEL';

function mensagemIndisponivel(ambiente) {
  return (
    `Integração Stone real ainda não está implementada no CDS `
    + `(ambiente="${ambiente || ''}"). `
    + 'Não há aprovação simulada, NSU ou AUT fictícios fora de simulacao.'
  );
}

function respostaIndisponivel(ambiente, operacao = 'autorizacao') {
  return tefContrato.criarRespostaAutorizacao({
    sucesso: false,
    status: tefContrato.STATUS.ERRO,
    nsu: null,
    autorizacao: null,
    adquirente: 'STONE',
    provedor: 'Stone',
    codigo: CODIGO_INDISPONIVEL,
    mensagem: mensagemIndisponivel(ambiente),
    payloadRetorno: {
      provedor: 'stone',
      ambiente: ambiente || null,
      operacao,
      integracaoReal: false,
      aprovacaoSimuladaBloqueada: true
    },
    modo: 'indisponivel'
  });
}

/**
 * Stone em homologação/produção enquanto não houver adapter real.
 * Nunca aprova e nunca gera NSU/AUT.
 */
class StoneUnavailableAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.nome = 'Stone';
    this.adquirente = 'STONE';
    this.modo = 'indisponivel';
    this.ambiente = config.ambiente || config.tefAmbiente || null;
  }

  async prepararAutorizacao() {
    return {
      pronto: false,
      resposta: respostaIndisponivel(this.ambiente, 'prepararAutorizacao')
    };
  }

  async autorizarPagamento() {
    return respostaIndisponivel(this.ambiente, 'autorizarPagamento');
  }

  async cancelarPagamento() {
    return tefContrato.criarRespostaCancelamento({
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      nsu: null,
      autorizacao: null,
      codigo: CODIGO_INDISPONIVEL,
      mensagem: mensagemIndisponivel(this.ambiente),
      payloadRetorno: {
        provedor: 'stone',
        ambiente: this.ambiente || null,
        aprovacaoSimuladaBloqueada: true
      },
      modo: 'indisponivel'
    });
  }

  async diagnosticar() {
    return tefContrato.criarRespostaDiagnostico({
      sucesso: false,
      mensagem: mensagemIndisponivel(this.ambiente),
      detalhes: {
        provedor: 'Stone',
        modo: this.modo,
        ambiente: this.ambiente,
        codigo: CODIGO_INDISPONIVEL,
        integracaoReal: false,
        middlewareInstalado: false,
        dllEncontrada: false
      }
    });
  }

  async testarConexao() {
    return this.diagnosticar();
  }
}

/**
 * Factory thin do provedor Stone.
 * - simulacao → SimulatedGatewayAdapter (comportamento legado preservado)
 * - demais ambientes → StoneUnavailableAdapter (sem NSU/AUT fictícios)
 *
 * A seleção por ambiente é responsabilidade de tefFactory.criarAdapter;
 * este módulo também recusa construção direta do simulador em homolog/prod.
 */
function StoneAdapter(config = {}) {
  const ambiente = String(config.ambiente || config.tefAmbiente || '').trim().toLowerCase();

  if (ambiente === 'homologacao' || ambiente === 'producao' || ambiente === 'produção') {
    return new StoneUnavailableAdapter(config);
  }

  return new SimulatedGatewayAdapter(config, {
    nome: 'Stone',
    adquirente: 'STONE',
    bandeiraPadrao: 'VISA'
  });
}

module.exports = StoneAdapter;
module.exports.StoneAdapter = StoneAdapter;
module.exports.StoneUnavailableAdapter = StoneUnavailableAdapter;
module.exports.CODIGO_INDISPONIVEL = CODIGO_INDISPONIVEL;
module.exports.respostaIndisponivel = respostaIndisponivel;
