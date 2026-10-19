'use strict';

const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();
const {
  interpretarConsulta,
  interpretarEventoCancelamento,
  reconciliarCancelamentoNfce
} = require('../../backend/services/fiscal/NfceCancelamentoReconciliacaoService');
const {
  restaurarStatusAutorizadoNfceRejeitada
} = require('../../backend/services/fiscal/NfceRejeicaoStatusMigration');

const CHAVE = '23261012345678000199650010000000011000000010';
const CHAVE_DIVERGENTE = '23261012345678000199650010000000011000000020';

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

function fechar(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => (err ? reject(err) : resolve()));
  });
}

function retornoConsulta(cStat, chave = CHAVE) {
  return `<retConsSitNFe><tpAmb>1</tpAmb><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>`
    + `<cUF>23</cUF><chNFe>${chave}</chNFe><protNFe><infProt><tpAmb>1</tpAmb><chNFe>${chave}</chNFe>`
    + `<dhRecbto>2026-10-14T16:36:03-03:00</dhRecbto><nProt>223260920228145</nProt>`
    + `<cStat>${cStat}</cStat><xMotivo>Resultado da consulta</xMotivo></infProt></protNFe></retConsSitNFe>`;
}

function retornoComEventoCancelamento(opcoes = {}) {
  const chave = opcoes.chave || CHAVE;
  const cnpj = opcoes.cnpj || '12345678000199';
  const ambiente = opcoes.ambiente || '1';
  const codigoUf = opcoes.codigoUf || '23';
  const cStat = opcoes.cStat || '135';
  const nSeqEvento = opcoes.nSeqEvento || '1';
  return `<retConsSitNFe><tpAmb>${ambiente}</tpAmb><cStat>100</cStat><xMotivo>Consulta realizada</xMotivo>`
    + `<cUF>${codigoUf}</cUF><chNFe>${chave}</chNFe>`
    + `<protNFe><infProt><tpAmb>${ambiente}</tpAmb><chNFe>${chave}</chNFe><cStat>100</cStat>`
    + '<nProt>223260920228145</nProt></infProt></protNFe>'
    + `<procEventoNFe><evento><infEvento Id="ID110111${chave}${nSeqEvento.padStart(2, '0')}">`
    + `<cOrgao>${codigoUf}</cOrgao><tpAmb>${ambiente}</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chave}</chNFe>`
    + `<dhEvento>2026-10-14T16:36:03-03:00</dhEvento><tpEvento>110111</tpEvento>`
    + `<nSeqEvento>${nSeqEvento}</nSeqEvento><verEvento>1.00</verEvento><detEvento><descEvento>Cancelamento</descEvento>`
    + '<nProt>223260920228145</nProt></detEvento>'
    + `</infEvento></evento><retEvento><infEvento><tpAmb>${ambiente}</tpAmb><cOrgao>${codigoUf}</cOrgao>`
    + `<cStat>${cStat}</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${chave}</chNFe>`
    + `<tpEvento>110111</tpEvento><nSeqEvento>${nSeqEvento}</nSeqEvento>`
    + '<dhRegEvento>2026-10-14T16:36:04-03:00</dhRegEvento><nProt>223260920228146</nProt>'
    + '</infEvento></retEvento></procEventoNFe></retConsSitNFe>';
}

async function criarDb(status = 'cancelamento_desconhecido') {
  const db = new sqlite3.Database(':memory:');
  await dbRun(db, `CREATE TABLE nfce_notas (
    id INTEGER PRIMARY KEY,
    chave_acesso TEXT,
    ambiente INTEGER,
    protocolo TEXT,
    status TEXT,
    xml_retorno TEXT,
    updated_at TEXT
  )`);
  await dbRun(db, `INSERT INTO nfce_notas (id, chave_acesso, ambiente, protocolo, status, xml_retorno)
    VALUES (16, ?, 1, '223260920228145', ?, '<retConsSitNFe><cStat>100</cStat></retConsSitNFe>')`, [CHAVE, status]);
  return db;
}

