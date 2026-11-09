(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.TerminalContextBootstrap = api;
    }
})(typeof window !== 'undefined' ? window : globalThis, function () {
    const DEFAULT_TIMEOUT_MS = 10000;

    function criarErro(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }

    function normalizarId(valor) {
        if (valor === null || valor === undefined || valor === '') return null;
        const id = Number(valor);
        return Number.isInteger(id) && id > 0 ? id : null;
    }

    function comTimeout(promise, timeoutMs, code, message) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(criarErro(code, message));
            }, timeoutMs);

            Promise.resolve(promise).then(
                (value) => {
                    clearTimeout(timer);
                    resolve(value);
                },
                (error) => {
                    clearTimeout(timer);
                    reject(error);
                }
            );
        });
    }

    function criarInicializador(opcoes = {}) {
        if (typeof opcoes.resolverHostname !== 'function') {
            throw new TypeError('resolverHostname deve ser uma função.');
        }
        if (typeof opcoes.registrarTerminal !== 'function') {
            throw new TypeError('registrarTerminal deve ser uma função.');
        }

        const timeoutMs = Number.isFinite(opcoes.timeoutMs) && opcoes.timeoutMs > 0
            ? opcoes.timeoutMs
            : DEFAULT_TIMEOUT_MS;
        let registroEmAndamento = null;

        function inicializar() {
            if (registroEmAndamento) return registroEmAndamento;

            const tentativa = Promise.resolve().then(async () => {
                const hostnameResolvido = await comTimeout(
                    Promise.resolve().then(() => opcoes.resolverHostname()),
                    timeoutMs,
                    'TERMINAL_HOSTNAME_TIMEOUT',
                    'Tempo excedido ao identificar o hostname do terminal.'
                );
                const hostname = String(hostnameResolvido || '').trim();
                if (!hostname) {
                    throw criarErro(
                        'TERMINAL_HOSTNAME_INDISPONIVEL',
                        'O hostname do terminal não está disponível.'
                    );
                }

                const terminal = await comTimeout(
                    Promise.resolve().then(() => opcoes.registrarTerminal(hostname)),
                    timeoutMs,
                    'TERMINAL_REGISTRO_TIMEOUT',
                    'Tempo excedido ao registrar o terminal no backend.'
                );
                const terminalId = normalizarId(terminal && terminal.id);
                if (!terminalId) {
                    throw criarErro(
                        'TERMINAL_NAO_REGISTRADO',
                        'O backend não confirmou um terminal válido.'
                    );
                }

                const contexto = {
                    hostname,
                    terminal,
                    terminalId,
                    caixaId: normalizarId(terminal.caixa_id)
                };
                if (typeof opcoes.aplicarContexto === 'function') {
                    await opcoes.aplicarContexto(contexto);
                }
                return { ok: true, ...contexto };
            });

            registroEmAndamento = tentativa.finally(() => {
                registroEmAndamento = null;
            });
            return registroEmAndamento;
        }

        return { inicializar };
    }

    return {
        DEFAULT_TIMEOUT_MS,
        criarInicializador,
        normalizarId
    };
});
