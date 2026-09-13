/**
 * RCM-ATACADO-02 — Motor de precisão decimal (espelho browser).
 */
(function (global) {
    'use strict';

    const CASAS_INTERNAS = 6;

    function arredondarInterno(valor, casas) {
        const c = casas == null ? CASAS_INTERNAS : casas;
        const n = Number(valor || 0);
        if (!Number.isFinite(n)) return 0;
        const f = 10 ** c;
        return Math.round(n * f) / f;
    }

    function arredondarMoeda(valor) {
        return arredondarInterno(valor, 2);
    }

    function formatarPrecoExibicao(precoInterno) {
        return arredondarMoeda(precoInterno);
    }

    function calcularLinhaDescontoPercentual(params) {
        const preco = arredondarInterno(params.precoOriginal);
        const qtd = arredondarInterno(params.quantidade, 3);
        const pct = arredondarInterno(params.percentualDesconto, 4);
        const subtotalBruto = arredondarInterno(preco * qtd);
        const valorDesconto = arredondarInterno(subtotalBruto * (pct / 100));
        const totalInterno = arredondarInterno(subtotalBruto - valorDesconto);
        const precoUnitarioInterno = qtd > 0 ? arredondarInterno(totalInterno / qtd) : preco;
        return {
            precoOriginal: preco,
            quantidade: qtd,
            percentualDesconto: pct,
            subtotalBruto,
            valorDesconto,
            totalInterno,
            total: arredondarMoeda(totalInterno),
            precoUnitarioInterno,
            precoUnitarioExibicao: formatarPrecoExibicao(precoUnitarioInterno)
        };
    }

    function calcularLinhaDescontoValor(params) {
        const preco = arredondarInterno(params.precoOriginal);
        const qtd = arredondarInterno(params.quantidade, 3);
        const subtotalBruto = arredondarInterno(preco * qtd);
        const desc = Math.min(
            Math.max(0, arredondarInterno(params.valorDesconto)),
            subtotalBruto
        );
        const pct = subtotalBruto > 0
            ? arredondarInterno((desc / subtotalBruto) * 100, 4)
            : 0;
        return calcularLinhaDescontoPercentual({
            precoOriginal: preco,
            quantidade: qtd,
            percentualDesconto: pct
        });
    }

    function calcularLinhaPrecoUnitarioInformado(params) {
        const preco = arredondarInterno(params.precoOriginal);
        const qtd = arredondarInterno(params.quantidade, 3);
        const precoInformado = arredondarInterno(params.precoUnitarioInformado);
        const subtotalBruto = arredondarInterno(preco * qtd);
        const totalInterno = arredondarInterno(precoInformado * qtd);
        const pct = preco > 0 ? arredondarInterno((1 - precoInformado / preco) * 100, 4) : 0;
        return {
            precoOriginal: preco,
            quantidade: qtd,
            percentualDesconto: pct,
            subtotalBruto,
            valorDesconto: arredondarInterno(subtotalBruto - totalInterno),
            totalInterno,
            total: arredondarMoeda(totalInterno),
            precoUnitarioInterno: precoInformado,
            precoUnitarioExibicao: formatarPrecoExibicao(precoInformado)
        };
    }

    function calcularLinhaAtacadoFaixa(params) {
        const precoBase = arredondarInterno(params.precoVenda);
        const precoAtac = arredondarInterno(params.precoAtacado);
        const qtd = arredondarInterno(params.quantidade, 3);
        if (precoAtac <= 0 || precoAtac >= precoBase) {
            const linha = calcularLinhaPrecoUnitarioInformado({
                precoOriginal: precoBase,
                quantidade: qtd,
                precoUnitarioInformado: precoBase
            });
            return Object.assign({}, linha, { descontoAtacado: 0, isAtacado: false });
        }
        const linha = calcularLinhaPrecoUnitarioInformado({
            precoOriginal: precoBase,
            quantidade: qtd,
            precoUnitarioInformado: precoAtac
        });
        return Object.assign({}, linha, {
            descontoAtacado: arredondarMoeda(arredondarInterno((precoBase - precoAtac) * qtd)),
            isAtacado: true
        });
    }

    function calcularSubtotalItem(params) {
        const preco = arredondarInterno(params.precoUnitarioInterno);
        const qtd = arredondarInterno(params.quantidade, 3);
        const totalInterno = arredondarInterno(preco * qtd);
        return { totalInterno, total: arredondarMoeda(totalInterno) };
    }

    global.MotorPrecoAtacado = Object.freeze({
        CASAS_INTERNAS,
        arredondarInterno,
        arredondarMoeda,
        formatarPrecoExibicao,
        calcularLinhaDescontoPercentual,
        calcularLinhaDescontoValor,
        calcularLinhaPrecoUnitarioInformado,
        calcularLinhaAtacadoFaixa,
        calcularSubtotalItem
    });
}(typeof window !== 'undefined' ? window : global));
