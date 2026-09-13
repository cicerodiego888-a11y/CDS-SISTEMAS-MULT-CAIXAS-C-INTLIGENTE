/**
 * RC4.31.19 — Função canônica comercial × convertida (espelho de backend/lib/motorConversaoUnidades.js)
 */
(function (global) {
    'use strict';

    function obterQuantidadeComercial(item = {}) {
        const explicita = Number(item.quantidade_comercial);
        if (Number.isFinite(explicita) && explicita > 0) return explicita;

        const emb = Number(item.quantidade_embalagens || 0);
        if (emb > 0) return emb;

        const convertida = Number(item.quantidade_convertida || 0);
        const fator = Number(item.quantidade_por_embalagem || 0);
        if (convertida > 0 && fator <= 0) return convertida;

        return Number(item.quantidade || 0);
    }

    function obterQuantidadeConvertida(item = {}) {
        const convertidaExplicita = Number(item.quantidade_convertida || 0);
        if (convertidaExplicita > 0) return convertidaExplicita;

        const qtdEmb = Number(item.quantidade_embalagens || 0);
        const qtdPorEmb = Number(item.quantidade_por_embalagem || 0);
        const comercial = obterQuantidadeComercial(item);

        if (qtdPorEmb > 0) {
            const baseEmb = qtdEmb > 0 ? qtdEmb : comercial;
            if (baseEmb > 0) return baseEmb * qtdPorEmb;
        }

        const peso = Number(item.peso_total_compra || 0);
        if (peso > 0) {
            if (qtdPorEmb <= 0 || Math.abs(peso - comercial) > 0.001) return peso;
            if (comercial > 0 && qtdPorEmb > 0) return comercial * qtdPorEmb;
        }

        return comercial > 0 ? comercial : Number(item.quantidade || 0);
    }

    global.obterQuantidadeComercial = obterQuantidadeComercial;
    global.obterQuantidadeConvertida = obterQuantidadeConvertida;
}(typeof window !== 'undefined' ? window : global));
