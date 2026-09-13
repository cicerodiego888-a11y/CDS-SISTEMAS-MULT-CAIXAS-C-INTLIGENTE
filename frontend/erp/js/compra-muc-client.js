/**
 * RC4.31.12 — Cliente HTTP para simulação MUC na compra manual.
 * Toda conversão de quantidade/custo passa pelo Motor Universal de Comercialização.
 */
(function (global) {
    'use strict';

    async function simularConversao(payload = {}) {
        const resp = await fetch(`${API_URL}/compras/simular-conversao-muc`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`
            },
            body: JSON.stringify(payload)
        });
        const json = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            throw new Error(json.error || 'Falha na simulação MUC');
        }
        return json.resultado || null;
    }

    global.CompraMucClient = Object.freeze({ simularConversao });
}(typeof window !== 'undefined' ? window : global));
