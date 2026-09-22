/**
 * PDV — Venda para Entrega (UX-03)
 * Botão dedicado laranja: abre modal direto.
 * Após confirmar: "✅ ENTREGA CONFIGURADA" até limpar/cancelar/finalizar.
 * Não altera regras de negócio.
 */
(function (global) {
  'use strict';

  const TITULO_PADRAO = 'ENVIAR PARA ENTREGA';
  const TITULO_OK = 'ENTREGA CONFIGURADA';
  const ICONE_PADRAO = '🚚';
  const ICONE_OK = '✅';

  function obterCarrinhoAtual() {
    try {
      if (typeof global.obterCarrinhoPdv === 'function') {
        const lista = global.obterCarrinhoPdv();
        if (Array.isArray(lista)) return lista;
      }
    } catch (_) { /* ignore */ }
    if (Array.isArray(global.carrinho)) return global.carrinho;
    return [];
  }

  function moduloEntregaAtivo() {
    try {
      if (typeof obterRecursosImplantacao === 'function') {
        return obterRecursosImplantacao().vendasEntrega === true;
      }
    } catch (_) { /* ignore */ }
    // Fallback: classe aplicada por core.js após carregar recursos
    try {
      return !!(document.body && document.body.classList.contains('modulo-vendas-entrega'));
    } catch (_) { /* ignore */ }
    return false;
  }

  function estaConfigurada() {
    return global.pdvEntregaConfigurada === true;
  }

  function obterTotalCarrinho() {
    if (typeof obterTotalVendaPDV === 'function') {
      return Number(obterTotalVendaPDV() || 0);
    }
    return 0;
  }

  function montarPayloadComTerminal(payload) {
    if (typeof getTerminalRequestData === 'function') {
      return getTerminalRequestData(payload);
    }
    if (Number.isInteger(global.terminalId) && global.terminalId > 0) {
      payload.terminal_id = global.terminalId;
    }
    return payload;
  }

  function validarTerminalMultiCaixa(payload) {
    const multiAtivo = typeof implantacaoPermiteMultiCaixa === 'function'
      ? implantacaoPermiteMultiCaixa()
      : !!(document.body && document.body.classList.contains('implantacao-multicaixa'));
    if (!multiAtivo) return;

    const tid = payload.terminal_id
      || (typeof obterTerminalIdPdv === 'function' ? obterTerminalIdPdv() : null)
      || global.terminalId;

    if (!tid) {
      throw new Error('Terminal não registrado. Aguarde o registro do PDV ou reinicie a aplicação.');
    }
  }

  function formatarCepEntrega(valor) {
    const digits = String(valor || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }

  async function buscarCepEntregaPdv() {
    const cep = String($('#entregaCep').val() || '').replace(/\D/g, '');
    if (cep.length !== 8) {
      if (typeof showNotification === 'function') {
        showNotification('Informe um CEP válido com 8 dígitos.', 'warning');
      }
      return;
    }

    const $loading = $('#entregaCepLoading');
    const $btn = $('#btnBuscarCepEntrega');
    $loading.show();
    $btn.prop('disabled', true);

    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await resp.json();
      if (!resp.ok || data.erro) {
        throw new Error('CEP não encontrado.');
      }

      if (data.logradouro) $('#entregaEndereco').val(data.logradouro);
      if (data.bairro) $('#entregaBairro').val(data.bairro);
      if (data.localidade) $('#entregaCidade').val(data.localidade);
      if (data.uf) $('#entregaUf').val(data.uf);
      if (data.complemento && !$('#entregaComplemento').val()) {
        $('#entregaComplemento').val(data.complemento);
      }

      $('#entregaNumero').trigger('focus');
    } catch (err) {
      if (typeof showNotification === 'function') {
        showNotification(err.message || 'Erro ao buscar CEP.', 'danger');
      }
    } finally {
      $loading.hide();
      $btn.prop('disabled', false);
    }
  }

  function vincularBuscaCepEntrega() {
    $('#entregaCep').off('input.entregaCep blur.entregaCep');
    $('#btnBuscarCepEntrega').off('click.entregaCep');

    $('#entregaCep').on('input.entregaCep', function () {
      this.value = formatarCepEntrega(this.value);
    });

    $('#entregaCep').on('blur.entregaCep', function () {
      const cep = String(this.value || '').replace(/\D/g, '');
      if (cep.length === 8) buscarCepEntregaPdv();
    });

    $('#btnBuscarCepEntrega').on('click.entregaCep', function (e) {
      e.preventDefault();
      buscarCepEntregaPdv();
    });
  }

  function preencherCadastroCompletoEntrega(cli) {
    if (!cli) return;
    if (cli.nome) $('#entregaNomeCliente').val(cli.nome);
    if (cli.cpf_cnpj) $('#entregaCpfCnpj').val(cli.cpf_cnpj);
    if (cli.telefone) $('#entregaTelefone').val(cli.telefone);
    if (cli.email) $('#entregaEmail').val(cli.email);
    if (cli.cep) $('#entregaCep').val(formatarCepEntrega(cli.cep));
    if (cli.rua || cli.endereco) $('#entregaEndereco').val(cli.rua || cli.endereco);
    if (cli.numero) $('#entregaNumero').val(cli.numero);
    if (cli.complemento) $('#entregaComplemento').val(cli.complemento);
    if (cli.bairro) $('#entregaBairro').val(cli.bairro);
    if (cli.cidade) $('#entregaCidade').val(cli.cidade);
    if (cli.uf) $('#entregaUf').val(cli.uf);
  }

  function limparCamposClienteEntrega() {
    $('#entregaClienteId').val('');
    $('#entregaClienteBusca').val('');
    $('#entregaNomeCliente').val('');
    $('#entregaCpfCnpj').val('');
    $('#entregaTelefone').val('');
    $('#entregaEmail').val('');
    $('#entregaClienteResultados').empty().hide();
    $('#entregaClienteSelecionado').hide();
    $('#entregaClienteSelecionadoNome').text('');
  }

  function ativarModoConsumidorAvulso() {
    limparCamposClienteEntrega();
    $('#entregaModoCliente').val('avulso');
    $('#boxBuscaClienteEntrega').hide();
    $('#boxConsumidorAvulsoHint').show();
    $('#entregaNomeCliente').prop('readonly', false).trigger('focus');
    $('#entregaCpfCnpj').prop('readonly', false);
    $('#entregaEmail').prop('readonly', false);
  }

  function ativarModoBuscaCliente() {
    $('#entregaModoCliente').val('busca');
    $('#boxBuscaClienteEntrega').show();
    $('#boxConsumidorAvulsoHint').hide();
    limparCamposClienteEntrega();
    $('#entregaNomeCliente').prop('readonly', false);
    $('#entregaCpfCnpj').prop('readonly', false);
    $('#entregaEmail').prop('readonly', false);
    setTimeout(() => $('#entregaClienteBusca').trigger('focus'), 50);
  }

  async function carregarClienteCompletoEntrega(clienteId) {
    const resp = await fetch(`${API_URL}/clientes/${clienteId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    if (!resp.ok) throw new Error('Não foi possível carregar o cadastro do cliente.');
    return resp.json();
  }

  function renderizarResultadosBuscaCliente(lista) {
    const $box = $('#entregaClienteResultados');
    if (!lista.length) {
      $box.html('<div class="list-group-item text-muted small">Nenhum cliente encontrado</div>').show();
      return;
    }
    const html = lista.map((c) => {
      const nome = String(c.nome || '').replace(/</g, '&lt;');
      const tel = String(c.telefone || '').replace(/</g, '&lt;');
      return `<button type="button" class="list-group-item list-group-item-action entrega-cliente-item py-2"
        data-id="${c.id}">
        <div class="fw-semibold">${nome}</div>
        <div class="small text-muted">${tel || 'Sem telefone'}</div>
      </button>`;
    }).join('');
    $box.html(html).show();
  }

  let _buscaClienteTimer = null;
  function vincularBuscaClienteEntrega() {
    $('#entregaClienteBusca').off('input.entregaCli').on('input.entregaCli', function () {
      const termo = String($(this).val() || '').trim();
      clearTimeout(_buscaClienteTimer);
      if (termo.length < 2) {
        $('#entregaClienteResultados').empty().hide();
        return;
      }
      _buscaClienteTimer = setTimeout(async () => {
        try {
          const resp = await fetch(
            `${API_URL}/clientes/buscar?termo=${encodeURIComponent(termo)}`,
            { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
          );
          if (!resp.ok) return;
          const data = await resp.json();
          renderizarResultadosBuscaCliente(Array.isArray(data) ? data : []);
        } catch (_) { /* ignore */ }
      }, 280);
    });

    $('#entregaClienteResultados').off('click.entregaCli').on('click.entregaCli', '.entrega-cliente-item', async function () {
      const id = Number($(this).data('id'));
      if (!id) return;
      try {
        const cli = await carregarClienteCompletoEntrega(id);
        if (!cli || !cli.id) throw new Error('Cliente inválido.');
        $('#entregaClienteId').val(cli.id);
        $('#entregaClienteBusca').val(cli.nome || '');
        $('#entregaClienteResultados').empty().hide();
        $('#entregaClienteSelecionado').show();
        $('#entregaClienteSelecionadoNome').text(cli.nome || `Cliente #${cli.id}`);
        $('#entregaModoCliente').val('cadastrado');
        preencherCadastroCompletoEntrega(cli);
      } catch (err) {
        if (typeof showNotification === 'function') {
          showNotification(err.message || 'Erro ao carregar cliente.', 'danger');
        }
      }
    });

    $('#btnRemoverClienteEntrega').off('click.entregaCli').on('click.entregaCli', function () {
      ativarModoBuscaCliente();
    });

    $('#btnConsumidorAvulsoEntrega').off('click.entregaCli').on('click.entregaCli', function () {
      ativarModoConsumidorAvulso();
    });

    $('#btnVoltarBuscaClienteEntrega').off('click.entregaCli').on('click.entregaCli', function () {
      ativarModoBuscaCliente();
    });
  }

  function montarItensPayload() {
    const lista = obterCarrinhoAtual();
    return lista.map((item) => ({
      produto_id: item.produto_id || item.id,
      quantidade: item.quantidade,
      quantidade_estoque: item.quantidade_estoque,
      preco_unitario: item.preco_unitario,
      desconto_percentual: item.desconto_percentual || 0,
      desconto_valor: item.desconto_valor || 0,
      desconto_manual: Number(item.desconto_manual || 0) === 1 ? 1 : 0,
      subtotal: item.subtotal,
      tipo_venda: item.tipo_venda || item.tipoVenda,
      nome: item.nome
    }));
  }

  /**
   * Módulo OFF: botão e atalho F9 ocultos.
   * Módulo ON: botão visível; habilitado só com itens no carrinho.
   */
  function atualizarBotaoEntrega() {
    const $btn = $('#btnVendaEntregaPdv');
    if (!$btn.length) return;

    const ativo = moduloEntregaAtivo();
    const temItens = obterCarrinhoAtual().length > 0;
    const configurada = estaConfigurada();
    const habilitado = ativo && temItens;

    $btn.toggle(ativo);
    $btn.attr('aria-hidden', ativo ? 'false' : 'true');

    if (!ativo) {
      $btn.prop('disabled', true);
      limparEstadoVisualBotao($btn);
    } else {
      const $titulo = $btn.find('.btn-venda-entrega-titulo');
      const $icone = $btn.find('.btn-venda-entrega-icone');
      if (configurada) {
        $titulo.text(TITULO_OK);
        if ($icone.length) $icone.text(ICONE_OK);
        $btn.addClass('btn-venda-entrega--ok');
        $btn.attr('title', 'Entrega configurada');
      } else {
        $titulo.text(TITULO_PADRAO);
        if ($icone.length) $icone.text(ICONE_PADRAO);
        $btn.removeClass('btn-venda-entrega--ok');
        $btn.attr('title', temItens ? 'Enviar para Entrega (F9)' : 'Adicione itens ao carrinho');
      }
      $btn.prop('disabled', !habilitado);
    }

    const $tipoBox = $('#pdvTipoVendaResumoBox');
    if ($tipoBox.length) {
      $tipoBox.toggle(ativo);
    }
    sincronizarTipoResumo();

    const $chipF9 = $('[data-atalho="entrega"]');
    if ($chipF9.length) {
      $chipF9.toggle(ativo);
    }
  }

  function limparEstadoVisualBotao($btn) {
    $btn.find('.btn-venda-entrega-titulo').text(TITULO_PADRAO);
    const $icone = $btn.find('.btn-venda-entrega-icone');
    if ($icone.length) $icone.text(ICONE_PADRAO);
    $btn.removeClass('btn-venda-entrega--ok');
    $btn.attr('title', '');
  }

  function marcarEntregaConfigurada() {
    global.pdvEntregaConfigurada = true;
    definirTipoVendaUi('ENTREGA');
    atualizarBotaoEntrega();
  }

  /** Limpa estado visual — ao cancelar, limpar carrinho ou iniciar nova venda. */
  function limparEstadoEntregaUi() {
    global.pdvEntregaConfigurada = false;
    definirTipoVendaUi('BALCAO');
    atualizarBotaoEntrega();
  }

  function sincronizarTipoResumo() {
    const $valor = $('#pdvTipoVendaValor');
    if (!$valor.length) return;
    const tipo = String(global.pdvTipoVenda || 'BALCAO').toUpperCase() === 'ENTREGA'
      ? 'Entrega'
      : 'Balcão';
    $valor.text(tipo);
  }

  function definirTipoVendaUi(tipo) {
    global.pdvTipoVenda = String(tipo || 'BALCAO').toUpperCase() === 'ENTREGA' ? 'ENTREGA' : 'BALCAO';
    sincronizarTipoResumo();
  }

  /** @deprecated Compat — F10 não usa escolha. */
  function abrirEscolhaTipoFinalizacao() {
    if (typeof abrirTelaPagamentoBalcao === 'function') {
      return abrirTelaPagamentoBalcao();
    }
    if (typeof abrirTelaPagamento === 'function') {
      return abrirTelaPagamento();
    }
  }

  function aoClicarBotaoEntrega() {
    const $btn = $('#btnVendaEntregaPdv');
    if ($btn.length && $btn.prop('disabled')) return;

    if (!moduloEntregaAtivo()) {
      if (typeof showNotification === 'function') {
        showNotification('Módulo Vendas para Entrega desabilitado.', 'warning');
      }
      return;
    }

    if (obterCarrinhoAtual().length === 0) {
      if (typeof showNotification === 'function') {
        showNotification('Adicione itens ao carrinho antes de criar a entrega.', 'warning');
      }
      return;
    }

    abrirModalVendaEntrega();
  }

  function abrirModalVendaEntrega() {
    if (!moduloEntregaAtivo()) {
      if (typeof showNotification === 'function') {
        showNotification('Módulo Vendas para Entrega desabilitado.', 'warning');
      }
      return;
    }

    if (obterCarrinhoAtual().length === 0) {
      if (typeof showNotification === 'function') {
        showNotification('Adicione itens ao carrinho antes de criar a entrega.', 'warning');
      }
      return;
    }

    global.pdvEntregaConfigurada = false;
    global.pdvTipoVenda = 'ENTREGA';
    sincronizarTipoResumo();
    atualizarBotaoEntrega();
    const total = obterTotalCarrinho();

    $('#modal-container').html(`
      <div class="modal fade" id="modalVendaEntregaPdv" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
          <div class="modal-content border-0 shadow-lg" style="border-radius:20px;">
            <div class="modal-header border-0" style="background:#ea580c;color:#fff;">
              <h5 class="modal-title">🚚 Venda para Entrega</h5>
              <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body p-4">
              <div class="alert alert-info py-2">
                Total dos itens: <strong>R$ ${total.toFixed(2).replace('.', ',')}</strong>
                — estoque será <strong>reservado</strong> (sem baixa definitiva).
              </div>
              <div class="row g-3">
                <input type="hidden" id="entregaClienteId" value="">
                <input type="hidden" id="entregaModoCliente" value="busca">
                <div class="col-12">
                  <label class="form-label">Cliente / Consumidor</label>
                  <div id="boxBuscaClienteEntrega">
                    <div class="input-group">
                      <span class="input-group-text"><i class="fas fa-search"></i></span>
                      <input type="text" class="form-control" id="entregaClienteBusca"
                        placeholder="Digite nome ou telefone..." autocomplete="off">
                    </div>
                    <div id="entregaClienteResultados" class="list-group mt-1 shadow-sm"
                      style="display:none;max-height:180px;overflow:auto;position:relative;z-index:5;"></div>
                    <div id="entregaClienteSelecionado" class="alert alert-success py-2 mt-2 mb-0" style="display:none;">
                      <div class="d-flex justify-content-between align-items-center gap-2">
                        <span><i class="fas fa-user-check me-1"></i> <strong id="entregaClienteSelecionadoNome"></strong></span>
                        <button type="button" class="btn btn-sm btn-outline-secondary" id="btnRemoverClienteEntrega">Trocar</button>
                      </div>
                    </div>
                    <div class="mt-2">
                      <button type="button" class="btn btn-sm btn-outline-primary" id="btnConsumidorAvulsoEntrega">
                        + Consumidor avulso
                      </button>
                    </div>
                  </div>
                  <div id="boxConsumidorAvulsoHint" class="alert alert-secondary py-2 mt-1 mb-0" style="display:none;">
                    Consumidor avulso — dados só desta entrega (não cria cadastro).
                    <button type="button" class="btn btn-sm btn-link p-0 ms-1" id="btnVoltarBuscaClienteEntrega">Buscar cliente</button>
                  </div>
                </div>
                <div class="col-md-6">
                  <label class="form-label">Nome</label>
                  <input type="text" class="form-control" id="entregaNomeCliente" placeholder="Consumidor">
                </div>
                <div class="col-md-6">
                  <label class="form-label">CPF/CNPJ</label>
                  <input type="text" class="form-control" id="entregaCpfCnpj" placeholder="Opcional">
                </div>
                <div class="col-md-4">
                  <label class="form-label">Telefone</label>
                  <input type="text" class="form-control" id="entregaTelefone" placeholder="(00) 00000-0000">
                </div>
                <div class="col-md-8">
                  <label class="form-label">E-mail</label>
                  <input type="email" class="form-control" id="entregaEmail" placeholder="Opcional">
                </div>
                <div class="col-12"><hr class="my-1"><small class="text-muted text-uppercase fw-semibold">Endereço da entrega</small></div>
                <div class="col-md-3">
                  <label class="form-label">CEP</label>
                  <div class="input-group">
                    <input type="text" class="form-control" id="entregaCep" placeholder="00000-000" maxlength="9" autocomplete="postal-code">
                    <button type="button" class="btn btn-outline-secondary" id="btnBuscarCepEntrega" title="Buscar endereço pelo CEP">
                      <i class="fas fa-search"></i>
                    </button>
                  </div>
                  <small id="entregaCepLoading" class="text-muted" style="display:none;">Buscando CEP...</small>
                </div>
                <div class="col-md-5">
                  <label class="form-label">Endereço de entrega</label>
                  <input type="text" class="form-control" id="entregaEndereco" required>
                </div>
                <div class="col-md-2">
                  <label class="form-label">Número</label>
                  <input type="text" class="form-control" id="entregaNumero">
                </div>
                <div class="col-md-2">
                  <label class="form-label">Compl.</label>
                  <input type="text" class="form-control" id="entregaComplemento">
                </div>
                <div class="col-md-3">
                  <label class="form-label">Bairro</label>
                  <input type="text" class="form-control" id="entregaBairro">
                </div>
                <div class="col-md-3">
                  <label class="form-label">Cidade</label>
                  <input type="text" class="form-control" id="entregaCidade">
                </div>
                <div class="col-md-2">
                  <label class="form-label">UF</label>
                  <input type="text" class="form-control" id="entregaUf" maxlength="2" placeholder="UF">
                </div>
                <div class="col-md-4">
                  <label class="form-label">Referência</label>
                  <input type="text" class="form-control" id="entregaReferencia">
                </div>
                <div class="col-md-6">
                  <label class="form-label">Entregador</label>
                  <input type="text" class="form-control" id="entregaEntregador" placeholder="Texto livre">
                </div>
                <div class="col-md-6">
                  <label class="form-label">Pagamento previsto</label>
                  <select class="form-select" id="entregaPagamentoPrevisto">
                    <option value="NAO_INFORMADO">Não informado</option>
                    <option value="PIX">PIX</option>
                    <option value="DINHEIRO">Dinheiro</option>
                    <option value="DEBITO">Débito</option>
                    <option value="CREDITO">Crédito</option>
                    <option value="MISTO">Misto</option>
                    <option value="FIADO">Fiado</option>
                  </select>
                </div>
                <div class="col-md-4">
                  <label class="form-label">Taxa de entrega (R$)</label>
                  <input type="number" min="0" step="0.01" class="form-control" id="entregaTaxa" value="0">
                </div>
                <div class="col-md-4">
                  <label class="form-label d-block">Levar maquineta</label>
                  <div class="form-check form-check-inline">
                    <input class="form-check-input" type="radio" name="entregaMaquineta" id="maqSim" value="1">
                    <label class="form-check-label" for="maqSim">Sim</label>
                  </div>
                  <div class="form-check form-check-inline">
                    <input class="form-check-input" type="radio" name="entregaMaquineta" id="maqNao" value="0" checked>
                    <label class="form-check-label" for="maqNao">Não</label>
                  </div>
                </div>
                <div class="col-md-4">
                  <label class="form-label d-block">Levar troco</label>
                  <div class="form-check form-check-inline">
                    <input class="form-check-input" type="radio" name="entregaTroco" id="trocoSim" value="1">
                    <label class="form-check-label" for="trocoSim">Sim</label>
                  </div>
                  <div class="form-check form-check-inline">
                    <input class="form-check-input" type="radio" name="entregaTroco" id="trocoNao" value="0" checked>
                    <label class="form-check-label" for="trocoNao">Não</label>
                  </div>
                </div>
                <div class="col-md-4" id="boxTrocoPara" style="display:none;">
                  <label class="form-label">Troco para (R$)</label>
                  <input type="number" min="0" step="0.01" class="form-control" id="entregaTrocoPara" value="0">
                </div>
                <div class="col-12">
                  <label class="form-label">Observações</label>
                  <textarea class="form-control" id="entregaObservacoes" rows="2"></textarea>
                </div>
              </div>
            </div>
            <div class="modal-footer border-0">
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancelar</button>
              <button type="button" class="btn btn-primary" id="btnConfirmarEntregaPdv" style="background:#ea580c;border-color:#ea580c;">
                <i class="fas fa-check me-1"></i> Confirmar Entrega
              </button>
            </div>
          </div>
        </div>
      </div>
    `);

    const modalEl = document.getElementById('modalVendaEntregaPdv');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    modalEl.addEventListener('hidden.bs.modal', function onHidden() {
      modalEl.removeEventListener('hidden.bs.modal', onHidden);
      if (!estaConfigurada() && String(global.pdvTipoVenda || '').toUpperCase() === 'ENTREGA') {
        definirTipoVendaUi('BALCAO');
      }
      atualizarBotaoEntrega();
      if (typeof focarCampoCodigo === 'function') {
        focarCampoCodigo({ limpar: true });
      }
    }, { once: true });

    $('input[name="entregaTroco"]').off('change').on('change', function () {
      $('#boxTrocoPara').toggle($(this).val() === '1');
    });

    vincularBuscaCepEntrega();
    vincularBuscaClienteEntrega();
    ativarModoBuscaCliente();

    $('#btnConfirmarEntregaPdv').off('click').on('click', async () => {
      await confirmarVendaEntrega(modal);
    });
  }

  async function confirmarVendaEntrega(modal) {
    const endereco = String($('#entregaEndereco').val() || '').trim();
    if (!endereco) {
      showNotification('Informe o endereço de entrega.', 'warning');
      return;
    }

    const taxa = Number($('#entregaTaxa').val() || 0) || 0;
    const totalItens = obterTotalCarrinho();
    const total = Number((totalItens + taxa).toFixed(2));
    const levaTroco = $('input[name="entregaTroco"]:checked').val() === '1';
    const clienteIdRaw = String($('#entregaClienteId').val() || '').trim();
    const clienteId = clienteIdRaw ? Number(clienteIdRaw) : null;
    const nomeInformado = String($('#entregaNomeCliente').val() || '').trim();

    const payload = montarPayloadComTerminal({
      tipo_venda: 'ENTREGA',
      emitir_fiscal: false,
      cliente_id: Number.isFinite(clienteId) && clienteId > 0 ? clienteId : null,
      nome_cliente_entrega: nomeInformado || null,
      cpf_cnpj_cliente_entrega: String($('#entregaCpfCnpj').val() || '').trim() || null,
      email_cliente_entrega: String($('#entregaEmail').val() || '').trim() || null,
      total,
      desconto: Number($('#descontoPdv').val() || 0) || 0,
      itens: montarItensPayload(),
      pagamento_previsto: $('#entregaPagamentoPrevisto').val() || 'NAO_INFORMADO',
      entregador: $('#entregaEntregador').val() || '',
      endereco_entrega: endereco,
      numero_entrega: $('#entregaNumero').val() || '',
      complemento_entrega: $('#entregaComplemento').val() || '',
      bairro_entrega: $('#entregaBairro').val() || '',
      cidade_entrega: $('#entregaCidade').val() || '',
      uf_entrega: String($('#entregaUf').val() || '').trim().toUpperCase(),
      cep_entrega: String($('#entregaCep').val() || '').replace(/\D/g, ''),
      referencia_entrega: $('#entregaReferencia').val() || '',
      observacao_entrega: $('#entregaObservacoes').val() || '',
      telefone_entrega: $('#entregaTelefone').val() || '',
      taxa_entrega: taxa,
      leva_maquineta: $('input[name="entregaMaquineta"]:checked').val() === '1',
      leva_troco: levaTroco,
      troco_para: levaTroco ? Number($('#entregaTrocoPara').val() || 0) || 0 : 0,
      forma_pagamento: String($('#entregaPagamentoPrevisto').val() || 'nao_informado').toLowerCase(),
      pagamentos: []
    });

    try {
      validarTerminalMultiCaixa(payload);
    } catch (err) {
      showNotification(err.message, 'warning');
      return;
    }

    const $btn = $('#btnConfirmarEntregaPdv').prop('disabled', true);
    try {
      const resp = await fetch(`${API_URL}/vendas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.error || 'Falha ao criar venda para entrega.');
      }

      modal.hide();
      showNotification(data.message || 'Venda para entrega criada.', 'success');

      if (data.comprovante_html) {
        const cfg = window.configuracaoAvancadaServidor || {};
        if (cfg.imprimir_comprovante_entrega !== false) {
          imprimirComprovanteEntrega(data.comprovante_html);
        }
      }

      marcarEntregaConfigurada();

      if (typeof finalizarPosVenda === 'function') {
        finalizarPosVenda();
      } else if (typeof limparCarrinho === 'function') {
        limparCarrinho();
      }

      // Mantém rótulo "✅ ENTREGA CONFIGURADA" (botão desabilitado sem itens)
      global.pdvEntregaConfigurada = true;
      atualizarBotaoEntrega();

      if (window.PdvPrestacaoEntrega && typeof PdvPrestacaoEntrega.atualizarWidgetContadores === 'function') {
        PdvPrestacaoEntrega.atualizarWidgetContadores();
      }
      if (typeof focarCampoCodigo === 'function') {
        focarCampoCodigo({ limpar: true });
      }
    } catch (err) {
      showNotification(err.message || 'Erro ao confirmar entrega.', 'danger');
    } finally {
      $btn.prop('disabled', false);
    }
  }

  function imprimirComprovanteEntrega(html) {
    try {
      if (window.electronAPI && typeof window.electronAPI.abrirComprovante === 'function') {
        window.electronAPI.abrirComprovante(html, { silent: false, autoFecharMs: 5000 });
        return;
      }
    } catch (_) { /* fallback */ }

    const w = window.open('', '_blank', 'width=320,height=600');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => {
      try { w.print(); } catch (_) { /* ignore */ }
    }, 300);
  }

  function initUi() {
    atualizarBotaoEntrega();
  }

  global.pdvTipoVenda = global.pdvTipoVenda || 'BALCAO';
  global.pdvEntregaConfigurada = global.pdvEntregaConfigurada === true;

  global.PdvVendaEntrega = {
    moduloEntregaAtivo,
    abrirEscolhaTipoFinalizacao,
    abrirModalVendaEntrega,
    aoClicarBotaoEntrega,
    atualizarBotaoEntrega,
    sincronizarTipoResumo,
    definirTipoVendaUi,
    marcarEntregaConfigurada,
    limparEstadoEntregaUi,
    estaConfigurada,
    initUi
  };
})(typeof window !== 'undefined' ? window : globalThis);
