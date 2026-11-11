'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/ProgramData/MercantilFiscal/dados/mercadao.db', { readOnly: true });
const rows = db.prepare(
  "SELECT chave, valor FROM configuracoes WHERE lower(chave) LIKE '%tef%' OR lower(chave) LIKE '%destaxa%' OR lower(chave) LIKE '%pinpad%' OR lower(chave) LIKE '%com%' ORDER BY chave"
).all();
db.close();

const confHits = [];
function walk(dir, depth = 0) {
  if (depth > 4 || !fs.existsSync(dir)) return;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const ent of ents) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, depth + 1);
    else if (/\.conf$/i.test(ent.name)) {
      const st = fs.statSync(full);
      let head = '';
      try {
        head = fs.readFileSync(full, 'utf8').split(/\r?\n/).slice(0, 40).map((l) => {
          if (/senha|password|secret|token/i.test(l) && /=/.test(l)) return l.replace(/=.*/, '=***');
          return l;
        }).join('\n');
      } catch (_) { /* ignore */ }
      confHits.push({ path: full, mtime: st.mtime.toISOString(), size: st.size, head });
    }
  }
}
walk('C:\\VBI\\V$Pague');

const out = {
  configuracoesTef: rows,
  confFiles: confHits,
  gateShell: {
    DESTAXA_REAL_TRANSACTION_ENABLED: process.env.DESTAXA_REAL_TRANSACTION_ENABLED || null
  }
};
fs.writeFileSync(path.join(__dirname, 'diag-f0-config.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
