'use strict';
const sqlite3 = require('sqlite3');
const fs = require('fs');
const path = require('path');

const DB = 'C:/ProgramData/MercantilFiscal/dados/mercadao.db';
const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY);

db.all(
  `SELECT id, tipo, mensagem, substr(payload,1,700) AS p, criado_em
   FROM tef_logs
   WHERE payload LIKE '%lease_1ddd7a48f3655670%'
   ORDER BY id`,
  (err, rows) => {
    if (err) {
      console.error(err);
      db.close();
      process.exit(1);
    }
    const resumo = rows.map((r) => {
      let acao = null;
      let liberado = null;
      let inconclusivo = null;
      try {
        const j = JSON.parse(r.p.endsWith('}') ? r.p : r.p + '"}');
        // payload truncated — extract via regex
      } catch (_) { /* ignore */ }
      const mAcao = String(r.p).match(/"acao":"([^"]+)"/);
      const mLib = String(r.p).match(/"liberado":(true|false)/);
      const mInc = String(r.p).match(/"resultadoFinanceiroInconclusivo":(true|false)/);
      return {
        id: r.id,
        tipo: r.tipo,
        mensagem: r.mensagem,
        acao: mAcao && mAcao[1],
        liberado: mLib && mLib[1],
        inconclusivo: mInc && mInc[1],
        criado_em: r.criado_em
      };
    });

    db.all(
      `SELECT id, tipo, mensagem, substr(payload,1,500) AS p, criado_em
       FROM tef_logs
       WHERE payload LIKE '%"liberado":false%'
         AND payload LIKE '%lease%'
       ORDER BY id DESC LIMIT 10`,
      (e2, stuck) => {
        const stuckResumo = (stuck || []).map((r) => ({
          id: r.id,
          mensagem: r.mensagem,
          acao: (String(r.p).match(/"acao":"([^"]+)"/) || [])[1] || null,
          leaseId: (String(r.p).match(/"leaseId":"([^"]+)"/) || [])[1] || null,
          liberado: (String(r.p).match(/"liberado":(true|false)/) || [])[1] || null,
          criado_em: r.criado_em
        }));

        const auth = require('../../../../backend/services/tef/destaxa/destaxaAutorizacaoExcepcional');
        const out = {
          lease1ddd: resumo,
          leasesAindaNaoLiberadosNosLogs: stuckResumo,
          permitEmitivel: {
            valorCentavosFixo: 100,
            tipos: ['cartao_debito', 'debito'],
            operacao: 'CRT',
            ttlMs: auth.TTL_PADRAO_MS,
            issuedAtivasNoLedger: 0,
            nota: 'emitirAutorizacaoExcepcional sempre grava valorCentavos=100 e debito; não reutiliza CONSUMED'
          }
        };
        fs.writeFileSync(
          path.join(__dirname, '_lease-foco.json'),
          `${JSON.stringify(out, null, 2)}\n`
        );
        console.log(JSON.stringify(out, null, 2));
        db.close();
      }
    );
  }
);
