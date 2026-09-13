const db = require('../../database');
const providerCatalog = require('./providerCatalog');

const providers = {
  mercadopago: require('./providers/mercadoPagoProvider'),
  stone: require('./providers/stoneProvider')
};

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      err ? reject(err) : resolve(this);
    });
  });
}

async function garantirTabela() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS pix_cobrancas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venda_id INTEGER,
      provedor TEXT NOT NULL,
      txid TEXT NOT NULL,
      valor REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      copia_cola TEXT,
      qr_code_base64 TEXT,
      raw_json TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      pago_em DATETIME
    )
  `);
}

async function buscarConfigPix() {
  const ativo = await dbGet("SELECT valor FROM configuracoes WHERE chave = 'pix_automatico_ativo'");
  const provedor = await dbGet("SELECT valor FROM configuracoes WHERE chave = 'pix_provedor_ativo'");
  const configs = await dbGet("SELECT valor FROM configuracoes WHERE chave = 'pix_configs_json'");

  let json = {};
  try {
    json = configs?.valor ? JSON.parse(configs.valor) : {};
  } catch (e) {
    json = {};
  }

  return {
    ativo: ativo?.valor === '1',
    provedor: provedor?.valor || 'mercadopago',
    configs: json
  };
}

async function salvarConfigPix({ ativo, provedor, configs }) {
  await dbRun(`
    INSERT INTO configuracoes (chave, valor, tipo, descricao)
    VALUES ('pix_automatico_ativo', ?, 'boolean', 'Ativar Pix automático')
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = datetime('now', 'localtime')
  `, [ativo ? '1' : '0']);

  await dbRun(`
    INSERT INTO configuracoes (chave, valor, tipo, descricao)
    VALUES ('pix_provedor_ativo', ?, 'text', 'Provedor Pix ativo')
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = datetime('now', 'localtime')
  `, [provedor]);

  await dbRun(`
    INSERT INTO configuracoes (chave, valor, tipo, descricao)
    VALUES ('pix_configs_json', ?, 'json', 'Configurações dos provedores Pix')
    ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = datetime('now', 'localtime')
  `, [JSON.stringify(configs || {})]);
}

async function criarCobranca({ valor, descricao, vendaId }) {
  await garantirTabela();

  const cfg = await buscarConfigPix();

  if (!cfg.ativo) {
    throw new Error('Pix automático está desativado.');
  }

  const provedor = cfg.provedor;
  const provider = providers[provedor];

  if (!provider) {
    throw new Error(`Provedor Pix ainda não implementado: ${provedor}`);
  }

  const configProvedor = cfg.configs[provedor] || {};

  const cobranca = await provider.criarCobranca({
    valor,
    descricao,
    config: configProvedor
  });

  await dbRun(`
    INSERT INTO pix_cobrancas
    (venda_id, provedor, txid, valor, status, copia_cola, qr_code_base64, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    vendaId || null,
    provedor,
    cobranca.txid,
    valor,
    cobranca.status || 'PENDENTE',
    cobranca.copiaCola || null,
    cobranca.qrCodeBase64 || null,
    JSON.stringify(cobranca.raw || {})
  ]);

  return cobranca;
}

async function consultarStatus(txid) {
  await garantirTabela();

  const row = await dbGet(`SELECT * FROM pix_cobrancas WHERE txid = ? ORDER BY id DESC LIMIT 1`, [txid]);

  if (!row) {
    throw new Error('Cobrança Pix não encontrada.');
  }

  const cfg = await buscarConfigPix();
  const provider = providers[row.provedor];

  if (!provider) {
    throw new Error(`Provedor Pix ainda não implementado: ${row.provedor}`);
  }

  const status = await provider.consultarStatus({
    txid,
    config: cfg.configs[row.provedor] || {}
  });

  await dbRun(`
    UPDATE pix_cobrancas
    SET status = ?, pago_em = CASE WHEN ? = 'PAGO' THEN datetime('now', 'localtime') ELSE pago_em END
    WHERE txid = ?
  `, [status.status, status.status, txid]);

  return status;
}

module.exports = {
  providerCatalog,
  buscarConfigPix,
  salvarConfigPix,
  criarCobranca,
  consultarStatus
};