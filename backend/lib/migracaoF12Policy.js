/**
 * F12 POLICY DATABASE MIGRATION
 *
 * Includes:
 * - f12_ativo column to caixas table
 * - f12_politica (legado)
 * - f12_global_ativo
 * - f12_controle / f12_escopo_admin (modelo oficial)
 */

const {
  mapearPoliticaLegadaParaModelo
} = require('./f12ModeloControle');

function upsertConfiguracao(db, chave, valor, tipo, descricao, callback) {
  db.run(
    `INSERT INTO configuracoes (chave, valor, tipo, descricao, updated_at)
     VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
     ON CONFLICT(chave) DO UPDATE SET
       valor = excluded.valor,
       updated_at = datetime('now', 'localtime')`,
    [chave, valor, tipo, descricao],
    callback
  );
}

/**
 * Converte f12_politica → f12_controle / f12_escopo_admin.
 * Idempotente via marcador migracao_f12_controle_v1.
 */
function migrarModeloControleF12(db, callback) {
  const done = typeof callback === 'function' ? callback : () => {};

  db.get(
    `SELECT valor FROM configuracoes WHERE chave = 'migracao_f12_controle_v1'`,
    [],
    (markerErr, marker) => {
      if (markerErr) return done(markerErr);
      if (marker && String(marker.valor) === '1') {
        return done(null, { jaMigrado: true });
      }

      db.get(
        `SELECT valor FROM configuracoes WHERE chave = 'f12_politica'`,
        [],
        (polErr, polRow) => {
          if (polErr) return done(polErr);

          const modelo = mapearPoliticaLegadaParaModelo(polRow && polRow.valor);
          const escopoValor = modelo.escopo || '';

          upsertConfiguracao(
            db,
            'f12_controle',
            modelo.controle,
            'string',
            'Controle F12: OPERADOR | ADMINISTRADOR',
            (cErr) => {
              if (cErr) return done(cErr);
              upsertConfiguracao(
                db,
                'f12_escopo_admin',
                escopoValor,
                'string',
                'Escopo admin F12: TODOS | INDIVIDUAL (válido se controle=ADMINISTRADOR)',
                (eErr) => {
                  if (eErr) return done(eErr);
                  upsertConfiguracao(
                    db,
                    'migracao_f12_controle_v1',
                    '1',
                    'boolean',
                    'Migração F12 controle/escopo v1',
                    (kErr) => {
                      if (kErr) return done(kErr);
                      done(null, {
                        jaMigrado: false,
                        controle: modelo.controle,
                        escopo: modelo.escopo,
                        politicaLegada: polRow && polRow.valor ? String(polRow.valor).toUpperCase() : 'POR_CAIXA'
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
}

function executarMigracaoF12Policy(db, callback) {
  let erros = [];

  function aplicarAlteracao(tabela, sql, descricao) {
    // Se for um ALTER TABLE ADD COLUMN, verificar se a coluna já existe via PRAGMA
    const addColumnMatch = /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+([`\"]?)(\w+)\1/i.exec(sql);
    if (addColumnMatch) {
      const coluna = addColumnMatch[2];
      db.all(`PRAGMA table_info(${tabela})`, [], (prErr, rows) => {
        if (prErr) {
          // Se falhar ao checar, tentar aplicar a alteração e tratar o erro normalmente
          db.run(sql, (err) => {
            if (err) {
              erros.push(`${tabela}: ${descricao} - ${err.message}`);
              console.error(`Erro ao aplicar migração F12: ${descricao}`, err.message);
            } else {
              console.log(`Migração F12: ${descricao} aplicada com sucesso`);
            }
          });
          return;
        }

        const exists = (rows || []).some(r => r && r.name === coluna);
        if (exists) {
          console.log(`Coluna ${coluna} já existe em ${tabela}`);
          return;
        }

        db.run(sql, (err) => {
          if (err) {
            erros.push(`${tabela}: ${descricao} - ${err.message}`);
            console.error(`Erro ao aplicar migração F12: ${descricao}`, err.message);
          } else {
            console.log(`Migração F12: ${descricao} aplicada com sucesso`);
          }
        });
      });
      return;
    }

    // Caso geral: executar a SQL e tratar erros
    db.run(sql, (err) => {
      if (err) {
        erros.push(`${tabela}: ${descricao} - ${err.message}`);
        console.error(`Erro ao aplicar migração F12: ${descricao}`, err.message);
      } else {
        console.log(`Migração F12: ${descricao} aplicada com sucesso`);
      }
    });
  }

  function inserirConfiguracao(chave, valor, tipo, descricao) {
    db.run(
      `INSERT OR IGNORE INTO configuracoes (chave, valor, tipo, descricao, updated_at)
       VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`,
      [chave, valor, tipo, descricao],
      (err) => {
        if (err) {
          erros.push(`Configuração ${chave}: ${err.message}`);
          console.error(`Erro ao inserir configuração F12 ${chave}:`, err.message);
        } else {
          console.log(`Migração F12: Configuração ${chave} inserida`);
        }
      }
    );
  }

  // 1. Adicionar coluna f12_ativo à tabela caixas
  aplicarAlteracao(
    'caixas',
    `ALTER TABLE caixas ADD COLUMN f12_ativo INTEGER DEFAULT 1`,
    'Adicionar coluna f12_ativo'
  );

  // 2. Inserir configurações padrão
  inserirConfiguracao(
    'f12_politica',
    'POR_CAIXA',
    'string',
    'Política F12: POR_CAIXA (operador controla), GLOBAL (admin controla todos), MODO_ADMIN (admin controla individual)'
  );

  inserirConfiguracao(
    'f12_global_ativo',
    '1',
    'boolean',
    'Estado global F12 (usado quando ADMINISTRADOR + TODOS)'
  );

  inserirConfiguracao(
    'f12_controle',
    'OPERADOR',
    'string',
    'Controle F12: OPERADOR | ADMINISTRADOR'
  );

  inserirConfiguracao(
    'f12_escopo_admin',
    '',
    'string',
    'Escopo admin F12: TODOS | INDIVIDUAL'
  );

  // 3. Migração: transferir modo_dashboard_fiscal para f12_global_ativo
  // Se existir modo_dashboard_fiscal e NÃO existir f12_global_ativo set
  db.get(
    `SELECT valor FROM configuracoes WHERE chave = 'migracao_f12_global_ativo_v1'`,
    [],
    (checkErr, migRow) => {
      if (!checkErr && migRow) {
        // Já foi migrado
        return;
      }

      db.get(
        `SELECT valor FROM configuracoes WHERE chave = 'modo_dashboard_fiscal'`,
        [],
        (legacyErr, legacyRow) => {
          if (!legacyErr && legacyRow && legacyRow.valor) {
            const valor = legacyRow.valor === '1' || legacyRow.valor === 'true' ? '1' : '0';
            db.run(
              `UPDATE configuracoes SET valor = ?, updated_at = datetime('now', 'localtime')
               WHERE chave = 'f12_global_ativo'`,
              [valor],
              (updateErr) => {
                if (!updateErr) {
                  console.log(`Migração F12: f12_global_ativo herdado de modo_dashboard_fiscal (valor: ${valor})`);
                  
                  // Marcar migração como concluída
                  db.run(
                    `INSERT INTO configuracoes (chave, valor, tipo, descricao) 
                     VALUES ('migracao_f12_global_ativo_v1', '1', 'boolean', 'Migração F12 Global Ativo v1')`
                  );
                }
              }
            );
          }
        }
      );
    }
  );

  if (callback && typeof callback === 'function') {
    setTimeout(() => {
      migrarModeloControleF12(db, (migModeloErr, migModelo) => {
        if (migModeloErr) {
          erros.push(`modelo_controle: ${migModeloErr.message}`);
          console.error('Erro na migração do modelo de controle F12:', migModeloErr.message);
        } else if (migModelo && !migModelo.jaMigrado) {
          console.log(
            `Migração F12: modelo controle=${migModelo.controle} escopo=${migModelo.escopo || 'null'} (origem ${migModelo.politicaLegada})`
          );
        }
        callback(erros.length > 0 ? new Error(erros.join('; ')) : null, {
          erros,
          sucesso: erros.length === 0,
          modelo: migModelo || null
        });
      });
    }, 500);
  }
}

module.exports = { executarMigracaoF12Policy, migrarModeloControleF12 };
