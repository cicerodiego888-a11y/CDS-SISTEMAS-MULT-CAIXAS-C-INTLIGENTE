const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const defaultDbDir = path.resolve(__dirname, '..', 'dados');
const dbDir = process.env.DB_DIR && process.env.DB_DIR.trim()
  ? process.env.DB_DIR
  : defaultDbDir;
const dbPath = path.join(dbDir, 'mercadao.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err);
    return;
  }
  console.log('Conectado ao banco de dados SQLite');

  // Deletar todos os usuários
  db.run('DELETE FROM usuarios', (err) => {
    if (err) {
      console.error('Erro ao deletar usuários:', err);
      return;
    }
    console.log('Usuários deletados');

    // Hash da senha '1234'
    const hashedPassword = bcrypt.hashSync('1234', 10);

    // Inserir novo usuário admin
    db.run(
      'INSERT INTO usuarios (username, password_hash, role) VALUES (?, ?, ?)',
      ['admin', hashedPassword, 'admin'],
      function(err) {
        if (err) {
          console.error('Erro ao inserir usuário:', err);
          return;
        }
        console.log('Usuário admin inserido com ID:', this.lastID);
        db.close((err) => {
          if (err) {
            console.error('Erro ao fechar banco:', err);
          } else {
            console.log('Banco de dados fechado');
          }
        });
      }
    );
  });
});