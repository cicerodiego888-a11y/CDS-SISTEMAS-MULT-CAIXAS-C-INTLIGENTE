/**
 * RC4.31.11 — Tratamento fiscal por item (frontend, espelho do backend).
 */
(function (global) {
    'use strict';

    const TIPOS = Object.freeze({
        REVENDA: 'REVENDA',
        INDUSTRIALIZACAO: 'INDUSTRIALIZACAO',
        USO_CONSUMO: 'USO_CONSUMO',
        BONIFICACAO: 'BONIFICACAO'
    });

    const CFOP_BONIFICACAO = new Set(['910', '949']);
    const CFOP_USO_CONSUMO = new Set(['551', '552', '553', '556', '557']);
    const CFOP_INDUSTRIALIZACAO = new Set(['101', '111', '113', '116', '117', '118', '124', '125']);
    const CFOP_REVENDA = new Set(['102', '103', '403', '407', '408', '409', '411']);

    function digitsOnly(v) {
        return String(v || '').replace(/\D/g, '');
    }

    function normalizarTipoEntrada(valor) {
        const raw = String(valor || '').trim().toUpperCase();
        if (raw === TIPOS.INDUSTRIALIZACAO) return TIPOS.INDUSTRIALIZACAO;
        if (raw === TIPOS.USO_CONSUMO || raw === 'USO E CONSUMO') return TIPOS.USO_CONSUMO;
        if (raw === TIPOS.BONIFICACAO || raw === 'BONIFICAÇÃO') return TIPOS.BONIFICACAO;
        return TIPOS.REVENDA;
    }

    function isCfopBonificacao(cfop) {
        const d = digitsOnly(cfop);
        return d.length === 4 && CFOP_BONIFICACAO.has(d.slice(1));
    }

    function classificarPorCfopItem(cfop) {
        const digitos = digitsOnly(cfop);
        if (digitos.length !== 4) return null;
        const sufixo = digitos.slice(1);
        if (CFOP_BONIFICACAO.has(sufixo)) {
            return { tipo: TIPOS.BONIFICACAO, motivo: `CFOP ${digitos} — bonificação/brinde.` };
        }
        if (CFOP_USO_CONSUMO.has(sufixo)) {
            return { tipo: TIPOS.USO_CONSUMO, motivo: `CFOP ${digitos} — uso/consumo.` };
        }
        if (CFOP_INDUSTRIALIZACAO.has(sufixo)) {
            return { tipo: TIPOS.INDUSTRIALIZACAO, motivo: `CFOP ${digitos} — industrialização.` };
        }
        if (CFOP_REVENDA.has(sufixo) || sufixo === '102' || sufixo === '403') {
            return { tipo: TIPOS.REVENDA, motivo: `CFOP ${digitos} — revenda.` };
        }
        if (digitos[0] === '1' || digitos[0] === '2') {
            return { tipo: TIPOS.REVENDA, motivo: `CFOP ${digitos} — entrada padrão.` };
        }
        return null;
    }

    function classificarTratamentoFiscalItem(item, tipoEntradaCompra) {
        const cfop = digitsOnly(item?.cfop || '').slice(0, 4) || null;
        const tipoManual = item?.tipo_fiscal_manual ? (item?.tipo_fiscal_item || null) : null;
        if (tipoManual) {
            const tipo = normalizarTipoEntrada(tipoManual);
            return {
                tipoFiscal: tipo,
                bonificacao: tipo === TIPOS.BONIFICACAO || Number(item?.bonificacao) === 1,
                cfop,
                tooltip: `Tratamento manual: ${tipo}.`
            };
        }
        if (Number(item?.bonificacao) === 1) {
            return { tipoFiscal: TIPOS.BONIFICACAO, bonificacao: true, cfop, tooltip: 'Item marcado como bonificação.' };
        }
        if (cfop) {
            const porCfop = classificarPorCfopItem(cfop);
            if (porCfop) {
                return {
                    tipoFiscal: porCfop.tipo,
                    bonificacao: porCfop.tipo === TIPOS.BONIFICACAO,
                    cfop,
                    tooltip: porCfop.motivo
                };
            }
        }
        if (tipoEntradaCompra) {
            const tipo = normalizarTipoEntrada(tipoEntradaCompra);
            return {
                tipoFiscal: tipo,
                bonificacao: tipo === TIPOS.BONIFICACAO,
                cfop,
                tooltip: `Padrão da compra: ${tipo}.`
            };
        }
        return { tipoFiscal: TIPOS.REVENDA, bonificacao: false, cfop, tooltip: 'Revenda (padrão).' };
    }

    function enriquecerItemFiscalCompra(item, opcoes = {}) {
        const base = { ...(item || {}) };
        const cfop = digitsOnly(base.cfop || '').slice(0, 4);
        if (cfop) base.cfop = cfop;
        const c = classificarTratamentoFiscalItem(base, opcoes.tipoEntradaCompra);
        base.tipo_fiscal_item = c.tipoFiscal;
        base.bonificacao = c.bonificacao ? 1 : 0;
        base._tooltip_fiscal = c.tooltip;
        if (!base.cfop && c.tipoFiscal === TIPOS.BONIFICACAO && opcoes.configBonificacao?.cfop_padrao) {
            base.cfop = opcoes.configBonificacao.cfop_padrao;
        }
        return base;
    }

    function rotuloTipoFiscalItem(tipo) {
        const map = {
            REVENDA: 'Revenda',
            INDUSTRIALIZACAO: 'Industrialização',
            USO_CONSUMO: 'Uso/Consumo',
            BONIFICACAO: 'Bonificação'
        };
        return map[normalizarTipoEntrada(tipo)] || map.REVENDA;
    }

    global.TratamentoFiscalItemCompra = Object.freeze({
        TIPOS,
        isCfopBonificacao,
        classificarPorCfopItem,
        classificarTratamentoFiscalItem,
        enriquecerItemFiscalCompra,
        rotuloTipoFiscalItem,
        normalizarTipoEntrada
    });
}(typeof window !== 'undefined' ? window : global));
