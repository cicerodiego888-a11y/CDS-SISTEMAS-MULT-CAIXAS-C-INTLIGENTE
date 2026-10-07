function escapeHtmlCupom(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizarTipoVendaItemCupom(item) {
    const tipo = String(item?.tipo_venda || '').toUpperCase();
    if (tipo === 'UNIDADE') return 'UNIDADE';
    if (tipo === 'PESO') return 'PESO';
    if (item?.modo_venda === 'unidade') return 'UNIDADE';
    return 'PESO';
}

function itemVendaPorUnidadeCupom(item) {
    return normalizarTipoVendaItemCupom(item) === 'UNIDADE';
}

function moedaCupom(valor) {
    return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
}

function formatarHtmlItemCupom(item) {
    const nome = escapeHtmlCupom(item.produto_nome || item.nome || 'Produto');
    const subtotal = Number(item.subtotal || 0);
    const preco = Number(item.preco_unitario || item.preco || 0);
    const qtd = itemVendaPorUnidadeCupom(item)
        ? Math.round(Number(item.quantidade || 0))
        : Number(item.quantidade || 0);
    const detalhe = itemVendaPorUnidadeCupom(item)
        ? `${qtd} UN x ${moedaCupom(preco)}`
        : `${qtd} x ${moedaCupom(preco)}`;
    return `<div class="item"><div class="item-nome">${nome}</div><div class="item-linha"><span class="rotulo">${detalhe}</span><span class="valor">${moedaCupom(subtotal)}</span></div></div>`;
}

async function obterCaixaAtualParaResolucaoImpressora() {
    try {
        const api = (typeof window !== 'undefined' && window.ObterCaixaAtual)
            || (typeof globalThis !== 'undefined' && globalThis.ObterCaixaAtual);
        if (api && typeof api.obterCaixaAtual === 'function') {
            const resultado = await api.obterCaixaAtual();
            if (resultado && resultado.ok && resultado.caixaId) {
                return Number(resultado.caixaId);
            }
        }

        if (typeof globalThis !== 'undefined' && typeof globalThis.obterCaixaAtual === 'function') {
            const resultado = await globalThis.obterCaixaAtual();
            if (resultado && resultado.ok && resultado.caixaId) {
                return Number(resultado.caixaId);
            }
        }
    } catch (e) {
        // Mantém fallback legado sem quebrar o fluxo atual.
    }
    return null;
}

async function resolverImpressoraDoCaixa(caixaId = null) {
    const caixaAtualId = caixaId || await obterCaixaAtualParaResolucaoImpressora();
    const token = (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '';
    const headers = { Authorization: `Bearer ${token}` };

    if (caixaAtualId) {
        try {
            const resp = await fetch(`${API_URL}/caixas/${caixaAtualId}/impressora-cupom`, {
                headers
            });
            const data = await resp.json().catch(() => ({}));
            if (resp.ok && data && Object.prototype.hasOwnProperty.call(data, 'deviceName')) {
                return {
                    configurada: data.configurada === true,
                    deviceName: data.deviceName || null,
                    fallback: data.fallback || null
                };
            }
        } catch (e) {
            // Preserva o fallback legado se a API do caixa estiver indisponível.
        }

        return { configurada: false, deviceName: null };
    }

    try {
        const resp = await fetch(`${API_URL}/configuracoes/impressora_cupom`, {
            headers
        });
        const data = await resp.json().catch(() => ({}));
        const legado = data && data.caminho ? data.caminho : null;
        if (legado) {
            return { configurada: false, deviceName: legado, fallback: legado };
        }
    } catch (e) {
        // Sem impressora global e sem caixa configurado.
    }

    return { configurada: false, deviceName: null };
}

async function obterDeviceNameImpressoraCupom() {
    const resolucao = await resolverImpressoraDoCaixa();
    return resolucao?.deviceName || null;
}

async function obterDadosEmpresaCupom() {
    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_URL}/configuracoes`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!resp.ok) {
            return { nome_empresa: (typeof BrandService !== 'undefined' ? BrandService.NOME : 'CDS Sistemas'), endereco: '' };
        }

        const configs = await resp.json();
        const map = {};
        if (Array.isArray(configs)) {
            configs.forEach((c) => {
                map[c.chave] = c.valor;
            });
        }

        const partes = [
            map.fiscal_emitente_logradouro,
            map.fiscal_emitente_numero,
            map.fiscal_emitente_bairro,
            map.fiscal_municipio_nome
        ].filter(Boolean);

        return {
            nome_empresa: map.nome_empresa || (typeof BrandService !== 'undefined' ? BrandService.NOME : 'CDS Sistemas'),
            endereco: partes.join(', '),
            papel_mm: Number(map.fiscal_danfe_largura_mm) === 58 ? 58 : 80
        };
    } catch (e) {
        return { nome_empresa: (typeof BrandService !== 'undefined' ? BrandService.NOME : 'CDS Sistemas'), endereco: '' };
    }
}

function montarItensCupomNaoFiscal(venda) {
    const itens = Array.isArray(venda?.itens) ? venda.itens : [];
    const valorFiscal = Number(venda?.valor_fiscal || 0);
    const valorNaoFiscal = Number(venda?.valor_nao_fiscal || 0);

    if (valorFiscal <= 0 || valorNaoFiscal <= 0) {
        return itens.map((item) => ({
            ...item,
            produto_nome: item.produto_nome || item.nome || 'Produto',
            subtotal: Number(item.subtotal || 0),
            quantidade: Number(item.quantidade || 0),
            preco_unitario: Number(item.preco_unitario || 0)
        }));
    }

    return itens
        .filter((item) => Number(item.valor_nao_fiscal || 0) > 0 || Number(item.quantidade_nao_fiscal || 0) > 0)
        .map((item) => {
            const valNf = Number(item.valor_nao_fiscal || 0);
            const qtdNf = Number(item.quantidade_nao_fiscal || item.quantidade || 0);
            const preco = qtdNf > 0 ? valNf / qtdNf : Number(item.preco_unitario || 0);
            return {
                ...item,
                produto_nome: item.produto_nome || item.nome || 'Produto',
                quantidade: qtdNf,
                preco_unitario: preco,
                subtotal: valNf
            };
        });
}

function obterTotalCupomNaoFiscal(venda) {
    const valorNaoFiscal = Number(venda?.valor_nao_fiscal || 0);
    if (valorNaoFiscal > 0) return valorNaoFiscal;
    return Number(venda?.total || 0);
}

function montarHtmlCupomNaoFiscal(vendaId, venda, total, desconto) {
    const dataHora = venda.data_venda || venda.created_at
        ? new Date(venda.data_venda || venda.created_at).toLocaleString('pt-BR')
        : new Date().toLocaleString('pt-BR');

    const formaPagamentoTexto = {
        dinheiro: 'Dinheiro',
        cartao_credito: 'Cartão de Crédito',
        cartao_debito: 'Cartão de Débito',
        pix: 'PIX',
        prazo: 'A Prazo',
        misto: 'Misto'
    }[venda.forma_pagamento] || venda.forma_pagamento || '-';

    const clienteNome = venda.cliente_nome || '';
    const papelMm = Number(venda.papel_mm) === 58 ? 58 : 80;
    const estreito = papelMm === 58;
    const itensHtml = (venda.itens || []).map((item) => formatarHtmlItemCupom(item)).join('');

    const totalNum = Number(total || 0);
    const valorRecebido = Number(
        venda.valor_recebido
        ?? venda.valorRecebido
        ?? 0
    );
    const trocoCampo = Number(venda.troco || venda.valor_troco || 0);
    const troco = trocoCampo > 0.009
        ? trocoCampo
        : (valorRecebido > totalNum ? Math.round((valorRecebido - totalNum) * 100) / 100 : 0);
    const formaEhDinheiro = String(venda.forma_pagamento || '').toLowerCase() === 'dinheiro';
    const mostrarTrocoDinheiro = troco > 0.009 && (valorRecebido > 0 || formaEhDinheiro);
    const valorEntregueExibir = valorRecebido > 0 ? valorRecebido : (totalNum + troco);
    const linhasTroco = mostrarTrocoDinheiro
        ? `<div class="row"><span class="rotulo">Valor entregue:</span><span class="valor">${moedaCupom(valorEntregueExibir)}</span></div><div class="row"><span class="rotulo">Troco:</span><span class="valor">${moedaCupom(troco)}</span></div>`
        : '';

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Comprovante não fiscal</title>
<style>
  @page { size: ${papelMm}mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  .cds-cupom-termico {
    width: ${papelMm}mm; max-width: ${papelMm}mm;
    margin: 0 auto;
    padding: ${estreito ? '1.2mm 2mm 1.6mm' : '1.5mm 2.5mm 2mm'};
    box-sizing: border-box;
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: ${estreito ? '9px' : '11px'};
    line-height: 1.22; font-weight: 600; color: #000; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .cds-cupom-termico * { box-sizing: border-box; }
  .empresa { font-size: ${estreito ? '13px' : '18px'}; font-weight: 800; text-align: center; text-transform: uppercase; overflow-wrap: anywhere; line-height: 1.15; }
  .meta, .txt { text-align: center; overflow-wrap: anywhere; }
  .titulo { font-size: ${estreito ? '12px' : '16px'}; font-weight: 800; text-align: center; }
  .sec { font-size: ${estreito ? '10px' : '12px'}; font-weight: 800; text-align: center; margin: 1.2mm 0 0.4mm; }
  .aviso { text-align: center; font-weight: 800; overflow-wrap: anywhere; }
  .sep { border: 0; border-top: 1px solid #000; margin: 0.8mm 0; }
  .row, .item-linha { display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; width: 100%; }
  .rotulo, .item-nome, .txt { min-width: 0; overflow-wrap: anywhere; }
  .valor { flex: 0 1 auto; max-width: 58%; text-align: right; font-weight: 700; overflow-wrap: anywhere; }
  .item { margin: 0 0 0.8mm; width: 100%; }
  .item-nome { font-weight: 700; }
  .total .rotulo, .total .valor { font-size: ${estreito ? '12px' : '16px'}; font-weight: 700; }
</style>
</head>
<body class="cupom-nao-fiscal-${papelMm}">
<main class="cds-cupom-termico">
<div class="empresa">${escapeHtmlCupom(venda.nome_empresa || (typeof BrandService !== 'undefined' ? BrandService.NOME : 'CDS Sistemas'))}</div>
<div class="meta">${escapeHtmlCupom(venda.endereco || '')}</div>
<div class="titulo">COMPROVANTE NÃO FISCAL</div>
<div class="txt">Venda #${escapeHtmlCupom(vendaId)}</div>
<div class="txt">${escapeHtmlCupom(dataHora)}</div>
<hr class="sep">
<div class="sec">ITENS</div>
${itensHtml}
<hr class="sep">
<div class="row total"><span class="rotulo">Total:</span><span class="valor">${moedaCupom(totalNum)}</span></div>
<div class="row"><span class="rotulo">Desconto:</span><span class="valor">${moedaCupom(desconto || 0)}</span></div>
<div class="row"><span class="rotulo">Forma pag.:</span><span class="valor">${escapeHtmlCupom(formaPagamentoTexto)}</span></div>
${linhasTroco}
${clienteNome ? `<div class="txt">Cliente: ${escapeHtmlCupom(clienteNome)}</div>` : ''}
<hr class="sep">
<div class="aviso">ESTE COMPROVANTE NÃO POSSUI VALOR FISCAL</div>
<div class="aviso">OBRIGADO PELA PREFERÊNCIA!</div>
<div class="aviso">VOLTE SEMPRE.</div>
</main>
</body>
</html>`;
}

async function apresentarCupomNaTela(htmlTela, htmlImpressao, opcoes) {
    const opts = opcoes || {};
    if (window.electronAPI?.abrirComprovante) {
        window.electronAPI.abrirComprovante(htmlTela, {
            silent: false,
            autoFecharMs: 5000,
            aguardarDecisao: true,
            deviceName: null,
            htmlImpressao: htmlImpressao || htmlTela,
            enviarImpressora: false
        });
    } else {
        const janela = window.open('', '_blank', 'width=420,height=720');
        if (!janela) {
            if (typeof showNotification === 'function') {
                showNotification('Permita pop-ups para visualizar o cupom.', 'warning');
            }
        } else {
            janela.document.open();
            janela.document.write(htmlTela);
            janela.document.close();
            janela.focus();
        }
    }

    if (window.CupomPrintPolicy && typeof window.CupomPrintPolicy.aposCupomNaTela === 'function') {
        return window.CupomPrintPolicy.aposCupomNaTela({
            tipo: opts.tipo || 'NAO_FISCAL',
            html: htmlImpressao || htmlTela,
            vendaId: opts.vendaId,
            automatico: opts.automatico === true,
            reimpressao: opts.reimpressao === true
        });
    }

    if (opts.reimpressao === true || (opts.automatico === true && deveEnviarCupomParaImpressora(opts))) {
        const deviceName = await obterDeviceNameImpressoraCupom();
        if (deviceName && window.electronAPI?.imprimirDANFESilencioso) {
            await window.electronAPI.imprimirDANFESilencioso(htmlImpressao || htmlTela, deviceName);
        }
    }
}

async function enviarCupomNaoFiscalParaImpressora(vendaId, venda, total, desconto, enviarImpressora, opcoes) {
    const cupomHtml = montarHtmlCupomNaoFiscal(vendaId, venda, total, desconto);
    const automatico = !!(opcoes && opcoes.automatico);
    const reimpressao = !automatico && enviarImpressora !== false && !(opcoes && opcoes.somenteTela);
    await apresentarCupomNaTela(cupomHtml, cupomHtml, {
        tipo: 'NAO_FISCAL',
        vendaId,
        automatico,
        reimpressao
    });
}

function impressaoAutomaticaCupomPermitida() {
    if (typeof window.pdvImprimirCupomAtivo === 'function') {
        return window.pdvImprimirCupomAtivo() !== false;
    }
    return true;
}

function deveEnviarCupomParaImpressora(opcoes) {
    if (opcoes && opcoes.forcarImpressora === true) return true;
    if (opcoes && opcoes.automatico === true) {
        return impressaoAutomaticaCupomPermitida();
    }
    return true;
}

async function imprimirCupomNaoFiscal(vendaId, venda, total, desconto, opcoes) {
    if (!vendaId || !venda) {
        if (typeof showNotification === 'function') {
            showNotification('Dados insuficientes para imprimir cupom não fiscal.', 'warning');
        }
        return;
    }

    try {
        let vendaCupom = venda;
        if (!venda.nome_empresa) {
            const empresa = await obterDadosEmpresaCupom();
            vendaCupom = { ...venda, ...empresa };
        }

        await enviarCupomNaoFiscalParaImpressora(
            vendaId,
            vendaCupom,
            total,
            desconto,
            deveEnviarCupomParaImpressora(opcoes),
            opcoes
        );
    } catch (error) {
        console.error('Erro ao imprimir cupom não fiscal:', error);
        if (typeof showNotification === 'function') {
            showNotification('Erro ao imprimir cupom não fiscal.', 'danger');
        }
    }
}

async function imprimirDANFEFiscal(vendaId, opcoes) {
    if (!vendaId) {
        if (typeof showNotification === 'function') {
            showNotification('Venda não informada para reimpressão.', 'warning');
        }
        return;
    }

    try {
        const token = localStorage.getItem('token');
        const resposta = await fetch(`${API_URL}/fiscal/danfe/venda/${vendaId}?pacote=1`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
        });

        const contentType = String(resposta.headers.get('content-type') || '');
        let htmlDanfe = '';
        let htmlTermico = '';

        if (contentType.includes('application/json')) {
            const pacote = await resposta.json();
            htmlDanfe = pacote.html || '';
            htmlTermico = pacote.htmlTermico || '';
            if (!/danfe-termico/.test(htmlTermico) && /danfe-termico/.test(String(pacote.html || ''))) {
                htmlTermico = pacote.html;
            }
        } else {
            htmlDanfe = await resposta.text();
            htmlTermico = /danfe-termico/.test(htmlDanfe) ? htmlDanfe : '';
        }

        if (!resposta.ok) {
            const erroTxt = typeof htmlDanfe === 'string' && htmlDanfe
                ? htmlDanfe
                : 'Falha ao obter DANFE.';
            console.error('Erro ao buscar DANFE:', { status: resposta.status, resposta: erroTxt });
            if (typeof showNotification === 'function') {
                showNotification(`Erro ao abrir cupom fiscal: ${erroTxt}`, 'danger');
            }
            return;
        }

        const htmlCupom = htmlTermico;
        if (!htmlCupom) {
            if (typeof showNotification === 'function') {
                showNotification('Cupom NFC-e oficial indisponível.', 'danger');
            }
            return;
        }

        const automatico = !!(opcoes && opcoes.automatico);
        const reimpressao = !!(opcoes && opcoes.reimpressao) || (!automatico && deveEnviarCupomParaImpressora(opcoes));
        await apresentarCupomNaTela(htmlCupom, htmlCupom, {
            tipo: 'FISCAL',
            vendaId,
            automatico,
            reimpressao
        });
    } catch (error) {
        console.error('Erro ao imprimir DANFE fiscal:', error);
        if (typeof showNotification === 'function') {
            showNotification('Erro ao imprimir cupom fiscal.', 'danger');
        }
    }
}

