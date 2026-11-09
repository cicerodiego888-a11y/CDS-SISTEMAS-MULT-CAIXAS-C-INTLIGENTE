'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const Bootstrap = require('../../frontend/pdv/js/terminalContextBootstrap');
const CaixaAtual = require('../../frontend/shared/js/obterCaixaAtual');
const CORE_JS = fs.readFileSync(path.join(ROOT, 'frontend/shared/js/core.js'), 'utf8');
const PDV_JS = fs.readFileSync(path.join(ROOT, 'frontend/pdv/js/pdv.js'), 'utf8');
const PDV_HTML = fs.readFileSync(path.join(ROOT, 'frontend/pdv/index.html'), 'utf8');
const JANELAS_JS = fs.readFileSync(path.join(ROOT, 'electron-janelas-modulo.js'), 'utf8');
const TERMINAIS_JS = fs.readFileSync(path.join(ROOT, 'backend/rotas/terminais.js'), 'utf8');
const PDV_ENTRY = fs.readFileSync(path.join(ROOT, 'electron-pdv.js'), 'utf8');
const ERP_ENTRY = fs.readFileSync(path.join(ROOT, 'electron-erp.js'), 'utf8');

function criarContextoInicializador(overrides = {}) {
    const opcoes = {
        resolverHostname: async () => 'CAIXA-TESTE',
        registrarTerminal: async () => ({ id: 17, caixa_id: 4 }),
        aplicarContexto: () => {},
        timeoutMs: 100,
        ...overrides
    };
    return Bootstrap.criarInicializador(opcoes);
}

function carregarRotasTerminais(db) {
    const router = new Proxy({}, {
        get: (target, key) => key in target ? target[key] : () => router
    });
    const mod = { exports: {} };
    const dependencias = {
        express: { Router: () => router },
        jsonwebtoken: { verify: () => ({}) },
        '../database': db,
        '../services/auditoria': { gravarAuditoria: async () => {} },
        '../config/secrets': { getJwtSecret: () => 'test-only-secret' }
    };
    const sandbox = {
        module: mod,
        exports: mod.exports,
        require: (nome) => {
            if (!dependencias[nome]) throw new Error(`Dependência não controlada no teste: ${nome}`);
            return dependencias[nome];
        },
        console: { error() {}, warn() {}, log() {}, info() {} }
    };
    vm.runInNewContext(TERMINAIS_JS, sandbox, { filename: 'terminais.js' });
    return mod.exports;
}

function criarResposta() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

