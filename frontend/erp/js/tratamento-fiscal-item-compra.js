/**
 * RC4.31.11 — Tratamento fiscal por item (frontend, espelho do backend).
 * Regras de CFOP idênticas a backend/services/compras/ClassificadorEntradaCompra.js (interpretarCfop)
 * e precedência idêntica a backend/services/compras/TratamentoFiscalItemCompra.js.
 */
(function (global) {
    'use strict';

    const TIPOS = Object.freeze({
        REVENDA: 'REVENDA',
        INDUSTRIALIZACAO: 'INDUSTRIALIZACAO',
        USO_CONSUMO: 'USO_CONSUMO',
        BONIFICACAO: 'BONIFICACAO'
    });

    const DIRECAO = Object.freeze({ ENTRADA: 'ENTRADA', SAIDA: 'SAIDA', INDETERMINADA: 'INDETERMINADA' });

    /** ESPECIFICA: sempre se aplica ao item. COMPRA: só sem cabeçalho ou com cabeçalho Bonificação. */
    const EXCECAO_ITEM = Object.freeze({ ESPECIFICA: 'ESPECIFICA', COMPRA: 'COMPRA' });

    /** CFOP de entrada (1/2/3) — sufixos (últimos 3 dígitos). */
    const CFOP_BONIFICACAO = new Set(['910', '949']);
    const CFOP_USO_CONSUMO = new Set(['551', '552', '553', '556', '557']);
    const CFOP_INDUSTRIALIZACAO = new Set(['101', '111', '113', '116', '117', '118', '124', '125']);
    const CFOP_REVENDA = new Set(['102', '103', '403', '407', '408', '409']);
    const CFOP_ENTRADA_DEVOLUCAO = new Set(['201', '202', '203', '204', '208', '209', '410', '411']);

    /** CFOP de saída do emitente (5/6/7). */
    const CFOP_SAIDA_BONIFICACAO = new Set(['910']);
    const CFOP_SAIDA_OUTRAS_NAO_ESPECIFICADAS = new Set(['949']);
    const CFOP_SAIDA_TRANSFERENCIA_USO_CONSUMO = new Set(['552', '557']);
    const CFOP_SAIDA_VENDA_ATIVO = new Set(['551']);
    const CFOP_SAIDA_REMESSA_INDUSTRIALIZACAO = new Set(['901']);
    const CFOP_SAIDA_DEVOLUCAO = new Set(['201', '202', '208', '209', '210', '410', '411', '412', '413', '553', '556']);

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

    function interpretacao(cfop, direcao, tipo, excecaoItem, motivo) {
        return { cfop, direcao, tipo, excecaoItem, motivo };
    }

    function interpretarCfopEntrada(d, sufixo) {
        const E = DIRECAO.ENTRADA;
        const X = EXCECAO_ITEM;
        if (CFOP_BONIFICACAO.has(sufixo)) return interpretacao(d, E, TIPOS.BONIFICACAO, X.ESPECIFICA, `CFOP ${d} — bonificação/brinde.`);
        if (CFOP_USO_CONSUMO.has(sufixo)) return interpretacao(d, E, TIPOS.USO_CONSUMO, X.ESPECIFICA, `CFOP ${d} — uso/consumo.`);
        if (CFOP_ENTRADA_DEVOLUCAO.has(sufixo)) return interpretacao(d, E, null, null, `CFOP ${d} — devolução recebida.`);
        if (CFOP_INDUSTRIALIZACAO.has(sufixo)) return interpretacao(d, E, TIPOS.INDUSTRIALIZACAO, X.COMPRA, `CFOP ${d} — compra para industrialização.`);
        if (CFOP_REVENDA.has(sufixo)) return interpretacao(d, E, TIPOS.REVENDA, X.COMPRA, `CFOP ${d} — compra para comercialização.`);
        if (d[0] === '1' || d[0] === '2') return interpretacao(d, E, TIPOS.REVENDA, null, `CFOP ${d} — entrada padrão.`);
        return interpretacao(d, E, null, null, `CFOP ${d} — não define a finalidade.`);
    }

    function interpretarCfopSaida(d, sufixo) {
        const S = DIRECAO.SAIDA;
        const X = EXCECAO_ITEM;
        if (CFOP_SAIDA_BONIFICACAO.has(sufixo)) return interpretacao(d, S, TIPOS.BONIFICACAO, X.ESPECIFICA, `CFOP ${d} — bonificação/brinde do emitente.`);
        if (CFOP_SAIDA_DEVOLUCAO.has(sufixo)) return interpretacao(d, S, null, null, `CFOP ${d} — devolução do emitente.`);
        if (CFOP_SAIDA_TRANSFERENCIA_USO_CONSUMO.has(sufixo)) return interpretacao(d, S, TIPOS.USO_CONSUMO, X.ESPECIFICA, `CFOP ${d} — transferência de uso/consumo.`);
        if (CFOP_SAIDA_REMESSA_INDUSTRIALIZACAO.has(sufixo)) return interpretacao(d, S, TIPOS.INDUSTRIALIZACAO, null, `CFOP ${d} — remessa para industrialização.`);
        if (CFOP_SAIDA_OUTRAS_NAO_ESPECIFICADAS.has(sufixo)) return interpretacao(d, S, TIPOS.BONIFICACAO, null, `CFOP ${d} — outra saída não especificada.`);
        if (CFOP_SAIDA_VENDA_ATIVO.has(sufixo)) return interpretacao(d, S, TIPOS.USO_CONSUMO, null, `CFOP ${d} — venda de bem do ativo.`);
        return interpretacao(d, S, null, null, `CFOP ${d} do emitente — não define a finalidade.`);
    }

    function interpretarCfop(cfop) {
        const d = digitsOnly(cfop);
        if (d.length !== 4) return interpretacao(d || null, DIRECAO.INDETERMINADA, null, null, null);
        const sufixo = d.slice(1);
        if ('123'.includes(d[0])) return interpretarCfopEntrada(d, sufixo);
        if ('567'.includes(d[0])) return interpretarCfopSaida(d, sufixo);
        return interpretacao(d, DIRECAO.INDETERMINADA, null, null, null);
    }

    function classificarPorCfopItem(cfop) {
        const i = interpretarCfop(cfop);
        if (!i.tipo) return null;
        return { tipo: i.tipo, motivo: i.motivo, direcao: i.direcao, excecaoItem: i.excecaoItem };
    }

    function classificarTratamentoFiscalItem(item, tipoEntradaCompra) {
        const cfop = digitsOnly(item?.cfop || '').slice(0, 4) || null;
        const tipoManual = item?.tipo_fiscal_manual ? (item?.tipo_fiscal_item || null) : null;
        const tipoCompra = tipoEntradaCompra ? normalizarTipoEntrada(tipoEntradaCompra) : null;
        if (tipoManual) {
            const tipo = normalizarTipoEntrada(tipoManual);
            return {
                tipoFiscal: tipo,
                bonificacao: tipo === TIPOS.BONIFICACAO || Number(item?.bonificacao) === 1,
                cfop,
                conflitoCabecalho: false,
                tooltip: `Tratamento manual: ${tipo}.`
            };
        }
        if (Number(item?.bonificacao) === 1) {
            return { tipoFiscal: TIPOS.BONIFICACAO, bonificacao: true, cfop, conflitoCabecalho: false, tooltip: 'Item marcado como bonificação.' };
        }
        const porCfop = cfop ? classificarPorCfopItem(cfop) : null;
        const excecaoAplica = porCfop?.excecaoItem === EXCECAO_ITEM.ESPECIFICA
            || (porCfop?.excecaoItem === EXCECAO_ITEM.COMPRA && (!tipoCompra || tipoCompra === TIPOS.BONIFICACAO));
        if (excecaoAplica) {
            const conflito = Boolean(tipoCompra && tipoCompra !== porCfop.tipo);
            return {
                tipoFiscal: porCfop.tipo,
                bonificacao: porCfop.tipo === TIPOS.BONIFICACAO,
                cfop,
                conflitoCabecalho: conflito,
                tooltip: conflito
                    ? `${porCfop.motivo} Exceção do item: difere da natureza da entrada (${rotuloTipoFiscalItem(tipoCompra)}).`
                    : porCfop.motivo
            };
        }
        if (tipoCompra) {
            const conflito = Boolean(porCfop?.excecaoItem && porCfop.tipo !== tipoCompra);
            return {
                tipoFiscal: tipoCompra,
                bonificacao: tipoCompra === TIPOS.BONIFICACAO,
                cfop,
                conflitoCabecalho: conflito,
                tooltip: conflito
                    ? `${porCfop.motivo} Mantida a natureza confirmada da entrada (${rotuloTipoFiscalItem(tipoCompra)}).`
                    : `Padrão da compra: ${tipoCompra}.`
            };
        }
        return { tipoFiscal: TIPOS.REVENDA, bonificacao: false, cfop, conflitoCabecalho: false, tooltip: 'Revenda (padrão).' };
    }

    function enriquecerItemFiscalCompra(item, opcoes = {}) {
        const base = { ...(item || {}) };
        const cfop = digitsOnly(base.cfop || '').slice(0, 4);
        if (cfop) base.cfop = cfop;
        const c = classificarTratamentoFiscalItem(base, opcoes.tipoEntradaCompra);
        base.tipo_fiscal_item = c.tipoFiscal;
        base.bonificacao = c.bonificacao ? 1 : 0;
        base._tooltip_fiscal = c.tooltip;
        base._conflito_fiscal_cabecalho = c.conflitoCabecalho;
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
        DIRECAO,
        EXCECAO_ITEM,
        isCfopBonificacao,
        interpretarCfop,
        classificarPorCfopItem,
        classificarTratamentoFiscalItem,
        enriquecerItemFiscalCompra,
        rotuloTipoFiscalItem,
        normalizarTipoEntrada
    });
}(typeof window !== 'undefined' ? window : global));
