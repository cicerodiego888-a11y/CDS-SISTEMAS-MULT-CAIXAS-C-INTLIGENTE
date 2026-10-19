(function (root) {
    'use strict';

    const operacoesAtivas = new Map();
    const MENSAGEM_INDETERMINADA =
        'Não foi possível confirmar o resultado do cancelamento. Consulte a situação da NFC-e antes de tentar novamente.';

    function criarIndicador() {
        const overlay = document.createElement('div');
        overlay.className = 'pdv-cancelamento-sefaz-overlay';
        overlay.setAttribute('role', 'status');
        overlay.setAttribute('aria-live', 'assertive');

        const card = document.createElement('div');
        card.className = 'pdv-cancelamento-sefaz-card';

        const spinner = document.createElement('span');
        spinner.className = 'spinner-border text-primary';
        spinner.setAttribute('aria-hidden', 'true');

        const titulo = document.createElement('strong');
        titulo.className = 'pdv-cancelamento-sefaz-titulo';
        titulo.textContent = 'Consultando a SEFAZ…';

        const mensagem = document.createElement('span');
        mensagem.className = 'pdv-cancelamento-sefaz-mensagem';
        mensagem.textContent =
            'Aguardando resposta da SEFAZ. Não feche esta tela nem repita a operação.';

        card.appendChild(spinner);
        card.appendChild(titulo);
        card.appendChild(mensagem);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        return {
            overlay,
            definirEtapa(texto) {
                titulo.textContent = texto;
                spinner.hidden = false;
                mensagem.textContent =
                    'Aguardando resposta da SEFAZ. Não feche esta tela nem repita a operação.';
            },
            sinalizarIndeterminado() {
                spinner.hidden = true;
                titulo.textContent = MENSAGEM_INDETERMINADA;
                mensagem.textContent =
                    'A requisição continua em andamento. Não repita a operação.';
                card.classList.add('pdv-cancelamento-sefaz-indeterminado');
            }
        };
    }

    async function executar(vendaId, botao, operacao, timeoutMs = 120000) {
        const chave = String(vendaId);
        if (operacoesAtivas.has(chave)) return { duplicada: true };

        const indicador = criarIndicador();
        const htmlOriginal = botao ? botao.innerHTML : null;
        const disabledOriginal = botao ? botao.disabled : false;
        if (botao) botao.disabled = true;

        const estado = { indicador };
        operacoesAtivas.set(chave, estado);
        const timer = setTimeout(() => indicador.sinalizarIndeterminado(), timeoutMs);

        try {
            return await operacao({
                atualizarTitulo: indicador.definirEtapa
            });
        } finally {
            clearTimeout(timer);
            indicador.overlay.remove();
            operacoesAtivas.delete(chave);
            if (botao) {
                botao.disabled = disabledOriginal;
                botao.innerHTML = htmlOriginal;
            }
        }
    }

    async function obterResultado(resposta) {
        let dados;
        try {
            dados = await resposta.json();
        } catch {
            const erro = new Error(MENSAGEM_INDETERMINADA);
            erro.resultadoIndeterminado = true;
            throw erro;
        }
        const indeterminado = resposta.status === 504
            || dados.resultadoIndeterminado === true
            || dados.code === 'RESULTADO_DESCONHECIDO'
            || dados.code === 'PERSISTENCIA_CANCELAMENTO_INDETERMINADA'
            || dados.code === 'PENDENCIA_DOCUMENTAL_CSTAT_136'
            || dados.status === 'indeterminado'
            || dados.status === 'cancelamento_desconhecido'
            || dados.status === 'cancelamento_em_andamento';

        if (indeterminado || !resposta.ok || !dados.sucesso) {
            const erro = new Error(indeterminado
                ? MENSAGEM_INDETERMINADA
                : (dados.mensagem || dados.error || `Erro ao cancelar venda (HTTP ${resposta.status}).`));
            erro.resultadoIndeterminado = indeterminado;
            throw erro;
        }

        return dados;
    }

    function mensagemErro(error) {
        if (error?.resultadoIndeterminado
            || error?.name === 'AbortError'
            || error?.name === 'TimeoutError'
            || /timeout|timed out|networkerror|failed to fetch|fetch failed/i.test(String(error?.message || ''))) {
            return MENSAGEM_INDETERMINADA;
        }
        return error?.message || 'Erro ao cancelar venda.';
    }

    const api = Object.freeze({
        executar,
        obterResultado,
        mensagemErro,
        mensagemIndeterminada: MENSAGEM_INDETERMINADA
    });

    root.PdvCancelamentoSefazUi = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
}(typeof window !== 'undefined' ? window : globalThis));