describe('Bootstrap do contexto Terminal → Caixa', () => {
    it('aguarda o bootstrap antes do primeiro modo fiscal nos caminhos PDV', () => {
        const chamadaBootstrap = CORE_JS.indexOf(
            'await inicializarContextoTerminalAntesDoModoFiscal()'
        );
        const chamadaModoFiscal = CORE_JS.indexOf(
            'await carregarModoFiscalInicial()',
            chamadaBootstrap
        );

        assert.ok(chamadaBootstrap >= 0);
        assert.ok(chamadaModoFiscal > chamadaBootstrap);
        assert.match(CORE_JS, /if \(!moduloAtualEhPdvExpress\(\)\) return true;/);
        assert.match(CORE_JS, /if \(resultado && resultado\.ok === true\) return true;/);
        assert.match(CORE_JS, /if \(contextoTerminalPronto\) \{\s*await carregarModoFiscalInicial\(\);/);
        assert.match(PDV_HTML, /terminalContextBootstrap\.js[\s\S]*core\.js[\s\S]*pdv\.js/);
        assert.match(PDV_HTML, /window\.CDS_MODULE = 'pdv'/);
        assert.match(PDV_JS, /window\.inicializarContextoTerminalPdv = inicializarContextoTerminalPdv/);
        assert.match(PDV_ENTRY, /CDS_APP_MODULO = 'pdv'/);
        assert.match(ERP_ENTRY, /CDS_APP_MODULO = 'erp'/);
        assert.match(JANELAS_JS, /function abrirJanelaModuloApp[\s\S]*new BrowserWindow/);
    });

    it('aguarda registro em ambos os caminhos sem compartilhar contexto entre backends', async () => {
        const casos = [
            { caminho: 'pdv-independente', caixaId: 4 },
            { caminho: 'janela-pdv-no-erp', caixaId: 9 }
        ].map(({ caminho, caixaId }) => {
            const eventos = [];
            let concluirRegistro;
            let chamadas = 0;
            let iniciouRegistro;
            const registroIniciado = new Promise((resolve) => {
                iniciouRegistro = resolve;
            });
            const bootstrap = criarContextoInicializador({
                registrarTerminal: () => {
                    chamadas += 1;
                    eventos.push(`${caminho}:registro`);
                    iniciouRegistro();
                    return new Promise((resolve) => {
                        concluirRegistro = resolve;
                    });
                },
                aplicarContexto: () => eventos.push(`${caminho}:contexto`)
            });
            const primeira = bootstrap.inicializar();
            assert.strictEqual(primeira, bootstrap.inicializar());
            const primeiraConsulta = primeira.then((resultado) => {
                eventos.push(`${caminho}:primeira-consulta`);
                return resultado;
            });
            return {
                caminho,
                caixaId,
                eventos,
                concluirRegistro: (terminal) => concluirRegistro(terminal),
                registroIniciado,
                chamadas: () => chamadas,
                primeiraConsulta
            };
        });

        await Promise.all(casos.map((caso) => caso.registroIniciado));
        for (const caso of casos) {
            assert.equal(caso.chamadas(), 1);
            assert.deepEqual(caso.eventos, [`${caso.caminho}:registro`]);
        }

        casos[0].concluirRegistro({ id: 17, caixa_id: casos[0].caixaId });
        const primeiroResultado = await casos[0].primeiraConsulta;
        assert.equal(primeiroResultado.ok, true);
        assert.equal(primeiroResultado.caixaId, 4);
        assert.deepEqual(casos[0].eventos, [
            'pdv-independente:registro',
            'pdv-independente:contexto',
            'pdv-independente:primeira-consulta'
        ]);
        assert.deepEqual(casos[1].eventos, ['janela-pdv-no-erp:registro']);

        casos[1].concluirRegistro({ id: 17, caixa_id: casos[1].caixaId });
        const segundoResultado = await casos[1].primeiraConsulta;
        assert.equal(segundoResultado.ok, true);
        assert.equal(segundoResultado.caixaId, 9);
        assert.deepEqual(casos[1].eventos, [
            'janela-pdv-no-erp:registro',
            'janela-pdv-no-erp:contexto',
            'janela-pdv-no-erp:primeira-consulta'
        ]);
    });

    it('carrega o caixa persistido, não o ID do terminal', async () => {
        const bootstrap = criarContextoInicializador({
            registrarTerminal: async () => ({ id: 17, caixa_id: '4' })
        });
        const resultado = await bootstrap.inicializar();

        assert.equal(resultado.terminalId, 17);
        assert.equal(resultado.caixaId, 4);
        assert.deepEqual(
            CaixaAtual.resolverCaixaAtual({
                globals: { terminalId: resultado.terminalId, terminalCaixaId: resultado.caixaId }
            }),
            { ok: true, caixaId: 4, terminalId: 17, erro: null }
        );
    });

    it('não substitui caixa_id ausente pelo terminalId', async () => {
        const bootstrap = criarContextoInicializador({
            registrarTerminal: async () => ({ id: 17, caixa_id: null })
        });
        const resultado = await bootstrap.inicializar();

        assert.equal(resultado.ok, true);
        assert.equal(resultado.terminalId, 17);
        assert.equal(resultado.caixaId, null);
        assert.equal(
            CaixaAtual.resolverCaixaAtual({
                globals: { terminalId: resultado.terminalId, terminalCaixaId: resultado.caixaId }
            }).ok,
            false
        );
    });

    it('rejeita resposta sem terminal registrado', async () => {
        const bootstrap = criarContextoInicializador({
            registrarTerminal: async () => null
        });

        await assert.rejects(bootstrap.inicializar(), {
            code: 'TERMINAL_NAO_REGISTRADO'
        });
    });

    it('expõe falha de comunicação e timeout do backend', async () => {
        const falha = new Error('backend indisponível');
        falha.code = 'TERMINAL_REGISTRO_FALHOU';
        await assert.rejects(
            criarContextoInicializador({
                registrarTerminal: async () => { throw falha; }
            }).inicializar(),
            { code: 'TERMINAL_REGISTRO_FALHOU' }
        );

        await assert.rejects(
            criarContextoInicializador({
                registrarTerminal: () => new Promise(() => {}),
                timeoutMs: 5
            }).inicializar(),
            { code: 'TERMINAL_REGISTRO_TIMEOUT' }
        );
    });

    it('falha sem hostname em vez de consultar o backend com identidade inventada', async () => {
        let chamadasRegistro = 0;
        const bootstrap = criarContextoInicializador({
            resolverHostname: async () => null,
            registrarTerminal: async () => {
                chamadasRegistro += 1;
                return { id: 1, caixa_id: 1 };
            }
        });

        await assert.rejects(bootstrap.inicializar(), {
            code: 'TERMINAL_HOSTNAME_INDISPONIVEL'
        });
        assert.equal(chamadasRegistro, 0);
    });
});

describe('Registro automático de terminal no backend', () => {
    it('cria terminal sem atribuir caixa automaticamente', async () => {
        let terminal = null;
        let insertSql = '';
        let insertParams = null;
        const db = {
            get(sql, params, callback) {
                if (sql.includes('WHERE hostname = ?')) return callback(null, terminal);
                if (sql.includes('WHERE id = ?')) return callback(null, terminal);
                throw new Error(`Consulta inesperada: ${sql}`);
            },
            run(sql, params, callback) {
                insertSql = sql;
                insertParams = params;
                terminal = {
                    id: 31,
                    nome: params[0],
                    hostname: params[1],
                    caixa_id: null,
                    usuario_id: params[2],
                    usuario_nome: params[3]
                };
                callback.call({ lastID: 31 }, null);
            },
            all() {
                throw new Error('O registro automático não deve consultar nem inferir caixas.');
            }
        };
        const rotas = carregarRotasTerminais(db);
        const res = criarResposta();

        rotas.registrarTerminalAuto({
            query: { origem: 'pdv', hostname: 'PDV-TESTE' },
            headers: {},
            user: {}
        }, res);

        assert.match(insertSql, /VALUES\s*\(\?,\s*\?,\s*NULL,/);
        assert.equal(insertParams.length, 7);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.caixa_id, null);
    });

    it('resolve corrida de hostname único relendo o terminal existente e preservando caixa_id', async () => {
        const existente = {
            id: 52,
            nome: 'PDV-TESTE',
            hostname: 'PDV-TESTE',
            caixa_id: 9,
            usuario_id: null,
            usuario_nome: null
        };
        let leiturasHostname = 0;
        let inserts = 0;
        let updateSql = '';
        const db = {
            get(sql, params, callback) {
                if (sql.includes('WHERE hostname = ?')) {
                    leiturasHostname += 1;
                    return callback(null, leiturasHostname === 1 ? null : existente);
                }
                if (sql.includes('WHERE id = ?')) return callback(null, existente);
                throw new Error(`Consulta inesperada: ${sql}`);
            },
            run(sql, params, callback) {
                if (sql.startsWith('INSERT')) {
                    inserts += 1;
                    const error = new Error('UNIQUE constraint failed: terminais.hostname');
                    error.code = 'SQLITE_CONSTRAINT';
                    return callback(error);
                }
                updateSql = sql;
                callback(null);
            },
            all() {
                throw new Error('A corrida não deve consultar caixas.');
            }
        };
        const rotas = carregarRotasTerminais(db);
        const res = criarResposta();

        rotas.registrarTerminalAuto({
            query: { origem: 'pdv', hostname: 'PDV-TESTE' },
            headers: {},
            user: {}
        }, res);

        assert.equal(inserts, 1);
        assert.doesNotMatch(updateSql, /caixa_id/);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.id, 52);
        assert.equal(res.body.caixa_id, 9);
    });
});