function vendaPossuiNfceAutorizada(venda) {
    return String(venda?.nfce_situacao_fiscal || '').toUpperCase() === 'AUTORIZADA';
}

function vendaPossuiCupomNaoFiscal(venda) {
    if (Number(venda?.valor_nao_fiscal || 0) > 0) {
        return true;
    }

    if (vendaPossuiNfceAutorizada(venda)) {
        return false;
    }

    return Number(venda?.valor_fiscal || 0) === 0 && Number(venda?.total || 0) > 0;
}

function reimprimirCupomFiscalHistorico(vendaId) {
    imprimirDANFEFiscal(vendaId, { reimpressao: true });
}

async function reimprimirCupomNaoFiscalHistorico(vendaId) {
    if (!vendaId) return;

    try {
        const token = localStorage.getItem('token');
        const resp = await fetch(`${API_URL}/vendas/${vendaId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const venda = await resp.json();

        if (!resp.ok) {
            throw new Error(venda.error || 'Erro ao carregar venda.');
        }

        const empresa = await obterDadosEmpresaCupom();
        const itens = montarItensCupomNaoFiscal(venda);

        if (!itens.length) {
            if (typeof showNotification === 'function') {
                showNotification('Esta venda não possui itens para cupom não fiscal.', 'warning');
            }
            return;
        }

        await imprimirCupomNaoFiscal(
            vendaId,
            {
                ...venda,
                ...empresa,
                itens
            },
            obterTotalCupomNaoFiscal(venda),
            Number(venda.desconto || 0)
        );
    } catch (error) {
        console.error('Erro ao reimprimir cupom não fiscal:', error);
        if (typeof showNotification === 'function') {
            showNotification(error.message || 'Erro ao reimprimir cupom não fiscal.', 'danger');
        }
    }
}

window.resolverImpressoraDoCaixa = resolverImpressoraDoCaixa;
window.obterDeviceNameImpressoraCupom = obterDeviceNameImpressoraCupom;
window.imprimirDANFEFiscal = imprimirDANFEFiscal;
window.imprimirCupomNaoFiscal = imprimirCupomNaoFiscal;
window.vendaPossuiNfceAutorizada = vendaPossuiNfceAutorizada;
window.vendaPossuiCupomNaoFiscal = vendaPossuiCupomNaoFiscal;
window.reimprimirCupomFiscalHistorico = reimprimirCupomFiscalHistorico;
window.reimprimirCupomNaoFiscalHistorico = reimprimirCupomNaoFiscalHistorico;