const tests = [
  ['autorização confirmada pela chave exata libera somente o estado local', async () => {
    const db = await criarDb();
    try {
      const out = await reconciliarCancelamentoNfce(16, {
        db,
        confirmacaoConsulta: true,
        getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1, codigoUf: '23' }),
        consultarProtocolo: async (args) => {
          assert.equal(args.chave, CHAVE);
          assert.equal(args.modelo, 'NFCE');
          return { success: true, body: retornoConsulta('100') };
        }
      });
      const nota = await dbGet(db, 'SELECT * FROM nfce_notas WHERE id = 16');
      assert.equal(out.success, true);
      assert.equal(out.status, 'autorizada');
      assert.equal(nota.status, 'autorizada');
      assert.match(nota.xml_retorno, /<cStat>100<\/cStat>/);
    } finally {
      await fechar(db);
    }
  }],
  ['cStat 101 no protocolo não comprova cancelamento sem procEventoNFe', async () => {
    const db = await criarDb();
    try {
      const out = await reconciliarCancelamentoNfce(16, {
        db,
        confirmacaoConsulta: true,
        getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1 }),
        consultarProtocolo: async () => ({ success: true, body: retornoConsulta('101') })
      });
      assert.equal(out.status, 'cancelamento_desconhecido');
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 16')).status, 'cancelamento_desconhecido');
    } finally {
      await fechar(db);
    }
  }],
  ['retorno inconclusivo documenta a consulta, mas mantém o bloqueio', async () => {
    const db = await criarDb();
    try {
      const out = await reconciliarCancelamentoNfce(16, {
        db,
        confirmacaoConsulta: true,
        getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1 }),
        consultarProtocolo: async () => ({
          success: true,
          body: '<retConsSitNFe><cStat>217</cStat><xMotivo>Não consta</xMotivo></retConsSitNFe>'
        })
      });
      const nota = await dbGet(db, 'SELECT * FROM nfce_notas WHERE id = 16');
      assert.equal(out.success, false);
      assert.equal(nota.status, 'cancelamento_desconhecido');
      assert.match(nota.xml_retorno, /<cStat>217<\/cStat>/);
    } finally {
      await fechar(db);
    }
  }],
  ['falha de transporte não registra consulta nem altera os dados locais', async () => {
    const db = await criarDb();
    try {
      await assert.rejects(
        reconciliarCancelamentoNfce(16, {
          db,
          confirmacaoConsulta: true,
          getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1, codigoUf: '23' }),
          consultarProtocolo: async () => ({
            success: false,
            error: 'Erro TLS/HTTP de transporte'
          })
        }),
        { code: 'CONSULTA_SEFAZ_INCONCLUSIVA', statusCode: 502 }
      );
      const nota = await dbGet(db, 'SELECT status, xml_retorno FROM nfce_notas WHERE id = 16');
      assert.equal(nota.status, 'cancelamento_desconhecido');
      assert.equal(nota.xml_retorno, '<retConsSitNFe><cStat>100</cStat></retConsSitNFe>');
      assert.doesNotMatch(nota.xml_retorno, /Erro TLS\/HTTP de transporte/);
    } finally {
      await fechar(db);
    }
  }],
  ['exceção de transporte informa que a consulta não foi concluída e não altera a nota', async () => {
    const db = await criarDb();
    try {
      await assert.rejects(
        reconciliarCancelamentoNfce(16, {
          db,
          confirmacaoConsulta: true,
          getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1, codigoUf: '23' }),
          consultarProtocolo: async () => { throw new Error('HTTP 502 Bad Gateway'); }
        }),
        (error) => error.code === 'CONSULTA_SEFAZ_INCONCLUSIVA'
          && error.statusCode === 502
          && /não foi concluída/.test(error.message)
          && /HTTP 502 Bad Gateway/.test(error.message)
      );
      const nota = await dbGet(db, 'SELECT status, xml_retorno FROM nfce_notas WHERE id = 16');
      assert.equal(nota.status, 'cancelamento_desconhecido');
      assert.equal(nota.xml_retorno, '<retConsSitNFe><cStat>100</cStat></retConsSitNFe>');
    } finally {
      await fechar(db);
    }
  }],
  ['chave SEFAZ divergente é registrada sem liberar a NFC-e selecionada', async () => {
    const db = await criarDb();
    try {
      await assert.rejects(
        reconciliarCancelamentoNfce(16, {
          db,
          confirmacaoConsulta: true,
          getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1 }),
          consultarProtocolo: async () => ({ success: true, body: retornoConsulta('100', CHAVE_DIVERGENTE) })
        }),
        { code: 'IDENTIDADE_SEFAZ_DIVERGENTE' }
      );
      const nota = await dbGet(db, 'SELECT status, xml_retorno FROM nfce_notas WHERE id = 16');
      assert.equal(nota.status, 'cancelamento_desconhecido');
      assert.match(nota.xml_retorno, new RegExp(`<chNFe>${CHAVE_DIVERGENTE}</chNFe>`));
    } finally {
      await fechar(db);
    }
  }],
  ['ambiente divergente retornado pela SEFAZ não libera a NFC-e', async () => {
    const db = await criarDb();
    try {
      await assert.rejects(
        reconciliarCancelamentoNfce(16, {
          db,
          confirmacaoConsulta: true,
          getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1, codigoUf: '23' }),
          consultarProtocolo: async () => ({
            success: true,
            body: retornoConsulta('100').replace('<tpAmb>1</tpAmb>', '<tpAmb>2</tpAmb>')
          })
        }),
        { code: 'IDENTIDADE_SEFAZ_DIVERGENTE' }
      );
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 16')).status, 'cancelamento_desconhecido');
    } finally {
      await fechar(db);
    }
  }],
  ['CNPJ divergente bloqueia antes de consultar', async () => {
    const db = await criarDb();
    let consultas = 0;
    try {
      await assert.rejects(
        reconciliarCancelamentoNfce(16, {
          db,
          confirmacaoConsulta: true,
          getFiscalConfig: async () => ({ cnpj: '99999999000199', ambiente: 1, codigoUf: '23' }),
          consultarProtocolo: async () => {
            consultas += 1;
            return { success: true, body: retornoConsulta('100') };
          }
        }),
        { code: 'CNPJ_DIVERGENTE' }
      );
      assert.equal(consultas, 0);
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 16')).status, 'cancelamento_desconhecido');
    } finally {
      await fechar(db);
    }
  }],
  ['falha ao persistir a consulta mantém a NFC-e bloqueada', async () => {
    const db = await criarDb();
    try {
      await dbRun(db, `CREATE TRIGGER impedir_reconciliacao
        BEFORE UPDATE ON nfce_notas
        BEGIN SELECT RAISE(FAIL, 'persistência indisponível'); END`);
      await assert.rejects(
        reconciliarCancelamentoNfce(16, {
          db,
          confirmacaoConsulta: true,
          getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1 }),
          consultarProtocolo: async () => ({ success: true, body: retornoConsulta('100') })
        }),
        /persistência indisponível/
      );
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 16')).status, 'cancelamento_desconhecido');
    } finally {
      await fechar(db);
    }
  }],
  ['sem confirmação explícita não consulta a SEFAZ', async () => {
    const db = await criarDb();
    let consultas = 0;
    try {
      await assert.rejects(
        reconciliarCancelamentoNfce(16, {
          db,
          getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1 }),
          consultarProtocolo: async () => {
            consultas += 1;
            return { success: true, body: retornoConsulta('100') };
          }
        }),
        { code: 'CONFIRMACAO_OBRIGATORIA' }
      );
      assert.equal(consultas, 0);
    } finally {
      await fechar(db);
    }
  }],
  ['entrada do fluxo mostra a ação e chama somente a reconciliação', () => {
    const fs = require('fs');
    const path = require('path');
    const frontend = fs.readFileSync(
      path.join(__dirname, '../../frontend/erp/js/fiscal.js'),
      'utf8'
    );
    assert.match(frontend, /Verificar situação na SEFAZ/);
    assert.match(frontend, /\/fiscal\/notas\/\$\{id\}\/reconciliar-cancelamento/);
    assert.doesNotMatch(
      frontend.match(/function reconciliarCancelamentoNfce[\s\S]*?\n}/)[0],
      /\/cancelar/
    );
    const fluxo = frontend.match(/function reconciliarCancelamentoNfce[\s\S]*?\n}/)[0];
    assert.match(fluxo, /resp\.success !== true/);
    assert.match(fluxo, /A consulta à SEFAZ não foi concluída/);
    assert.doesNotMatch(fluxo, /Consulta fiscal concluída/);
    assert.doesNotMatch(fluxo.match(/error: function\(xhr\)[\s\S]*?complete:/)[0], /carregarFiscalNotas\(\)/);
  }],
  ['cStat 101 no protocolo não comprova cancelamento sem procEventoNFe', async () => {
    const autorizado = interpretarConsulta(retornoConsulta('100'));
    const cancelado = interpretarConsulta(retornoConsulta('101'));
    assert.equal(autorizado.status, 'autorizada');
    assert.equal(cancelado.status, 'cancelamento_desconhecido');

    const db = await criarDb();
    try {
      const out = await reconciliarCancelamentoNfce(16, {
        db,
        confirmacaoConsulta: true,
        getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1, codigoUf: '23' }),
        consultarProtocolo: async () => ({ success: true, body: retornoConsulta('101') })
      });
      assert.equal(out.status, 'cancelamento_desconhecido');
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 16')).status, 'cancelamento_desconhecido');
    } finally {
      await fechar(db);
    }
  }],
  ['procEventoNFe 110111 validado confirma cStat 573 e repetição não refaz a confirmação', async () => {
    const body = retornoComEventoCancelamento();
    const evento = interpretarEventoCancelamento(body, {
      chave: CHAVE,
      cnpj: '12345678000199',
      codigoUf: '23',
      ambiente: 1,
      protocoloAutorizacao: '223260920228145'
    });
    assert.equal(evento.confirmado, true);
    assert.equal(evento.cStat, '135');
    assert.equal(evento.protocolo, '223260920228146');

    const db = await criarDb();
    let consultas = 0;
    try {
      const options = {
        db,
        confirmacaoConsulta: true,
        getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1, codigoUf: '23' }),
        consultarProtocolo: async () => {
          consultas += 1;
          return { success: true, body };
        }
      };
      const out = await reconciliarCancelamentoNfce(16, options);
      assert.equal(out.success, true);
      assert.equal(out.status, 'cancelada');
      assert.equal(out.cStat, '135');
      assert.equal(out.protocolo, '223260920228146');
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 16')).status, 'cancelada');
      await assert.rejects(
        reconciliarCancelamentoNfce(16, options),
        { code: 'STATUS_INCOMPATIVEL' }
      );
      assert.equal(consultas, 1);
    } finally {
      await fechar(db);
    }
  }],
  ['evento com CNPJ, UF, ambiente ou protocolo divergente nunca confirma', async () => {
    const casos = [
      { nome: 'CNPJ', opcoes: { cnpj: '99999999000199' } },
      { nome: 'UF', opcoes: { codigoUf: '43' } },
      { nome: 'ambiente', opcoes: { ambiente: '2' } },
      { nome: 'protocolo de autorização', opcoes: { protocoloAutorizacaoEvento: '999260920228145' } },
      { nome: 'protocolo', opcoes: { semProtocolo: true } }
    ];
    for (const caso of casos) {
      const body = caso.opcoes.semProtocolo
        ? retornoComEventoCancelamento().replace('<nProt>223260920228146</nProt>', '')
        : caso.opcoes.protocoloAutorizacaoEvento
          ? retornoComEventoCancelamento().replace(
          '<nProt>223260920228145</nProt></detEvento>',
          `<nProt>${caso.opcoes.protocoloAutorizacaoEvento || '223260920228145'}</nProt></detEvento>`
          )
          : retornoComEventoCancelamento(caso.opcoes);
      const evento = interpretarEventoCancelamento(body, {
        chave: CHAVE,
        cnpj: '12345678000199',
        codigoUf: '23',
        ambiente: 1,
        protocoloAutorizacao: '223260920228145'
      });
      assert.equal(evento.confirmado, false, caso.nome);
      assert.equal(evento.conflito, true, caso.nome);
    }
  }],
  ['falha de persistência ao confirmar evento mantém a NFC-e bloqueada', async () => {
    const db = await criarDb();
    try {
      await dbRun(db, `CREATE TRIGGER impedir_cancelada
        BEFORE UPDATE OF status ON nfce_notas
        WHEN NEW.status = 'cancelada'
        BEGIN SELECT RAISE(FAIL, 'falha ao persistir confirmação'); END`);
      await assert.rejects(
        reconciliarCancelamentoNfce(16, {
          db,
          confirmacaoConsulta: true,
          getFiscalConfig: async () => ({ cnpj: '12345678000199', ambiente: 1, codigoUf: '23' }),
          consultarProtocolo: async () => ({ success: true, body: retornoComEventoCancelamento() })
        }),
        /falha ao persistir confirmação/
      );
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 16')).status, 'cancelamento_desconhecido');
    } finally {
      await fechar(db);
    }
  }],
  ['repara rejeições legadas mas mantém duplicidade 573 em reconciliação', async () => {
    const db = await criarDb();
    const autorizacao = `<retEnviNFe><protNFe><infProt><chNFe>${CHAVE}</chNFe>`
      + '<cStat>100</cStat><nProt>223260920228145</nProt></infProt></protNFe></retEnviNFe>';
    const rejeicao = '<retEnvEvento><cStat>128</cStat><retEvento><infEvento>'
      + '<cStat>501</cStat><xMotivo>Prazo</xMotivo></infEvento></retEvento></retEnvEvento>';
    try {
      await dbRun(db, 'UPDATE nfce_notas SET xml_retorno = ?, status = ? WHERE id = 16', [
        `${autorizacao}<?cdsNfceRetorno ${rejeicao}?>`,
        'cancelamento_rejeitado'
      ]);
      await dbRun(db, `INSERT INTO nfce_notas (id, chave_acesso, ambiente, status, xml_retorno)
        VALUES (17, ?, 1, 'cancelamento_rejeitado', ?)`, [
        CHAVE,
        autorizacao
      ]);
      await dbRun(db, `INSERT INTO nfce_notas (id, chave_acesso, ambiente, status, xml_retorno)
        VALUES (18, ?, 1, 'cancelamento_desconhecido', ?)`, [
        CHAVE,
        `${autorizacao}<?cdsNfceRetorno ${rejeicao}?>`
      ]);
      const chaveNfe = `${CHAVE.slice(0, 20)}55${CHAVE.slice(22)}`;
      await dbRun(db, `INSERT INTO nfce_notas (id, chave_acesso, ambiente, status, xml_retorno)
        VALUES (19, ?, 1, 'cancelamento_rejeitado', ?)`, [
        chaveNfe,
        `${autorizacao}<?cdsNfceRetorno ${rejeicao}?>`
      ]);
      const chaveDivergente = '23261012345678000199650010000000011000000020';
      await dbRun(db, `INSERT INTO nfce_notas (id, chave_acesso, ambiente, status, xml_retorno)
        VALUES (20, ?, 1, 'cancelamento_rejeitado', ?)`, [
        chaveDivergente,
        `${autorizacao}<?cdsNfceRetorno ${rejeicao}?>`
      ]);
      const duplicidade = '<retEnvEvento><cStat>128</cStat><retEvento><infEvento>'
        + '<cStat>573</cStat><xMotivo>Duplicidade de evento</xMotivo></infEvento></retEvento></retEnvEvento>';
      await dbRun(db, `INSERT INTO nfce_notas (id, chave_acesso, ambiente, status, xml_retorno)
        VALUES (21, ?, 1, 'cancelamento_rejeitado', ?)`, [
        CHAVE,
        `${autorizacao}<?cdsNfceRetorno ${duplicidade}?>`
      ]);

      const atualizados = await restaurarStatusAutorizadoNfceRejeitada(db);
      assert.equal(atualizados, 2);
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 16')).status, 'autorizada');
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 21')).status, 'cancelamento_desconhecido');
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 17')).status, 'cancelamento_rejeitado');
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 18')).status, 'cancelamento_desconhecido');
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 19')).status, 'cancelamento_rejeitado');
      assert.equal((await dbGet(db, 'SELECT status FROM nfce_notas WHERE id = 20')).status, 'cancelamento_rejeitado');
    } finally {
      await fechar(db);
    }
  }]
];

async function main() {
  let passed = 0;
  let failed = 0;
  for (const [name, run] of tests) {
    try {
      await run();
      passed += 1;
      console.log(`  OK  ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  FALHOU  ${name}`);
      console.error(`         ${error.stack || error.message}`);
    }
  }
  console.log(`\nResultado: ${passed} ok, ${failed} falha(s)\n`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
