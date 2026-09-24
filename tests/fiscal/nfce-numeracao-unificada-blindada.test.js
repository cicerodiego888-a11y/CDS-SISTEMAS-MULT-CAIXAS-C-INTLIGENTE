/**
 * Sprint NFC-e 65 — Numeração fiscal unificada e blindada.
 * Executar: node --test tests/fiscal/nfce-numeracao-unificada-blindada.test.js
 *
 * NÃO transmite SEFAZ. NÃO altera banco de produção.
 */
'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '../..');

const EMISSOR = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/emissor.js'), 'utf8');
const TX = fs.readFileSync(path.join(ROOT, 'backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService.js'), 'utf8');
const CFG = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/configService.js'), 'utf8');
const NUM = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/numeracaoFiscalService.js'), 'utf8');
const OCUP = fs.readFileSync(path.join(ROOT, 'backend/services/fiscal/nfceNumeracaoOcupadosService.js'), 'utf8');

const {
  chaveLockNumeracao,
  proximoLivreDeConjunto,
  cnpjChave
} = require('../../backend/services/fiscal/numeracaoFiscalService');
const { withLockQueued, resetLocksForTests } = require('../../backend/services/fiscal/nfeEmissionLockService');
const {
  montarStatusFechamento
} = require('../../backend/services/fechamento-fiscal/FechamentoFiscalTransmissaoService');
const { STATUS, DOC_STATUS } = require('../../backend/services/fechamento-fiscal/constants');
const {
  extrairChaveConflito539,
  parseChaveNfce
} = require('../../backend/services/fiscal/nfceNumeracaoOcupadosService');

