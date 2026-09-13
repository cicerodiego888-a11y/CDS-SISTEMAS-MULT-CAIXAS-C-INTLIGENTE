const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const cron = require('node-cron');
const db = require('./database');

const defaultDbDir = path.resolve(__dirname, '..', 'dados');
const DB_PATH = process.env.DB_DIR && process.env.DB_DIR.trim()
  ? path.join(process.env.DB_DIR, 'mercadao.db')
  : path.join(defaultDbDir, 'mercadao.db');
// Caminho do arquivo de configurações de backup
const CONFIG_PATH = path.join(__dirname, 'backup-config.json');

function defaultConfig() {
  return {
    enabled: false,
    frequency: '0 2 * * *', // padrão: todo dia às 2h
    google: {
      client_id: '',
      client_secret: '',
      redirect_uris: [],
      refresh_token: ''
    }
  };
}

function parseJson(value, fallback) {
  if (!value || typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function loadConfigSync() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return defaultConfig();
}

async function loadConfigFromDb() {
  return new Promise((resolve) => {
    db.all(`SELECT chave, valor FROM configuracoes WHERE chave LIKE 'backup_google_%'`, [], (err, rows) => {
      if (err || !rows || rows.length === 0) {
        resolve(null);
        return;
      }

      const config = defaultConfig();
      rows.forEach(({ chave, valor }) => {
        switch (chave) {
          case 'backup_google_enabled':
            config.enabled = String(valor).toLowerCase() === 'true';
            break;
          case 'backup_google_frequency':
            config.frequency = valor || config.frequency;
            break;
          case 'backup_google_client_id':
            config.google.client_id = valor || '';
            break;
          case 'backup_google_client_secret':
            config.google.client_secret = valor || '';
            break;
          case 'backup_google_redirect_uris':
            config.google.redirect_uris = parseJson(valor, []);
            break;
          case 'backup_google_refresh_token':
            config.google.refresh_token = valor || '';
            break;
          default:
            break;
        }
      });
      resolve(config);
    });
  });
}

function buildConfigFromEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.BACKUP_GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.BACKUP_GOOGLE_CLIENT_SECRET || '';
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN || process.env.BACKUP_GOOGLE_REFRESH_TOKEN || '';
  const redirectUrisRaw = process.env.GOOGLE_REDIRECT_URIS || process.env.BACKUP_GOOGLE_REDIRECT_URIS || '';

  if (!clientId && !clientSecret && !refreshToken) {
    return null;
  }

  const redirectUris = redirectUrisRaw
    ? parseJson(redirectUrisRaw, redirectUrisRaw.split(',').map(uri => uri.trim()).filter(Boolean))
    : [];

  return {
    enabled: true,
    frequency: process.env.BACKUP_GOOGLE_FREQUENCY || '0 2 * * *',
    google: {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      refresh_token: refreshToken
    }
  };
}

async function loadConfig() {
  const dbConfig = await loadConfigFromDb();
  if (dbConfig && (dbConfig.enabled || dbConfig.google.refresh_token)) {
    return dbConfig;
  }

  if (fs.existsSync(CONFIG_PATH)) {
    return loadConfigSync();
  }

  const envConfig = buildConfigFromEnv();
  if (envConfig) {
    saveConfig(envConfig);
    return envConfig;
  }

  return defaultConfig();
}

// Salva configurações de backup
function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// Cria o cliente OAuth2 do Google
function getOAuth2Client(googleConfig) {
  const { client_id, client_secret, redirect_uris, refresh_token } = googleConfig;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oAuth2Client.setCredentials({ refresh_token });
  return oAuth2Client;
}

// Faz upload do arquivo de backup para o Google Drive
async function uploadBackupToDrive(googleConfig) {
  const oAuth2Client = getOAuth2Client(googleConfig);
  const drive = google.drive({ version: 'v3', auth: oAuth2Client });
  const fileMetadata = {
    name: `mercadao-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  };
  const media = {
    mimeType: 'application/x-sqlite3',
    body: fs.createReadStream(DB_PATH)
  };
  try {
    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, name, webViewLink'
    });
    return { success: true, file: file.data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Agendamento do backup automático
let currentTask = null;
function scheduleBackup(config) {
  if (currentTask) currentTask.stop();
  if (config.enabled && config.google.refresh_token) {
    currentTask = cron.schedule(config.frequency, async () => {
      await uploadBackupToDrive(config.google);
    });
  }
}

async function initBackup() {
  const config = await loadConfig();
  scheduleBackup(config);
}

// Inicializa agendamento ao carregar
initBackup().catch((err) => {
  console.error('Erro ao inicializar backup automático:', err);
});

module.exports = {
  loadConfigSync,
  loadConfig,
  saveConfig,
  uploadBackupToDrive,
  scheduleBackup
};
