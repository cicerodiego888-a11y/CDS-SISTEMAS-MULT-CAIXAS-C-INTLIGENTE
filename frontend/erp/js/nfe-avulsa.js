/**
 * RC3.16 / V2 UX — Nova NF-e Avulsa (porta fiscal).
 * Cria Venda origem=NF_AVULSA via núcleo + emitirNfePorVendaId (mesmo motor).
 * Sprint UX: apenas apresentação — sem alterar regras fiscais / TEF / pagamento.
 */

(function () {
  'use strict';

  let itensAvulsa = [];
  let timerCliente = null;
  let timerProduto = null;
  let emitindo = false;
  let consultaCnpjPendente = null;
  let consultandoCnpj = false;

  function headersJson() {
    const h = { 'Content-Type': 'application/json' };
    try {
      const t = localStorage.getItem('token') || sessionStorage.getItem('token');
      if (t) h.Authorization = `Bearer ${t}`;
    } catch (_) { /* ignore */ }
    return h;
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtMoney(v) {
    return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function apenasDigitos(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function formatarDocInput(el) {
    const d = apenasDigitos(el.value).slice(0, 14);
    if (typeof formatCpfCnpjInput === 'function') {
      formatCpfCnpjInput(el);
      return;
    }
    if (typeof formatarCpfCnpj === 'function') {
      el.value = formatarCpfCnpj(d) || d;
      return;
    }
    el.value = d;
  }

  function modoFiscalAtivo() {
    if (typeof modoFiscalAtivoSistema === 'function') return !!modoFiscalAtivoSistema();
    return localStorage.getItem('pdv_modo_fiscal_ativo') === '1';
  }

  function alertar(msg, tipo) {
    if (typeof showNotification === 'function') showNotification(msg, tipo || 'info');
    else window.alert(String(msg).replace(/<[^>]+>/g, ''));
  }

  function setValSeTem(sel, valor) {
    if (valor == null || String(valor).trim() === '') return;
    $(sel).val(valor);
  }

  function calcularTotais() {
    const sub = itensAvulsa.reduce((s, i) => s + Number(i.subtotal || 0), 0);
    const frete = Number($('#nfaFrete').val() || 0);
    const desconto = Number($('#nfaDesconto').val() || 0);
    const total = Math.max(0, Number((sub + frete - desconto).toFixed(2)));
    $('#nfaTotSub').text(fmtMoney(sub));
    $('#nfaTotFrete').text(fmtMoney(frete));
    $('#nfaTotDesc').text(fmtMoney(desconto));
    $('#nfaTotGeral').text(fmtMoney(total));
    return { sub, frete, desconto, total };
  }

  function atualizarHintPagamento() {
    const forma = String($('#nfaForma').val() || '').toLowerCase();
    const hint = $('#nfaPixHint');
    if (!hint.length) return;
    if (forma === 'pix') {
      hint.removeClass('d-none').html(
        '<i class="fas fa-qrcode me-1"></i> <strong>PIX por chave (sem TEF)</strong>. ' +
        'Pagamento manual via chave PIX da empresa. <strong>Não utiliza TEF/maquineta.</strong>'
      );
    } else if (forma === 'pix_tef') {
      hint.removeClass('d-none').html(
        '<i class="fas fa-credit-card me-1"></i> <strong>PIX integrado (TEF)</strong>. ' +
        'Segue o fluxo TEF configurado no CDS.'
      );
    } else {
      hint.addClass('d-none').empty();
    }
  }

  function renderItens() {
    if (!itensAvulsa.length) {
      $('#nfaItensBody').html(
        '<tr><td colspan="11" class="text-muted text-center py-3">Nenhum produto adicionado.</td></tr>'
      );
      calcularTotais();
      return;
    }
    $('#nfaItensBody').html(itensAvulsa.map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(it.produto_codigo || it.produto_id)}</td>
        <td>${escapeHtml(it.produto_nome || '')}</td>
        <td>${escapeHtml(it.ncm || '—')}</td>
        <td>${escapeHtml(it.cfop || $('#nfaCfop').val() || '—')}</td>
        <td>${escapeHtml(it.unidade || 'UN')}</td>
        <td class="text-end">${Number(it.quantidade)}</td>
        <td class="text-end">${fmtMoney(it.preco_unitario)}</td>
        <td class="text-end">${Number(it.desconto_percentual || 0)}%</td>
        <td class="text-end">${fmtMoney(it.subtotal)}</td>
        <td class="text-end">
          <button type="button" class="btn btn-sm btn-outline-danger nfa-rm-item" data-idx="${idx}" title="Remover">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>`).join(''));
    $('.nfa-rm-item').off('click').on('click', function () {
      itensAvulsa.splice(Number($(this).data('idx')), 1);
      renderItens();
    });
    calcularTotais();
  }

  function aplicarCliente(id, nome) {
    $('#nfaClienteId').val(id || '');
    $('#nfaClienteBusca').val(nome || '');
    $('#nfaClienteLabel').text(id ? `Cliente #${id} — ${nome}` : 'Nenhum cliente selecionado');
    $('#nfaClienteSugestoes').hide().empty();
    if (id) {
      $('#nfaCdsClienteStatus').removeClass('d-none').html(
        `<div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
          <span><i class="fas fa-check-circle me-1"></i> Cliente já cadastrado no CDS.
            <strong>Cliente #${escapeHtml(id)} — ${escapeHtml(nome)}</strong></span>
          <button type="button" class="btn btn-sm btn-primary" id="btnNfaVerCadastro">
            <i class="fas fa-external-link-alt"></i> Ver no cadastro
          </button>
        </div>`
      );
      $('#btnNfaVerCadastro').off('click').on('click', () => {
        if (typeof loadPage === 'function') loadPage('clientes');
      });
    }
  }

  async function carregarClienteCompleto(id) {
    try {
      const resp = await fetch(`${API_URL}/clientes/${id}`, { headers: headersJson() });
      if (!resp.ok) return;
      const c = await resp.json().catch(() => null);
      if (!c) return;
      setValSeTem('#nfaDestDoc', typeof formatarCpfCnpj === 'function' ? formatarCpfCnpj(c.cpf_cnpj) : c.cpf_cnpj);
      setValSeTem('#nfaDestRazao', c.razao_social || c.nome);
      setValSeTem('#nfaDestFantasia', c.nome);
      setValSeTem('#nfaDestIe', c.inscricao_estadual);
      setValSeTem('#nfaDestTel', c.telefone);
      setValSeTem('#nfaDestEmail', c.email);
      setValSeTem('#nfaDestCep', c.cep);
      setValSeTem('#nfaDestRua', c.rua);
      setValSeTem('#nfaDestNumero', c.numero);
      setValSeTem('#nfaDestBairro', c.bairro);
      setValSeTem('#nfaDestUf', c.uf);
      setValSeTem('#nfaDestMunicipio', c.cidade);
      setValSeTem('#nfaDestPais', 'BRASIL');
      aplicarCliente(c.id, c.nome || c.razao_social || '');
    } catch (_) { /* ignore */ }
  }

  function buscarClientes(termo) {
    clearTimeout(timerCliente);
    if (!termo || termo.length < 2) {
      $('#nfaClienteSugestoes').hide().empty();
      return;
    }
    timerCliente = setTimeout(async () => {
      try {
        const resp = await fetch(`${API_URL}/clientes/buscar?termo=${encodeURIComponent(termo)}`, { headers: headersJson() });
        const rows = await resp.json().catch(() => []);
        if (!Array.isArray(rows) || !rows.length) {
          $('#nfaClienteSugestoes').html('<div class="list-group-item text-muted">Nenhum cliente</div>').show();
          return;
        }
        $('#nfaClienteSugestoes').html(rows.slice(0, 15).map((c) => `
          <button type="button" class="list-group-item list-group-item-action nfa-pick-cliente"
            data-id="${c.id}" data-nome="${escapeHtml(c.nome)}">
            <strong>${escapeHtml(c.nome)}</strong>
            <small class="d-block text-muted">${escapeHtml(c.cpf_cnpj || '')}</small>
          </button>`).join('')).show();
        $('.nfa-pick-cliente').off('click').on('click', function () {
          const id = Number($(this).data('id'));
          const nome = $(this).data('nome');
          aplicarCliente(id, nome);
          carregarClienteCompleto(id);
        });
      } catch (_) {
        $('#nfaClienteSugestoes').hide();
      }
    }, 250);
  }

  async function carregarClientesRecentes() {
    const box = $('#nfaClientesRecentes');
    box.html('<div class="text-muted small">Carregando…</div>');
    try {
      const resp = await fetch(`${API_URL}/clientes`, { headers: headersJson() });
      const rows = await resp.json().catch(() => []);
      const lista = Array.isArray(rows)
        ? rows.slice().sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 8)
        : [];
      if (!lista.length) {
        box.html('<div class="text-muted small">Nenhum cliente recente.</div>');
        return;
      }
      box.html(`<div class="list-group">${lista.map((c) => `
        <button type="button" class="list-group-item list-group-item-action nfa-pick-recente"
          data-id="${c.id}" data-nome="${escapeHtml(c.nome || '')}">
          <strong>${escapeHtml(c.nome || '—')}</strong>
          <small class="d-block text-muted">${escapeHtml(c.cpf_cnpj || '')}</small>
        </button>`).join('')}</div>`);
      $('.nfa-pick-recente').off('click').on('click', function () {
        const id = Number($(this).data('id'));
        aplicarCliente(id, $(this).data('nome'));
        carregarClienteCompleto(id);
        ativarAbaDest('cadastrado');
      });
    } catch (_) {
      box.html('<div class="text-danger small">Falha ao carregar recentes.</div>');
    }
  }

  function ativarAbaDest(aba) {
    $('.nfa-tab').removeClass('is-active');
    $(`.nfa-tab[data-aba="${aba}"]`).addClass('is-active');
    $('.nfa-aba-painel').addClass('d-none');
    $(`#nfaAba${aba.charAt(0).toUpperCase()}${aba.slice(1)}`).removeClass('d-none');
    if (aba === 'recente') carregarClientesRecentes();
  }

  async function localizarClientePorDocumento(digitos) {
    if (!digitos) return null;
    try {
      const resp = await fetch(`${API_URL}/clientes`, { headers: headersJson() });
      const rows = await resp.json().catch(() => []);
      if (!Array.isArray(rows)) return null;
      return rows.find((c) => apenasDigitos(c.cpf_cnpj) === digitos) || null;
    } catch (_) {
      return null;
    }
  }

  function preencherPreviewConsulta(dto) {
    const d = dto || {};
    $('#nfaConsultaStatus').removeClass('d-none').addClass('nfa-callout--ok').html(
      '<i class="fas fa-check-circle me-1"></i> Empresa encontrada na Receita Federal. Dados carregados com sucesso.'
    );
    $('#nfaConsultaPreview').removeClass('d-none');
    $('#nfaPreviewRazao').text(d.razaoSocial || '—');
    $('#nfaPreviewFantasia').text(d.nomeFantasia || '—');
    $('#nfaPreviewDoc').text(
      typeof formatarCpfCnpj === 'function' ? (formatarCpfCnpj(d.cnpj) || d.cnpj || '—') : (d.cnpj || '—')
    );
  }

  function aplicarDadosConsultaNosCampos(dto, { forcar = false } = {}) {
    const d = dto || {};
    const set = (sel, val) => {
      if (val == null || String(val).trim() === '') return;
      if (!forcar && String($(sel).val() || '').trim()) return;
      $(sel).val(val);
    };
    if (d.cnpj) {
      $('#nfaDestDoc').val(typeof formatarCpfCnpj === 'function' ? formatarCpfCnpj(d.cnpj) : d.cnpj);
    }
    set('#nfaDestRazao', d.razaoSocial);
    set('#nfaDestFantasia', d.nomeFantasia || d.razaoSocial);
    if (d.inscricaoEstadual) set('#nfaDestIe', d.inscricaoEstadual);
    if (d.inscricaoMunicipal) set('#nfaDestIm', d.inscricaoMunicipal);
    if (d.cnae) set('#nfaDestCnae', d.cnae);
    if (d.telefone) set('#nfaDestTel', d.telefone);
    if (d.email) set('#nfaDestEmail', d.email);
    if (d.cep) set('#nfaDestCep', d.cep);
    if (d.logradouro) set('#nfaDestRua', d.logradouro);
    if (d.numero) set('#nfaDestNumero', d.numero);
    if (d.complemento) set('#nfaDestCompl', d.complemento);
    if (d.bairro) set('#nfaDestBairro', d.bairro);
    if (d.uf) set('#nfaDestUf', String(d.uf).toUpperCase());
    if (d.municipio) set('#nfaDestMunicipio', d.municipio);
    set('#nfaDestPais', 'BRASIL');
  }

  async function consultarCnpjDestinatario() {
    if (consultandoCnpj) return;
    const digitos = apenasDigitos($('#nfaDestDoc').val());
    if (digitos.length === 11) {
      alertar('CPF informado. Selecione o cliente na aba "Cliente cadastrado" ou preencha os dados manualmente.', 'info');
      return;
    }
    if (digitos.length !== 14) {
      alertar('Informe um CNPJ com 14 dígitos para consultar.', 'warning');
      $('#nfaDestDoc').focus();
      return;
    }

    consultandoCnpj = true;
    $('#btnNfaConsultarCnpj').prop('disabled', true);
    $('#nfaConsultaStatus').removeClass('d-none nfa-callout--ok').addClass('nfa-callout--info')
      .html('<i class="fas fa-spinner fa-spin me-1"></i> Consultando CNPJ…');
    $('#nfaConsultaPreview').addClass('d-none');
    $('#nfaCdsClienteStatus').addClass('d-none').empty();
    consultaCnpjPendente = null;

    try {
      const response = await fetch(`/api/consulta-cnpj/${encodeURIComponent(digitos)}`, {
        headers: headersJson()
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        let msg = payload.error || 'Não foi possível consultar o CNPJ agora.';
        if (payload.code === 'NAO_ENCONTRADO' || response.status === 404) {
          msg = 'Empresa não encontrada para este CNPJ.';
        } else if (payload.code === 'CNPJ_INVALIDO' || response.status === 400) {
          msg = 'CNPJ inválido.';
        }
        $('#nfaConsultaStatus').removeClass('nfa-callout--info').html(
          `<i class="fas fa-exclamation-circle me-1"></i> ${escapeHtml(msg)}`
        );
        alertar(msg, 'warning');
        return;
      }

      const dto = payload.data || {};
      consultaCnpjPendente = dto;
      preencherPreviewConsulta(dto);
      aplicarDadosConsultaNosCampos(dto, { forcar: false });

      const existente = await localizarClientePorDocumento(apenasDigitos(dto.cnpj || digitos));
      if (existente) {
        $('#nfaCdsClienteStatus').removeClass('d-none').html(
          `<div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
            <span><i class="fas fa-check-circle me-1"></i> Cliente já cadastrado no CDS.
              <strong>Cliente #${existente.id} — ${escapeHtml(existente.nome || '')}</strong></span>
            <button type="button" class="btn btn-sm btn-outline-primary" id="btnNfaVerCadastro2">
              <i class="fas fa-external-link-alt"></i> Ver no cadastro
            </button>
          </div>`
        );
        $('#btnNfaVerCadastro2').off('click').on('click', () => {
          if (typeof loadPage === 'function') loadPage('clientes');
        });
        consultaCnpjPendente._clienteExistente = existente;
      }
    } catch (err) {
      console.error('Consulta CNPJ NF-e avulsa:', err);
      $('#nfaConsultaStatus').removeClass('nfa-callout--info').html(
        '<i class="fas fa-exclamation-circle me-1"></i> Falha na consulta. Verifique a conexão.'
      );
      alertar('Não foi possível consultar o CNPJ agora.', 'danger');
    } finally {
      consultandoCnpj = false;
      $('#btnNfaConsultarCnpj').prop('disabled', false);
    }
  }

  async function usarDestinatarioConsultado() {
    if (!consultaCnpjPendente) {
      alertar('Consulte um CNPJ antes de usar o destinatário.', 'warning');
      return;
    }
    const dto = consultaCnpjPendente;
    aplicarDadosConsultaNosCampos(dto, { forcar: true });

    const existente = dto._clienteExistente
      || await localizarClientePorDocumento(apenasDigitos(dto.cnpj));
    if (existente) {
      aplicarCliente(existente.id, existente.nome || dto.nomeFantasia || dto.razaoSocial || '');
      alertar('Destinatário confirmado (cliente já cadastrado no CDS).', 'success');
    } else {
      $('#nfaClienteId').val('');
      $('#nfaClienteLabel').text('Destinatário consultado — ainda não cadastrado no CDS');
      $('#nfaCdsClienteStatus').removeClass('d-none').html(
        '<i class="fas fa-info-circle me-1"></i> Dados preenchidos. Cadastre o cliente no CDS antes de emitir, ' +
        'ou selecione um cliente já cadastrado. A consulta <strong>não</strong> salvou automaticamente.'
      );
      alertar('Destinatário preenchido. Cadastre o cliente no CDS se ainda não existir.', 'info');
    }
  }

  function limparDestinatario() {
    consultaCnpjPendente = null;
    $('#nfaClienteId').val('');
    $('#nfaClienteBusca').val('');
    $('#nfaClienteLabel').text('Nenhum cliente selecionado');
    $('#nfaDestDoc, #nfaDestRazao, #nfaDestFantasia, #nfaDestIe, #nfaDestIm, #nfaDestCnae, #nfaDestTel, #nfaDestEmail').val('');
    $('#nfaDestCep, #nfaDestRua, #nfaDestNumero, #nfaDestCompl, #nfaDestBairro, #nfaDestUf, #nfaDestMunicipio').val('');
    $('#nfaDestPais').val('BRASIL');
    $('#nfaConsultaStatus, #nfaConsultaPreview, #nfaCdsClienteStatus').addClass('d-none').empty();
    $('#nfaClienteSugestoes').hide().empty();
  }

  function buscarProdutos(termo) {
    clearTimeout(timerProduto);
    if (!termo || !String(termo).length) {
      $('#nfaProdutoSugestoes').hide().empty();
      return;
    }
    timerProduto = setTimeout(async () => {
      try {
        const resp = await fetch(
          `${API_URL}/produtos/consulta-pdv/buscar?q=${encodeURIComponent(termo)}&limite=15`,
          { headers: headersJson() }
        );
        const rows = await resp.json().catch(() => []);
        if (!Array.isArray(rows) || !rows.length) {
          $('#nfaProdutoSugestoes').html('<div class="list-group-item text-muted">Nenhum produto</div>').show();
          return;
        }
        $('#nfaProdutoSugestoes').html(rows.map((p) => {
          const preco = Number(p.preco_promocional != null ? p.preco_promocional : p.preco_venda || 0);
          return `
            <button type="button" class="list-group-item list-group-item-action nfa-pick-produto"
              data-id="${p.id}" data-nome="${escapeHtml(p.nome)}" data-codigo="${escapeHtml(p.codigo || '')}"
              data-preco="${preco}" data-ncm="${escapeHtml(p.ncm || '')}" data-cfop="${escapeHtml(p.cfop || '')}"
              data-unidade="${escapeHtml(p.unidade || 'UN')}">
              <strong>${escapeHtml(p.codigo || p.id)}</strong> — ${escapeHtml(p.nome)}
              <span class="float-end">${fmtMoney(preco)}</span>
            </button>`;
        }).join('')).show();
        $('.nfa-pick-produto').off('click').on('click', function () {
          $('#nfaProdutoId').val($(this).data('id'));
          $('#nfaProdutoNome').val($(this).data('nome'));
          $('#nfaProdutoCodigo').val($(this).data('codigo'));
          $('#nfaProdutoNcm').val($(this).data('ncm') || '');
          $('#nfaProdutoCfop').val($(this).data('cfop') || '');
          $('#nfaProdutoUnidade').val($(this).data('unidade') || 'UN');
          $('#nfaProdutoBusca').val(`${$(this).data('codigo') || ''} — ${$(this).data('nome')}`);
          $('#nfaItemPreco').val($(this).data('preco'));
          $('#nfaProdutoSugestoes').hide().empty();
          $('#nfaItemQtd').trigger('focus');
        });
      } catch (_) {
        $('#nfaProdutoSugestoes').hide();
      }
    }, 250);
  }

  function adicionarItem() {
    const produtoId = Number($('#nfaProdutoId').val());
    const qtd = Number($('#nfaItemQtd').val());
    const preco = Number($('#nfaItemPreco').val());
    const desc = Number($('#nfaItemDesc').val() || 0);
    if (!(produtoId > 0) || !(qtd > 0) || !(preco >= 0)) {
      alertar('Selecione um produto e informe quantidade/preço.', 'warning');
      return;
    }
    const subtotal = Number((qtd * preco * (1 - desc / 100)).toFixed(2));
    const row = {
      produto_id: produtoId,
      produto_nome: $('#nfaProdutoNome').val(),
      produto_codigo: $('#nfaProdutoCodigo').val(),
      ncm: $('#nfaProdutoNcm').val() || '',
      cfop: $('#nfaProdutoCfop').val() || $('#nfaCfop').val() || '',
      unidade: $('#nfaProdutoUnidade').val() || 'UN',
      quantidade: qtd,
      preco_unitario: preco,
      desconto_percentual: desc,
      subtotal,
      tipo_venda: 'PESO'
    };
    const ix = itensAvulsa.findIndex((i) => i.produto_id === produtoId);
    if (ix >= 0) itensAvulsa[ix] = row;
    else itensAvulsa.push(row);
    $('#nfaProdutoId, #nfaProdutoNome, #nfaProdutoCodigo, #nfaProdutoNcm, #nfaProdutoCfop, #nfaProdutoUnidade, #nfaProdutoBusca, #nfaItemPreco').val('');
    $('#nfaItemQtd').val('1');
    $('#nfaItemDesc').val('0');
    renderItens();
    $('#nfaProdutoBusca').trigger('focus');
  }

  function atualizarBannerF12() {
    const on = modoFiscalAtivo();
    const el = $('#nfaBannerF12');
    if (on) {
      el.removeClass('alert-warning').addClass('alert-success')
        .html('<i class="fas fa-check-circle"></i> Modo operacional fiscal ativo (F12). A emissão seguirá para a SEFAZ.');
      $('#btnNfaEmitir').prop('disabled', false);
    } else {
      el.removeClass('alert-success').addClass('alert-warning')
        .html('<i class="fas fa-exclamation-triangle"></i> O modo operacional atual não permite emissão de documentos fiscais.');
      $('#btnNfaEmitir').prop('disabled', true);
    }
  }

  function irCentralAposAutorizacao(nfe) {
    if (typeof apresentarDocumentoNfePosEmissao === 'function') {
      apresentarDocumentoNfePosEmissao(nfe);
      return;
    }
    const notaId = Number(nfe?.notaId || nfe?.nota_id || 0) || null;
    const status = String(nfe?.status || '').toLowerCase();
    const autorizada = Boolean(nfe?.success || status === 'autorizada');
    const banner = autorizada
      ? {
        notaId,
        numero: nfe?.numero,
        serie: nfe?.serie,
        protocolo: nfe?.protocolo,
        chaveAcesso: nfe?.chaveAcesso || nfe?.chave
      }
      : null;
    if (typeof abrirCentralNfeDocumental === 'function') {
      abrirCentralNfeDocumental({
        notaId,
        openFicha: true,
        banner,
        posEmissao: true,
        pendente: !autorizada
      });
    } else if (typeof loadPage === 'function') {
      window.__CDS_NFE_FOCUS_NOTA_ID = notaId;
      window.__CDS_NFE_OPEN_FICHA = true;
      window.__CDS_NFE_POS_EMISSAO = true;
      window.__CDS_NFE_PENDENTE = !autorizada;
      if (banner) window.__CDS_NFE_AUTH_BANNER = banner;
      loadPage('nfe-central');
    }
  }

  async function emitir() {
    if (emitindo) return;
    if (!modoFiscalAtivo()) {
      alertar('O modo operacional atual não permite emissão de documentos fiscais.', 'warning');
      return;
    }
    if (!itensAvulsa.length) {
      alertar('Adicione ao menos um produto.', 'warning');
      return;
    }
    const totais = calcularTotais();
    if (!(totais.total > 0)) {
      alertar('Total da NF-e deve ser maior que zero.', 'warning');
      return;
    }

    const pag = (typeof CdsFormasPagamento !== 'undefined')
      ? CdsFormasPagamento.montarPayloadPagamento('nfa', totais.total)
      : {
        forma_pagamento: $('#nfaForma').val() || 'dinheiro',
        pagamentos: [{ forma_pagamento: $('#nfaForma').val() || 'dinheiro', valor: totais.total }],
        valor_recebido: totais.total,
        parcelas: 1
      };

    if (typeof CdsFormasPagamento !== 'undefined'
      && CdsFormasPagamento.ehParcelavel(pag.forma_pagamento)
      && !$('#nfaClienteId').val()) {
      alertar('Selecione um cliente para Boleto, Crediário ou Parcelado.', 'warning');
      return;
    }

    const payload = {
      cliente_id: $('#nfaClienteId').val() ? Number($('#nfaClienteId').val()) : null,
      itens: itensAvulsa.map((i) => ({
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        preco_unitario: i.preco_unitario,
        desconto_percentual: i.desconto_percentual,
        subtotal: i.subtotal,
        tipo_venda: i.tipo_venda
      })),
      desconto: totais.desconto,
      frete: totais.frete,
      ...pag,
      natureza_operacao: $('#nfaNatureza').val() || 'VENDA DE MERCADORIA',
      cfop: $('#nfaCfop').val() || '5102',
      transportadora: $('#nfaTransportadora').val() || null,
      observacoes: $('#nfaObservacoes').val() || null,
      mod_frete: $('#nfaModFrete').val()
    };

    emitindo = true;
    $('#btnNfaEmitir').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Emitindo…');
    try {
      const resp = await fetch(`${API_URL}/nfe/avulsa`, {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify(payload)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data.mensagem || data.error || 'Falha ao emitir NF-e avulsa.');
      }
      const nfe = data.nfe || {};
      const ok = Boolean(nfe.success || String(nfe.status || '').toLowerCase() === 'autorizada');
      if (ok) {
        alertar(data.message || 'NF-e autorizada.', 'success');
        irCentralAposAutorizacao(nfe);
      } else {
        alertar(data.message || nfe.message || 'Venda gerada; NF-e pendente/rejeitada.', 'warning');
        if (nfe.notaId || nfe.nota_id) irCentralAposAutorizacao(nfe);
      }
    } catch (err) {
      alertar(err.message || 'Erro ao emitir.', 'danger');
    } finally {
      emitindo = false;
      atualizarBannerF12();
      $('#btnNfaEmitir').html('<i class="fas fa-file-invoice"></i> Emitir NF-e');
    }
  }

  function loadNfeAvulsa() {
    itensAvulsa = [];
    consultaCnpjPendente = null;
    const htmlChooser = `
      ${(typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
        ? CdsPageShell.renderHeader({
          page: 'nfe-avulsa',
          titulo: 'Nova NF-e',
          subtitulo: 'Escolha o tipo de documento a emitir.',
          breadcrumbVisible: true,
          breadcrumb: [
            { label: 'Fiscal', page: 'nfe-central' },
            { label: 'Nova NF-e' }
          ]
        })
        : ''}
      <div class="row g-3">
        <div class="col-md-6">
          <div class="card shadow-sm h-100">
            <div class="card-body">
              <h5 class="card-title">NF-e Normal</h5>
              <p class="text-muted">Emissão avulsa de venda (origem NF_AVULSA).</p>
              <button type="button" class="btn btn-primary" id="btnNfaTipoNormal">
                Continuar com NF-e Normal
              </button>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="card shadow-sm h-100">
            <div class="card-body">
              <h5 class="card-title">Devolução de Compra</h5>
              <p class="text-muted">Devolver mercadoria ao fornecedor, referenciando a NF-e original.</p>
              <button type="button" class="btn btn-danger" id="btnNfaTipoDevolucao">
                Devolução de Compra
              </button>
            </div>
          </div>
        </div>
      </div>`;
    $('#page-content').html(htmlChooser);
    $('#btnNfaTipoNormal').on('click', renderFormAvulsa);
    $('#btnNfaTipoDevolucao').on('click', function () {
      if (typeof loadPage === 'function') loadPage('nfe-devolucao-compra');
    });
  }

  function renderFormAvulsa() {
    const header = (typeof CdsPageShell !== 'undefined' && CdsPageShell.renderHeader)
      ? CdsPageShell.renderHeader({
        page: 'nfe-avulsa',
        titulo: 'Nova NF-e',
        subtitulo: 'Emissão de Nota Fiscal Eletrônica de forma avulsa.',
        toolbarHtml: `
          <span class="badge bg-primary nfa-badge-origem me-2">Origem: NF_AVULSA</span>
          <button type="button" class="btn btn-sm btn-outline-secondary" onclick="loadPage('nfe-central')">
            Central NF-e
          </button>`
      })
      : `<div class="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h2 class="h4 mb-0">Nova NF-e <span class="badge bg-primary">Origem: NF_AVULSA</span></h2>
            <div class="text-muted small">Emissão de Nota Fiscal Eletrônica de forma avulsa.</div>
          </div>
          <button type="button" class="btn btn-sm btn-outline-secondary" onclick="loadPage('nfe-central')">Central NF-e</button>
        </div>`;

    const html = `
      <div class="nfa-v2">
        ${header}
        <div class="alert mb-3" id="nfaBannerF12"></div>
        <div class="row g-3">
          <div class="col-lg-8">
            <section class="nfa-section">
              <h3 class="nfa-section__title"><span class="nfa-section__num">1</span> Destinatário (Cliente)</h3>
              <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
                <div class="nfa-tabs mb-0">
                  <button type="button" class="nfa-tab is-active" data-aba="cnpj">Buscar por CNPJ/CPF</button>
                  <button type="button" class="nfa-tab" data-aba="cadastrado">Cliente cadastrado</button>
                  <button type="button" class="nfa-tab" data-aba="recente">Cliente recente</button>
                </div>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="btnNfaLimparDest">Limpar dados</button>
              </div>

              <div id="nfaAbaCnpj" class="nfa-aba-painel">
                <label class="form-label">CNPJ / CPF *</label>
                <div class="input-group">
                  <input type="text" class="form-control" id="nfaDestDoc" maxlength="18" placeholder="00.000.000/0000-00" autocomplete="off">
                  <button type="button" class="btn btn-primary" id="btnNfaConsultarCnpj">
                    <i class="fas fa-search"></i> Consultar
                  </button>
                </div>
                <div id="nfaConsultaStatus" class="nfa-callout d-none"></div>
                <div id="nfaConsultaPreview" class="nfa-callout nfa-callout--ok d-none mt-2">
                  <div class="small mb-2">
                    <div><strong>Razão Social:</strong> <span id="nfaPreviewRazao">—</span></div>
                    <div><strong>Nome Fantasia:</strong> <span id="nfaPreviewFantasia">—</span></div>
                    <div><strong>CNPJ:</strong> <span id="nfaPreviewDoc">—</span></div>
                  </div>
                  <button type="button" class="btn btn-sm btn-primary" id="btnNfaUsarDest">
                    <i class="fas fa-user-check"></i> Usar este destinatário
                  </button>
                </div>
                <div id="nfaCdsClienteStatus" class="nfa-callout nfa-callout--ok d-none"></div>
              </div>

              <div id="nfaAbaCadastrado" class="nfa-aba-painel d-none">
                <label class="form-label">Buscar cliente cadastrado</label>
                <div class="position-relative">
                  <input type="text" class="form-control" id="nfaClienteBusca" placeholder="Nome, CPF/CNPJ ou telefone" autocomplete="off">
                  <input type="hidden" id="nfaClienteId">
                  <div id="nfaClienteSugestoes" class="list-group position-absolute w-100 shadow nfa-sugestoes" style="display:none;"></div>
                </div>
                <div class="form-text" id="nfaClienteLabel">Nenhum cliente selecionado</div>
              </div>

              <div id="nfaAbaRecente" class="nfa-aba-painel d-none">
                <div id="nfaClientesRecentes" class="mt-1"></div>
              </div>

              <div class="row g-2 nfa-dest-grid mt-3">
                <div class="col-md-6">
                  <label class="form-label">Razão Social *</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestRazao">
                </div>
                <div class="col-md-6">
                  <label class="form-label">Nome Fantasia</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestFantasia">
                </div>
                <div class="col-md-3">
                  <label class="form-label">Inscrição Estadual</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestIe">
                </div>
                <div class="col-md-2">
                  <label class="form-label">Inscrição Municipal</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestIm" placeholder="—">
                </div>
                <div class="col-md-2">
                  <label class="form-label">CNAE</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestCnae" placeholder="—">
                </div>
                <div class="col-md-2">
                  <label class="form-label">Telefone</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestTel">
                </div>
                <div class="col-md-3">
                  <label class="form-label">E-mail</label>
                  <input type="email" class="form-control form-control-sm" id="nfaDestEmail">
                </div>
                <div class="col-md-2">
                  <label class="form-label">CEP</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestCep">
                </div>
                <div class="col-md-5">
                  <label class="form-label">Endereço</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestRua">
                </div>
                <div class="col-md-2">
                  <label class="form-label">Número</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestNumero">
                </div>
                <div class="col-md-3">
                  <label class="form-label">Complemento</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestCompl">
                </div>
                <div class="col-md-3">
                  <label class="form-label">Bairro</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestBairro">
                </div>
                <div class="col-md-2">
                  <label class="form-label">UF</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestUf" maxlength="2">
                </div>
                <div class="col-md-4">
                  <label class="form-label">Município</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestMunicipio">
                </div>
                <div class="col-md-3">
                  <label class="form-label">País</label>
                  <input type="text" class="form-control form-control-sm" id="nfaDestPais" value="BRASIL">
                </div>
              </div>
            </section>

            <section class="nfa-section">
              <h3 class="nfa-section__title"><span class="nfa-section__num">2</span> Operação Fiscal</h3>
              <div class="row g-2 align-items-end">
                <div class="col-md-5">
                  <label class="form-label">Natureza da Operação *</label>
                  <input type="text" class="form-control" id="nfaNatureza" value="VENDA DE MERCADORIA">
                </div>
                <div class="col-md-3">
                  <label class="form-label">CFOP *</label>
                  <div class="input-group">
                    <input type="text" class="form-control" id="nfaCfop" value="5102">
                    <button type="button" class="btn btn-outline-secondary" id="btnNfaCfopHint" title="Descrição do CFOP">
                      <i class="fas fa-search"></i>
                    </button>
                  </div>
                </div>
                <div class="col-md-4">
                  <div class="nfa-cfop-hint" id="nfaCfopDesc">
                    <strong>5102</strong> — Venda de mercadoria adquirida ou recebida de terceiros.
                  </div>
                </div>
              </div>
            </section>

            <section class="nfa-section">
              <h3 class="nfa-section__title"><span class="nfa-section__num">3</span> Produtos / Itens</h3>
              <div class="row g-2 align-items-end mb-2">
                <div class="col-md-5 position-relative">
                  <label class="form-label small mb-0">Código ou descrição do produto</label>
                  <div class="input-group input-group-sm">
                    <input type="text" class="form-control" id="nfaProdutoBusca" placeholder="Buscar produto…" autocomplete="off">
                    <span class="input-group-text"><i class="fas fa-search"></i></span>
                  </div>
                  <div id="nfaProdutoSugestoes" class="list-group position-absolute w-100 shadow nfa-sugestoes" style="display:none;"></div>
                </div>
                <div class="col-md-2">
                  <label class="form-label small mb-0">Qtd</label>
                  <input type="number" class="form-control form-control-sm" id="nfaItemQtd" min="0.001" step="0.001" value="1">
                </div>
                <div class="col-md-2">
                  <label class="form-label small mb-0">Preço (R$)</label>
                  <input type="number" class="form-control form-control-sm" id="nfaItemPreco" min="0" step="0.01" value="0">
                </div>
                <div class="col-md-1">
                  <label class="form-label small mb-0">Desc. %</label>
                  <input type="number" class="form-control form-control-sm" id="nfaItemDesc" min="0" max="100" step="0.01" value="0">
                </div>
                <div class="col-md-2">
                  <button type="button" class="btn btn-sm btn-success w-100" id="btnNfaAddItem">
                    <i class="fas fa-plus"></i> Adicionar
                  </button>
                </div>
              </div>
              <input type="hidden" id="nfaProdutoId">
              <input type="hidden" id="nfaProdutoNome">
              <input type="hidden" id="nfaProdutoCodigo">
              <input type="hidden" id="nfaProdutoNcm">
              <input type="hidden" id="nfaProdutoCfop">
              <input type="hidden" id="nfaProdutoUnidade">

              <div class="table-responsive">
                <table class="table table-sm table-hover align-middle mb-0">
                  <thead class="table-light">
                    <tr>
                      <th>#</th>
                      <th>Código</th>
                      <th>Produto</th>
                      <th>NCM</th>
                      <th>CFOP</th>
                      <th>Un.</th>
                      <th class="text-end">Qtd</th>
                      <th class="text-end">Preço</th>
                      <th class="text-end">Desc. %</th>
                      <th class="text-end">Total</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody id="nfaItensBody"></tbody>
                </table>
              </div>
            </section>

            <div class="row g-3">
              <div class="col-md-6">
                <section class="nfa-section">
                  <h3 class="nfa-section__title"><span class="nfa-section__num">4</span> Transporte / Frete</h3>
                  <div class="mb-2">
                    <label class="form-label">Transportadora</label>
                    <input type="text" class="form-control" id="nfaTransportadora" placeholder="Opcional">
                  </div>
                  <div class="row g-2">
                    <div class="col-6">
                      <label class="form-label">Frete (R$)</label>
                      <input type="number" step="0.01" min="0" class="form-control" id="nfaFrete" value="0">
                    </div>
                    <div class="col-6">
                      <label class="form-label">Modalidade de frete</label>
                      <select class="form-select" id="nfaModFrete">
                        <option value="9">9 - Sem frete</option>
                        <option value="0">0 - Emitente</option>
                        <option value="1">1 - Destinatário</option>
                      </select>
                    </div>
                  </div>
                </section>
              </div>
              <div class="col-md-6">
                <section class="nfa-section">
                  <h3 class="nfa-section__title"><span class="nfa-section__num">5</span> Informações Adicionais</h3>
                  <div class="mb-2">
                    <label class="form-label">Desconto (R$)</label>
                    <input type="number" step="0.01" min="0" class="form-control" id="nfaDesconto" value="0">
                  </div>
                  <div>
                    <label class="form-label">Observações</label>
                    <textarea class="form-control" id="nfaObservacoes" rows="3" placeholder="Informações complementares da NF-e…"></textarea>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <div class="col-lg-4">
            <div class="nfa-side">
              <section class="nfa-section">
                <h3 class="nfa-section__title"><span class="nfa-section__num">6</span> Pagamento</h3>
                <div id="nfaFormaWrap">
                  <label class="form-label">Forma de pagamento *</label>
                  <select class="form-select" id="nfaForma"></select>
                </div>
                <div id="nfaPixHint" class="nfa-pix-hint d-none"></div>
                <div id="nfaPagamentoExtras"></div>
              </section>

              <section class="nfa-section">
                <h3 class="nfa-section__title"><span class="nfa-section__num">7</span> Resumo da NF-e</h3>
                <div class="nfa-resumo-row"><span>Subtotal dos itens</span><strong id="nfaTotSub">R$ 0,00</strong></div>
                <div class="nfa-resumo-row"><span>Frete</span><strong id="nfaTotFrete">R$ 0,00</strong></div>
                <div class="nfa-resumo-row"><span>Desconto</span><strong id="nfaTotDesc">R$ 0,00</strong></div>
                <div class="nfa-resumo-total">
                  <span>TOTAL DA NF-e</span>
                  <span class="nfa-total-valor" id="nfaTotGeral">R$ 0,00</span>
                </div>
              </section>

              <div class="nfa-info-box mb-3">
                <strong><i class="fas fa-info-circle me-1"></i> Informações importantes</strong>
                <ul>
                  <li>Verifique os dados do destinatário.</li>
                  <li>Confirme a natureza da operação e CFOP.</li>
                  <li>Revise os itens, frete e desconto.</li>
                  <li>Confirme a forma de pagamento.</li>
                  <li>Após a emissão, o XML será enviado para a SEFAZ.</li>
                </ul>
              </div>

              <div class="nfa-actions">
                <button type="button" class="btn btn-outline-secondary" onclick="loadPage('nfe-central')">
                  <i class="fas fa-times"></i> Cancelar
                </button>
                <button type="button" class="btn btn-primary" id="btnNfaEmitir">
                  <i class="fas fa-file-invoice"></i> Emitir NF-e
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    $('#page-content').html(html);
    renderItens();
    atualizarBannerF12();

    if (typeof CdsFormasPagamento !== 'undefined') {
      $('#nfaForma').html(CdsFormasPagamento.optionsHtml('pix'));
      $('#nfaPagamentoExtras').html(CdsFormasPagamento.htmlPaineisExtras('nfa'));
      CdsFormasPagamento.bind('nfa', () => calcularTotais().total);
    } else {
      $('#nfaForma').html('<option value="pix" selected>PIX</option><option value="dinheiro">Dinheiro</option>');
    }
    atualizarHintPagamento();

    $('.nfa-tab').on('click', function () {
      ativarAbaDest($(this).data('aba'));
    });
    $('#btnNfaLimparDest').on('click', limparDestinatario);
    $('#btnNfaConsultarCnpj').on('click', consultarCnpjDestinatario);
    $('#btnNfaUsarDest').on('click', usarDestinatarioConsultado);
    $('#nfaDestDoc').on('input', function () { formatarDocInput(this); });
    $('#nfaDestDoc').on('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); consultarCnpjDestinatario(); }
    });
    $('#nfaClienteBusca').on('input', function () { buscarClientes($(this).val()); });
    $('#nfaProdutoBusca').on('input', function () { buscarProdutos($(this).val()); });
    $('#btnNfaAddItem').on('click', adicionarItem);
    $('#nfaItemQtd, #nfaItemPreco').on('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); adicionarItem(); }
    });
    $('#nfaFrete, #nfaDesconto').on('input', () => {
      const t = calcularTotais();
      if (typeof CdsFormasPagamento !== 'undefined') {
        CdsFormasPagamento.atualizarResumo(null, 'nfa', t.total);
      }
    });
    $('#nfaForma').on('change', atualizarHintPagamento);
    $('#btnNfaCfopHint').on('click', () => {
      const cfop = String($('#nfaCfop').val() || '').trim();
      const mapa = {
        '5102': 'Venda de mercadoria adquirida ou recebida de terceiros.',
        '5101': 'Venda de produção do estabelecimento.',
        '5405': 'Venda de mercadoria sujeita a ST, de propriedade do estabelecimento.'
      };
      $('#nfaCfopDesc').html(
        `<strong>${escapeHtml(cfop || '—')}</strong> — ${escapeHtml(mapa[cfop] || 'Confira o CFOP nas regras fiscais da empresa.')}`
      );
    });
    $('#btnNfaEmitir').on('click', emitir);
    $(document).off('cds:modo-fiscal-alterado.nfa').on('cds:modo-fiscal-alterado.nfa', atualizarBannerF12);
  }

  window.loadNfeAvulsa = loadNfeAvulsa;
})();
