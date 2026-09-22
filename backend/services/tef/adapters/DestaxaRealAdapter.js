'use strict';

const BaseAdapter = require('./BaseAdapter');
const tefContrato = require('../tefContrato');
const DestaxaNativeBridge = require('../destaxa/DestaxaNativeBridge');
const {
  PROVIDER,
  ESTADOS,
  OPERACOES,
  FINALIZACAO_CONFIRMAR,
  FINALIZACAO_CANCELAR
} = require('../destaxa/destaxaConstantes');

/**
 * Adapter real Destaxa — adapta o contrato TEF do CDS ao DestaxaNativeBridge.
 * Não contém FFI/DLL. CRT real/PIX/EST não são executados — protocolo via mock.
 */
class DestaxaRealAdapter extends BaseAdapter {
  constructor(config = {}, opcoes = {}) {
    super(config);
    this.nome = 'Destaxa';
    this.modo = 'real';
    this.bridge = opcoes.bridge || new DestaxaNativeBridge({
      config,
      nativeLoader: opcoes.nativeLoader,
      resolver: opcoes.resolver,
      arch: opcoes.arch
    });
  }

  async diagnosticar() {
    this.bridge.load();
    const atual = this.bridge.getDiagnostics();
    const dllOk = atual.dllLoaded === true && atual.exportsValid === true;

    return tefContrato.criarRespostaDiagnostico({
      sucesso: dllOk,
      mensagem: dllOk
        ? (atual.clientInitialized
          ? 'Client Destaxa inicializado'
          : 'DLL Destaxa carregada e exports validados — Client ainda não inicializado; TEF não disponível para pagamento')
        : (atual.ultimoErro?.mensagem || 'Diagnóstico Destaxa incompleto'),
      detalhes: atual
    });
  }

  async testarConexao() {
    const client = this.bridge.iniciarClient(this.config);
    return tefContrato.criarRespostaDiagnostico({
      sucesso: client.sucesso === true,
      mensagem: client.mensagem,
      detalhes: {
        ...client.diagnostico,
        codigoDestaxa: client.codigoDestaxa || null,
        estado: client.estado,
        entrada: client.entrada || null,
        tamanhoEntrada: client.tamanhoEntrada || null
      }
    });
  }

  _normalizarRespostaProtocolo(resultado) {
    if (!resultado) {
      return { sucesso: false, mensagem: 'Resposta Destaxa vazia' };
    }
    return {
      sucesso: resultado.sucesso === true,
      codigoDestaxa: resultado.codigoDestaxa || resultado.codigo || null,
      classificacao: resultado.classificacao || null,
      financialState: resultado.financialState || null,
      estado: resultado.estado || null,
      acao: resultado.acao || null,
      requerContinuacao: resultado.requerContinuacao === true,
      saida: resultado.saida || '',
      contexto: resultado.contexto || null,
      mensagem: resultado.descricao || resultado.mensagem || '',
      retryAllowed: resultado.retryAllowed === true,
      retryReason: resultado.retryReason || null,
      confirmacao: resultado.confirmacao,
      confirmacaoDescricao: resultado.confirmacaoDescricao
    };
  }

  configurarMockTransacao(passos) {
    return this.bridge.configurarDriverTransacaoMock(passos);
  }

  async iniciarTransacao(dados = {}) {
    const operacao = dados.operacao || dados.funcao || OPERACOES.CRT;
    const campos = dados.campos && typeof dados.campos === 'object' ? dados.campos : dados;
    const resultado = this.bridge.iniciarTransacaoDestaxa(operacao, campos);
    return this._normalizarRespostaProtocolo(resultado);
  }

  async continuarTransacao(contexto = {}) {
    const resposta = contexto.resposta != null ? contexto : contexto.entrada || contexto;
    const resultado = this.bridge.continuarTransacaoDestaxa(resposta);
    return this._normalizarRespostaProtocolo(resultado);
  }

  async finalizarTransacao(contexto = {}) {
    let confirmacao = contexto.confirmacao;
    if (confirmacao == null && contexto.confirmar === true) confirmacao = FINALIZACAO_CONFIRMAR;
    if (confirmacao == null && contexto.confirmar === false) confirmacao = FINALIZACAO_CANCELAR;
    const resultado = this.bridge.finalizarTransacaoDestaxa(confirmacao);
    return this._normalizarRespostaProtocolo(resultado);
  }

  async autorizarPagamento() {
    return tefContrato.criarRespostaAutorizacao({
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      adquirente: PROVIDER,
      codigo: 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA',
      mensagem: 'Autorização financeira Destaxa bloqueada — use iniciarTransacao/continuarTransacao com mock nesta sprint',
      modo: this.modo
    });
  }

  async cancelarPagamento(dados) {
    const info = this._normalizarDadosCancelamento(dados);
    return tefContrato.criarRespostaCancelamento({
      sucesso: false,
      status: tefContrato.STATUS.ERRO,
      nsu: info.nsu,
      autorizacao: info.autorizacao,
      transacaoId: info.transacao_id,
      codigo: 'DESTAXA_TRANSACAO_NAO_IMPLEMENTADA',
      mensagem: 'TEF-DESTAXA-02: cancelamento Destaxa não implementado nesta sprint',
      modo: this.modo
    });
  }

  async status() {
    const diag = await this.diagnosticar();
    return {
      ativo: diag.detalhes?.clientInitialized === true,
      provedor: this.nome,
      modo: this.modo,
      estado: diag.detalhes?.estado || ESTADOS.DLL_NOT_FOUND,
      ...diag.detalhes
    };
  }
}

module.exports = DestaxaRealAdapter;