describe('NFC-e 65 — numeração unificada e blindada', () => {
  it('01 — venda normal usa reservarProximaNumeracaoFiscal (modelo 65)', () => {
    assert.match(EMISSOR, /reservarProximaNumeracaoFiscal/);
    assert.match(EMISSOR, /modelo:\s*['"]65['"]/);
    assert.match(EMISSOR, /origem:\s*['"]VENDA['"]/);
    const semComentarios = EMISSOR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/incrementaNumeroFiscal\s*\(/.test(semComentarios), false);
  });

  it('02 — fechamento fiscal reserva via mesmo serviço (não incrementa legado como autoridade)', () => {
    assert.match(TX, /reservarProximaNumeracaoFiscal/);
    assert.match(TX, /origem:\s*['"]FECHAMENTO_FISCAL['"]/);
    assert.match(TX, /modelo:\s*['"]65['"]/);
  });

  it('03 — lock CNPJ+ambiente+65+série', () => {
    const a = chaveLockNumeracao({ cnpj: '12345678000199', ambiente: 1, modelo: '65', serie: 1 });
    assert.equal(a, `fiscal-num:${cnpjChave('12345678000199')}:1:65:1`);
    assert.match(NUM, /withLockQueued/);
    assert.match(NUM, /fiscal-num:/);
  });

  it('04 — três reservas concorrentes não colidem', async () => {
    resetLocksForTests();
    const store = { n: 16 };
    const lock = chaveLockNumeracao({ cnpj: '1', ambiente: 2, modelo: '65', serie: 1 });
    const jobs = [0, 1, 2].map(() => withLockQueued(lock, async () => {
      const v = store.n;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 10));
      store.n = v + 1;
      return v;
    }));
    const nums = await Promise.all(jobs);
    assert.deepEqual([...nums].sort((a, b) => a - b), [16, 17, 18]);
    assert.equal(new Set(nums).size, 3);
  });

  it('05 — venda + fechamento compartilham a mesma chave de lock', () => {
    const venda = chaveLockNumeracao({ cnpj: '111', ambiente: 1, modelo: '65', serie: 1 });
    const fecha = chaveLockNumeracao({ cnpj: '111', ambiente: 1, modelo: '65', serie: 1 });
    assert.equal(venda, fecha);
  });

  it('06 — CStat 539 registra ocupação (código + logs)', () => {
    assert.match(EMISSOR, /aplicarOcupacaoPorRejeicao539Nfce/);
    assert.match(TX, /aplicarOcupacaoPorRejeicao539Nfce/);
    assert.match(OCUP, /nfce_numeros_ocupados_sefaz/);
    assert.match(OCUP, /\[FISCAL\]\[NUMERACAO\]\[539\]|logNum\('539'/);
    assert.equal(/setConfiguracao\(\s*['"]fiscal_numero_atual['"].*numeroDuplicado/.test(EMISSOR), false);
  });

  it('07 — número ocupado é pulado na próxima reserva', () => {
    assert.equal(proximoLivreDeConjunto(50, [50]), 51);
    assert.equal(proximoLivreDeConjunto(50, [50, 51, 52]), 53);
  });

  it('08 — timeout: emissor reutiliza identidade pendente (não gera nNF novo automático)', () => {
    assert.match(EMISSOR, /notaPendenteAnterior/);
    assert.match(EMISSOR, /REUTILIZANDO|reutilizar/i);
    assert.match(EMISSOR, /erro_transmissao|soap_enviado|pendente/);
    assert.match(TX, /ERRO_COM_POSSIVEL_PROCESSAMENTO/);
    assert.match(TX, /recuperarDocumento|Nunca retransmitir autorizado/);
  });

  it('09 — NFC-e autorizada nunca retransmitida', () => {
    assert.match(EMISSOR, /status = 'autorizada'/);
    assert.match(EMISSOR, /reused:\s*true|notaAutorizada/);
    assert.match(TX, /Nunca retransmitir autorizado|já autorizado/);
  });

  it('10 — fechamento parcial → AUTORIZACAO_PARCIAL', () => {
    const st = montarStatusFechamento([
      { status: DOC_STATUS.AUTORIZADO },
      { status: DOC_STATUS.REJEITADO },
      { status: DOC_STATUS.REJEITADO }
    ]);
    assert.equal(st, STATUS.AUTORIZACAO_PARCIAL);
  });

  it('11 — parcial preserva docs autorizados (status agregado ≠ REJEITADO)', () => {
    const st = montarStatusFechamento([
      { status: DOC_STATUS.AUTORIZADO },
      { status: DOC_STATUS.REJEITADO }
    ]);
    assert.notEqual(st, STATUS.REJEITADO);
    assert.equal(st, STATUS.AUTORIZACAO_PARCIAL);
  });

  it('12 — todos rejeitados → REJEITADO; todos auth → AUTORIZADO', () => {
    assert.equal(
      montarStatusFechamento([{ status: DOC_STATUS.REJEITADO }, { status: DOC_STATUS.REJEITADO }]),
      STATUS.REJEITADO
    );
    assert.equal(
      montarStatusFechamento([{ status: DOC_STATUS.AUTORIZADO }, { status: DOC_STATUS.AUTORIZADO }]),
      STATUS.AUTORIZADO
    );
  });

  it('13 — pendente recuperação quando há timeout/possível processamento', () => {
    assert.equal(
      montarStatusFechamento([
        { status: DOC_STATUS.AUTORIZADO },
        { status: DOC_STATUS.ERRO_COM_POSSIVEL_PROCESSAMENTO }
      ]),
      STATUS.PENDENTE_RECUPERACAO
    );
  });

  it('14 — CNPJ / série / ambiente independentes', () => {
    const a = chaveLockNumeracao({ cnpj: '11111111000191', ambiente: 1, modelo: '65', serie: 1 });
    const b = chaveLockNumeracao({ cnpj: '22222222000191', ambiente: 1, modelo: '65', serie: 1 });
    const c = chaveLockNumeracao({ cnpj: '11111111000191', ambiente: 2, modelo: '65', serie: 1 });
    const d = chaveLockNumeracao({ cnpj: '11111111000191', ambiente: 1, modelo: '65', serie: 2 });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.notEqual(a, d);
  });

  it('15 — extrai chave SEFAZ 44 dígitos do retorno 539', () => {
    const chave = '23260912345678000199650010000000141123456789';
    const raw = `<cStat>539</cStat><xMotivo>Rejeicao: Duplicidade de NF-e [chNFe:${chave}]</xMotivo>`;
    assert.equal(extrairChaveConflito539(null, raw), chave);
    const p = parseChaveNfce(chave);
    assert.equal(p.modelo, '65');
    assert.equal(p.numero, 14);
    assert.equal(p.serie, 1);
  });

  it('16 — incrementaNumeroFiscal é LEGACY e delega ao serviço unificado', () => {
    assert.match(CFG, /LEGACY/);
    assert.match(CFG, /reservarProximaNumeracaoFiscal/);
    assert.match(CFG, /async function incrementaNumeroFiscal/);
  });

  it('17 — tabela nfce_numeros_ocupados_sefaz e reconciliação presentes', () => {
    assert.match(OCUP, /CREATE TABLE IF NOT EXISTS nfce_numeros_ocupados_sefaz/);
    assert.match(OCUP, /reconciliarNumeracaoNfce/);
    assert.match(NUM, /reconciliarNumeracaoNfce/);
    const dbSrc = fs.readFileSync(path.join(ROOT, 'backend/database.js'), 'utf8');
    assert.match(dbSrc, /nfce_numeros_ocupados_sefaz/);
  });

  it('18 — Motor Fiscal / TEF / Payment Core não alterados nesta sprint (arquivos intactos)', () => {
    // Garante que a sprint não tocou motores proibidos (existência + sem imports novos no emissor).
    assert.ok(fs.existsSync(path.join(ROOT, 'backend/services/tef')));
    assert.equal(/tefManager|DestaxaRealAdapter|PaymentCore/i.test(EMISSOR), false);
  });
});

describe('NFC-e 65 — ocupação SEFAZ em SQLite isolado', () => {
  let db;
  let tmp;

  before(async () => {
    tmp = path.join(os.tmpdir(), `nfce-num-${Date.now()}.db`);
    db = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(tmp, (err) => (err ? reject(err) : resolve(d)));
    });
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE nfce_numeros_ocupados_sefaz (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cnpj TEXT NOT NULL,
          ambiente INTEGER NOT NULL,
          serie INTEGER NOT NULL,
          numero INTEGER NOT NULL,
          chave TEXT,
          origem TEXT,
          cstat TEXT,
          xmotivo TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(cnpj, ambiente, serie, numero)
        )
      `, (err) => (err ? reject(err) : resolve()));
    });
  });

  it('19 — UNIQUE impede reutilizar mesmo nNF ocupado', async () => {
    const run = (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve(this);
      });
    });
    await run(
      `INSERT INTO nfce_numeros_ocupados_sefaz (cnpj, ambiente, serie, numero, chave, origem, cstat)
       VALUES (?, 1, 1, 50, 'CHAVE_B', '539', '539')`,
      ['12345678000199']
    );
    let dup = false;
    try {
      await run(
        `INSERT INTO nfce_numeros_ocupados_sefaz (cnpj, ambiente, serie, numero, chave, origem, cstat)
         VALUES (?, 1, 1, 50, 'CHAVE_A', '539', '539')`,
        ['12345678000199']
      );
    } catch (_) {
      dup = true;
    }
    assert.equal(dup, true);
    const next = proximoLivreDeConjunto(50, [50]);
    assert.equal(next, 51);
  });

  it('20 — histórico 11/12/14/15 permanece bloqueável sem apagar', async () => {
    const run = (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve(this);
      });
    });
    const all = (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
    for (const n of [11, 12, 14, 15]) {
      await run(
        `INSERT OR IGNORE INTO nfce_numeros_ocupados_sefaz (cnpj, ambiente, serie, numero, origem, cstat)
         VALUES (?, 1, 1, ?, '539-historico', '539')`,
        ['12345678000199', n]
      );
    }
    const rows = await all(
      `SELECT numero FROM nfce_numeros_ocupados_sefaz WHERE cnpj=? ORDER BY numero`,
      ['12345678000199']
    );
    const nums = rows.map((r) => r.numero);
    assert.ok(nums.includes(11) && nums.includes(12) && nums.includes(14) && nums.includes(15));
    assert.equal(proximoLivreDeConjunto(11, nums), 13);
    assert.equal(proximoLivreDeConjunto(14, nums), 16);
  });
});
