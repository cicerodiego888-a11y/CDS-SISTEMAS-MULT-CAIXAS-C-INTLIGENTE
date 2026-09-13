const path = require('path');
const fs = require('fs');

function getFiscalDir() {
  const envDir = process.env.FISCAL_DIR;
  if (envDir && envDir.trim()) {
    return envDir.trim();
  }

  return path.resolve(__dirname, '../../../dados/fiscal');
}

function getFiscalSubDir(sub) {
  const dir = path.join(getFiscalDir(), sub);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

module.exports = { getFiscalDir, getFiscalSubDir };
