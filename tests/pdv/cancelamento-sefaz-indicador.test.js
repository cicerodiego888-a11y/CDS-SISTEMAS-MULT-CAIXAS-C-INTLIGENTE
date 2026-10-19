'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');

class ElementFake {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.attributes = {};
        this.className = '';
        this.classList = { add: () => {} };
        this.hidden = false;
        this.textContent = '';
        this.innerHTML = '';
        this.disabled = false;
        this.parentNode = null;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    setAttribute(name, value) {
        this.attributes[name] = value;
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
    }

    querySelector(className) {
        const name = className.replace('.', '');
        return this.children.find((child) => child.className.split(' ').includes(name)) || null;
    }
}

const documentFake = {
    body: new ElementFake('body'),
    createElement: (tag) => new ElementFake(tag)
};
global.document = documentFake;

const ui = require('../../frontend/pdv/js/cancelamentoSefazUi');
const vendasSource = fs.readFileSync(
    path.join(__dirname, '../../frontend/pdv/js/vendas.js'),
    'utf8'
);

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function indicadorAtual() {
    return documentFake.body.children.find((child) =>
        child.className.includes('pdv-cancelamento-sefaz-overlay')
    );
}

describe('PDV — indicador de cancelamento NFC-e', () => {
    it('exibe indicador imediatamente com título e instrução esperados', async () => {
        const pendente = deferred();
        const button = new ElementFake('button');
        button.innerHTML = 'Cancelar';

        const operacao = ui.executar(201, button, () => pendente.promise);
        const overlay = indicadorAtual();

        assert.ok(overlay);
        assert.equal(overlay.attributes.role, 'status');
        assert.equal(overlay.children[0].children[1].textContent, 'Consultando a SEFAZ…');
        assert.equal(
            overlay.children[0].children[2].textContent,
            'Aguardando resposta da SEFAZ. Não feche esta tela nem repita a operação.'
        );
        assert.equal(button.disabled, true);
        pendente.resolve({ sucesso: true });
        await operacao;
        assert.equal(indicadorAtual(), undefined);
        assert.equal(button.disabled, false);
        assert.equal(button.innerHTML, 'Cancelar');
    });

    it('remove o indicador após sucesso tratado ou erro tratado', async () => {
        await ui.executar(202, null, async () => ({ sucesso: true }));
        assert.equal(indicadorAtual(), undefined);

        await assert.rejects(
            ui.executar(203, null, async () => { throw new Error('erro tratado'); }),
            /erro tratado/
        );
        assert.equal(indicadorAtual(), undefined);
    });

    it('em timeout mantém a camada com mensagem indeterminada até o fim da requisição', async () => {
        const pendente = deferred();
        const operacao = ui.executar(204, null, () => pendente.promise, 10);

        await new Promise((resolve) => setTimeout(resolve, 25));
        const overlay = indicadorAtual();
        assert.ok(overlay);
        assert.equal(
            overlay.children[0].children[1].textContent,
            ui.mensagemIndeterminada
        );
        assert.equal(overlay.children[0].children[0].hidden, true);

        pendente.resolve({ sucesso: false });
        await operacao;
        assert.equal(indicadorAtual(), undefined);
    });

    it('bloqueia duplo clique da mesma venda sem bloquear outra venda', async () => {
        const pendente = deferred();
        let chamadas = 0;
        const botao = new ElementFake('button');
        const primeira = ui.executar(205, botao, () => {
            chamadas += 1;
            return pendente.promise;
        });
        const duplicada = await ui.executar(205, new ElementFake('button'), async () => {
            chamadas += 1;
        });
        assert.deepEqual(duplicada, { duplicada: true });
        assert.equal(chamadas, 1);

        const outra = await ui.executar(206, null, async () => 'ok');
        assert.equal(outra, 'ok');
        pendente.resolve('ok');
        await primeira;
        assert.equal(chamadas, 1);
    });

    it('não aceita rejeição ou resultado desconhecido como sucesso fiscal', async () => {
        const sucesso = await ui.obterResultado({
            ok: true,
            status: 200,
            json: async () => ({ sucesso: true })
        });
        assert.equal(sucesso.sucesso, true);

        await assert.rejects(
            ui.obterResultado({
                ok: false,
                status: 409,
                json: async () => ({
                    sucesso: false,
                    code: 'RESULTADO_DESCONHECIDO',
                    status: 'cancelamento_desconhecido'
                })
            }),
            (error) => {
                assert.equal(error.message, ui.mensagemIndeterminada);
                assert.equal(ui.mensagemErro(error), ui.mensagemIndeterminada);
                return true;
            }
        );
        await assert.rejects(
            ui.obterResultado({
                ok: true,
                status: 200,
                json: async () => ({
                    sucesso: true,
                    status: 'cancelamento_desconhecido'
                })
            }),
            (error) => error.message === ui.mensagemIndeterminada
        );
        await assert.rejects(
            ui.obterResultado({
                ok: true,
                status: 200,
                json: async () => { throw new SyntaxError('invalid JSON'); }
            }),
            (error) => error.message === ui.mensagemIndeterminada
        );
        assert.equal(
            ui.mensagemErro(new TypeError('fetch failed')),
            ui.mensagemIndeterminada
        );
        assert.match(vendasSource, /const dados = await PdvCancelamentoSefazUi\.obterResultado\(resposta\)/);
        assert.match(vendasSource, /showNotification\('Venda cancelada com sucesso\.'/);
        assert.match(vendasSource, /showNotification\(PdvCancelamentoSefazUi\.mensagemErro\(error\)/);
    });
});
