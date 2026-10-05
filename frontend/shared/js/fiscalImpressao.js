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

function formatarHtmlItemCupom(item) {
    const nome = escapeHtmlCupom(item.produto_nome || item.nome || 'Produto');
    const subtotal = Number(item.subtotal || 0);

    if (itemVendaPorUnidadeCupom(item)) {
        const qtd = Math.round(Number(item.quantidade || 0));
        const preco = Number(item.preco_unitario || item.preco || 0);
        return `
${nome}
${qtd} UN
R$ ${preco.toFixed(2).replace('.', ',')}
Total
${subtotal.toFixed(2).replace('.', ',')}
`;
    }

    const qtd = Number(item.quantidade || 0);
    const preco = Number(item.preco_unitario || item.preco || 0);
    return `
${nome}
${qtd} x R$ ${preco.toFixed(2).replace('.', ',')} = R$ ${subtotal.toFixed(2).replace('.', ',')}
`;
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
    const colunas = papelMm === 58 ? 32 : 48;
    const linha = '-'.repeat(colunas);
    const cabecalhoItens = papelMm === 58
        ? 'Item         Qtd Vl.Unit Total'
        : 'Item                 Qtd Vl.Unit Total';
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
        ? `Valor entregue: R$ ${Number(valorEntregueExibir).toFixed(2).replace('.', ',')}
Troco: R$ ${troco.toFixed(2).replace('.', ',')}
`
        : '';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<style>
  @page { margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  pre.cupom-nao-fiscal {
    font-family: "Consolas", "Courier New", monospace;
    font-size: 10px;
    font-weight: 700;
    color: #000;
    background: #fff;
    width: ${colunas}ch;
    max-width: 100%;
    margin: 0 auto;
    padding: 1.5mm 0 2mm;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
</style>
</head>
<body class="cupom-nao-fiscal-${papelMm}">
<pre class="cupom-nao-fiscal">
        ${escapeHtmlCupom(venda.nome_empresa || (typeof BrandService !== 'undefined' ? BrandService.NOME : 'CDS Sistemas'))}
${escapeHtmlCupom(venda.endereco || '')}

COMPROVANTE NÃO FISCAL
Venda #${vendaId}
${dataHora}

${linha}
${cabecalhoItens}
${itensHtml}
${linha}
Total: R$ ${totalNum.toFixed(2).replace('.', ',')}
Desconto: R$ ${Number(desconto || 0).toFixed(2).replace('.', ',')}
Forma pag.: ${formaPagamentoTexto}
${linhasTroco}${clienteNome ? `Cliente: ${escapeHtmlCupom(clienteNome)}` : ''}
${linha}
ESTE COMPROVANTE NÃO POSSUI VALOR FISCAL
OBRIGADO PELA PREFERÊNCIA!
VOLTE SEMPRE.
</pre>
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
            htmlTermico = pacote.htmlTermico || pacote.html || '';
        } else {
            htmlDanfe = await resposta.text();
            htmlTermico = htmlDanfe;
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

        const automatico = !!(opcoes && opcoes.automatico);
        const reimpressao = !!(opcoes && opcoes.reimpressao) || (!automatico && deveEnviarCupomParaImpressora(opcoes));
        const htmlCupom = htmlTermico || htmlDanfe;
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
