/**
 * Histórico de Vendas — visão comercial (Hotfix pós NF-e).
 *
 * Regra: a Venda = operação comercial completa.
 * A NF-e / NFC-e = documentos fiscais vinculados — nunca substituem a Venda.
 * F12 (modo fiscal) NÃO altera itens/totais do histórico.
 */

function escapeHtmlHistoricoVenda(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** @deprecated Histórico é sempre comercial; mantido para compatibilidade. */
function historicoVendaModoFiscalAtivo() {
    return false;
}

function itemPossuiParteFiscalHistorico(item) {
    return Number(item?.quantidade_fiscal ?? 0) > 0 || Number(item?.valor_fiscal ?? 0) > 0;
}

/** Sempre todos os itens comerciais da venda. */
function filtrarItensHistoricoVenda(venda) {
    return Array.isArray(venda?.itens) ? venda.itens : [];
}

/** Sempre o total comercial da negociação. */
function obterTotalExibicaoHistoricoVenda(venda) {
    return Number(venda?.total || 0);
}

function rotuloTipoRecebimentoHistorico(tipo) {
    const t = String(tipo || '').toLowerCase().trim();
    if (t === 'a' || t === 'fiscal' || t === 'recebimento_a') return 'Recebimento A';
    if (t === 'b' || t === 'nao_fiscal' || t === 'recebimento_b') return 'Recebimento B';
    return '';
}

function rotuloFormaPagamentoHistoricoFallback(value) {
    const mapa = {
        dinheiro: 'Dinheiro',
        pix: 'PIX',
        cartao_credito: 'Cartão crédito',
        cartao_debito: 'Cartão débito',
        boleto: 'Boleto',
        transferencia: 'Transferência',
        cheque: 'Cheque',
        credito: 'Crédito',
        prazo: 'A prazo',
        misto: 'Misto'
    };
    const chave = String(value || '').toLowerCase().trim();
    return mapa[chave] || (value ? String(value) : '-');
}

function formatarMoedaPagamentoHistorico(n) {
    if (typeof formatCurrency === 'function') return formatCurrency(n);
    const num = Number(n || 0);
    return 'R$ ' + num.toFixed(2).replace('.', ',');
}

function textoLinhaPagamentoHistorico(p, rotuloForma, fmt) {
    const forma = escapeHtmlHistoricoVenda(rotuloForma(p.forma_pagamento));
    const tipo = p.rotulo_recebimento
        || rotuloTipoRecebimentoHistorico(p.grupo_recebimento || p.tipo_recebimento);
    const valor = fmt(p.valor);
    if (tipo) return `${forma} (${escapeHtmlHistoricoVenda(tipo)}): ${valor}`;
    return `${forma}: ${valor}`;
}

function montarHtmlPagamentosHistoricoVenda(venda) {
    const pags = Array.isArray(venda?.pagamentos) ? venda.pagamentos : [];
    const fmt = formatarMoedaPagamentoHistorico;
    const rotuloForma = typeof rotuloFormaPagamento === 'function'
        ? rotuloFormaPagamento
        : rotuloFormaPagamentoHistoricoFallback;
    if (!pags.length) {
        const forma = escapeHtmlHistoricoVenda(rotuloForma(venda && venda.forma_pagamento));
        if (venda && venda.total != null && venda.total !== '') {
            return `<div class="venda-pagamentos-exibicao">${forma}: ${fmt(venda.total)}</div>`;
        }
        return `<div class="venda-pagamentos-exibicao">${forma}</div>`;
    }
    const ordemTipo = function (p) {
        const t = String(p.grupo_recebimento || p.tipo_recebimento || p.rotulo_recebimento || '').toLowerCase().trim();
        if (t === 'a' || t === 'fiscal' || t.indexOf('recebimento a') >= 0) return 0;
        if (t === 'b' || t === 'nao_fiscal' || t.indexOf('recebimento b') >= 0) return 1;
        return 2;
    };
    const ordenados = pags.slice().sort(function (a, b) {
        return ordemTipo(a) - ordemTipo(b);
    });
    const linhas = ordenados.map((p) => (
        `<div class="venda-pagamento-linha">${textoLinhaPagamentoHistorico(p, rotuloForma, fmt)}</div>`
    )).join('');
    return `<div class="venda-pagamentos-exibicao" id="${venda && venda.id != null ? `vendaPagamentosExibicao${venda.id}` : ''}">${linhas}</div>`;
}

function exibirCupomNaoFiscalHistorico(venda) {
    return typeof vendaPossuiCupomNaoFiscal === 'function' && vendaPossuiCupomNaoFiscal(venda);
}

function moduloFiscalDisponivelHistorico() {
    if (typeof fiscalHabilitado === 'function') return fiscalHabilitado();
    if (typeof implantacaoPermiteFiscal === 'function') return implantacaoPermiteFiscal();
    return false;
}

function vendaHistoricoTemCupomFiscal(venda) {
    if (!moduloFiscalDisponivelHistorico()) return false;
    if (!venda) return false;
    if (venda.nfce_id || venda.nfce_numero) return true;
    if (typeof vendaPossuiNfceAutorizada === 'function' && vendaPossuiNfceAutorizada(venda)) {
        return true;
    }
    return Number(venda.valor_fiscal || 0) > 0 && Boolean(venda.nfce_status);
}

function vendaHistoricoTemNfe(venda) {
    if (!moduloFiscalDisponivelHistorico()) return false;
    if (!venda) return false;
    if (venda.nfe_id || venda.nfe_numero || venda.nfe_chave) return true;
    const st = String(venda.nfe_status || '').toLowerCase();
    return st === 'autorizada' || st === 'autorizado';
}

function vendaHistoricoTemCupomNaoFiscal(venda) {
    if (!venda) return false;
    if (typeof vendaPossuiCupomNaoFiscal === 'function') {
        return vendaPossuiCupomNaoFiscal(venda);
    }
    if (Number(venda.valor_nao_fiscal || 0) > 0) return true;
    if (typeof vendaPossuiNfceAutorizada === 'function' && vendaPossuiNfceAutorizada(venda)) {
        return false;
    }
    return Number(venda.valor_fiscal || 0) === 0 && Number(venda.total || 0) > 0;
}

function montarHtmlNfeVinculadaHistorico(venda) {
    if (!vendaHistoricoTemNfe(venda)) return '';
    const num = venda.nfe_numero ? ` nº <strong>${escapeHtmlHistoricoVenda(String(venda.nfe_numero))}</strong>` : '';
    const chave = venda.nfe_chave
        ? `<div class="small text-muted mt-1">Chave: ${escapeHtmlHistoricoVenda(venda.nfe_chave)}</div>`
        : '';
    const proto = venda.nfe_protocolo
        ? `<div class="small text-muted">Protocolo: ${escapeHtmlHistoricoVenda(venda.nfe_protocolo)}</div>`
        : '';
    const id = Number(venda.id);
    return `
        <div class="alert alert-info py-2 mb-3">
            <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                <div>
                    <i class="fas fa-file-invoice"></i>
                    <strong>NF-e vinculada</strong> (parcela fiscal)${num}
                    ${chave}${proto}
                    <div class="small mt-1">A venda abaixo permanece com a operação comercial completa.</div>
                </div>
                <button type="button" class="btn btn-sm btn-outline-primary" onclick="abrirDanfeNfeHistorico(${id})">
                    <i class="fas fa-external-link-alt"></i> Abrir DANFE NF-e
                </button>
            </div>
        </div>`;
}

function abrirDanfeNfeHistorico(vendaId) {
    if (!moduloFiscalDisponivelHistorico()) {
        if (typeof showNotification === 'function') {
            showNotification('Módulo não contratado.', 'warning');
        }
        return;
    }
    const base = (typeof API_URL !== 'undefined' ? API_URL : '/api');
    window.open(`${base}/faturamento/vendas/${vendaId}/danfe`, '_blank', 'noopener');
}

function montarHtmlAcoesHistoricoVenda(venda, opcoes = {}) {
    const incluirDevolucao = opcoes.incluirDevolucao !== false;
    const id = Number(venda.id);
    const dropdownId = `acoesVenda${id}`;
    const cancelada = String(venda.status || '').toLowerCase() === 'cancelada'
        || Number(venda.cancelada || 0) === 1;

    const temFiscal = vendaHistoricoTemCupomFiscal(venda);
    const temNaoFiscal = vendaHistoricoTemCupomNaoFiscal(venda);
    const temNfe = vendaHistoricoTemNfe(venda);
    const nfceNumero = venda.nfce_numero ? ` #${venda.nfce_numero}` : '';
    const tipoCupom = temFiscal ? 'fiscal' : (temNaoFiscal ? 'nao_fiscal' : null);

    const blocoImpressao = tipoCupom ? `
        <li><hr class="dropdown-divider my-1"></li>
        <li>
            <button
                type="button"
                class="dropdown-item py-2"
                onclick="${tipoCupom === 'fiscal' ? `reimprimirCupomFiscalHistorico(${id})` : `reimprimirCupomNaoFiscalHistorico(${id})`}"
            >
                <i class="${tipoCupom === 'fiscal' ? 'fas fa-print' : 'fas fa-receipt'} fa-fw me-2 text-muted"></i>
                ${tipoCupom === 'fiscal'
                    ? `Reimprimir cupom fiscal${escapeHtmlHistoricoVenda(nfceNumero)}`
                    : 'Reimprimir cupom não fiscal'}
            </button>
        </li>
    ` : '';

    const blocoNfe = temNfe ? `
        <li><hr class="dropdown-divider my-1"></li>
        <li>
            <button type="button" class="dropdown-item py-2" onclick="abrirDanfeNfeHistorico(${id})">
                <i class="fas fa-file-invoice fa-fw me-2 text-muted"></i>Abrir DANFE NF-e
            </button>
        </li>
    ` : '';

    const blocoOperacional = !cancelada ? `
        <li><hr class="dropdown-divider my-1"></li>
        ${incluirDevolucao ? `
        <li>
            <button type="button" class="dropdown-item py-2" onclick="abrirDevolucaoVenda(${id})">
                <i class="fas fa-undo fa-fw me-2 text-muted"></i>Devolução parcial
            </button>
        </li>` : ''}
        <li>
            <button type="button" class="dropdown-item py-2 text-danger" onclick="cancelarVendaNaoFiscal(${id})">
                <i class="fas fa-times fa-fw me-2"></i>Cancelar venda
            </button>
        </li>
    ` : '';

    return `
        <div class="historico-venda-acoes">
            <button
                type="button"
                class="btn btn-sm btn-outline-primary"
                onclick="viewVenda(${id})"
                title="Ver detalhes"
            >
                <i class="fas fa-eye"></i>
            </button>
            <div class="dropdown d-inline-block">
                <button
                    type="button"
                    class="btn btn-sm btn-outline-secondary historico-venda-acoes-menu"
                    id="${dropdownId}"
                    data-bs-toggle="dropdown"
                    data-bs-boundary="viewport"
                    aria-expanded="false"
                    title="Mais ações"
                >
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <ul class="dropdown-menu dropdown-menu-end historico-venda-acoes-dropdown shadow-sm" aria-labelledby="${dropdownId}">
                    <li>
                        <button type="button" class="dropdown-item py-2" onclick="viewVenda(${id})">
                            <i class="fas fa-eye fa-fw me-2 text-muted"></i>Ver detalhes
                        </button>
                    </li>
                    <li>
                        <button type="button" class="dropdown-item py-2" onclick="verResumoVendaFiscalTEF(${id})">
                            <i class="fas fa-file-alt fa-fw me-2 text-muted"></i>Resumo NFC-e / TEF
                        </button>
                    </li>
                    ${blocoImpressao}
                    ${blocoNfe}
                    ${blocoOperacional}
                </ul>
            </div>
        </div>
    `;
}

window.montarHtmlPagamentosHistoricoVenda = montarHtmlPagamentosHistoricoVenda;
window.montarHtmlAcoesHistoricoVenda = montarHtmlAcoesHistoricoVenda;
window.historicoVendaModoFiscalAtivo = historicoVendaModoFiscalAtivo;
window.filtrarItensHistoricoVenda = filtrarItensHistoricoVenda;
window.obterTotalExibicaoHistoricoVenda = obterTotalExibicaoHistoricoVenda;
window.exibirCupomNaoFiscalHistorico = exibirCupomNaoFiscalHistorico;
window.moduloFiscalDisponivelHistorico = moduloFiscalDisponivelHistorico;
window.vendaHistoricoTemNfe = vendaHistoricoTemNfe;
window.montarHtmlNfeVinculadaHistorico = montarHtmlNfeVinculadaHistorico;
window.abrirDanfeNfeHistorico = abrirDanfeNfeHistorico;
