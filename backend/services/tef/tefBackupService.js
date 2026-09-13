const db = require('../../database');
const cryptoService = require('../crypto/cryptoService');
const fs = require('fs');
const path = require('path');

/**
 * Serviço de backup criptografado de transações TEF
 * Conforme PCI-DSS 3.2.1 - Backup seguro de dados sensíveis
 */
class TefBackupService {
  
  constructor() {
    this.backupAtivo = process.env.TEF_BACKUP_ACTIVE !== 'false';
    this.backupInterval = Number(process.env.TEF_BACKUP_INTERVAL_HOURS) || 24; // 24 horas padrão
    this.backupDir = process.env.TEF_BACKUP_DIR || path.join(__dirname, '../../../backups/tef');
    this.retentionDays = Number(process.env.TEF_BACKUP_RETENTION_DAYS) || 90; // 90 dias padrão
  }
  
  /**
   * Executa backup criptografado de transações TEF
   * @returns {Promise<Object>} Resultado do backup
   */
  async executarBackup() {
    if (!this.backupAtivo) {
      return { backup_desativado: true };
    }
    
    const resultado = {
      data_inicio: new Date().toISOString(),
      transacoes_backup: 0,
      logs_backup: 0,
      arquivo_backup: null,
      tamanho_bytes: 0,
      sucesso: false
    };
    
    try {
      // Criar diretório de backup se não existir
      await this._criarDiretorioBackup();
      
      // Obter dados para backup
      const dadosBackup = await this._obterDadosBackup();
      resultado.transacoes_backup = dadosBackup.transacoes.length;
      resultado.logs_backup = dadosBackup.logs.length;
      
      // Criptografar dados
      const dadosCriptografados = cryptoService.criptografarObjeto(dadosBackup);
      
      // Gerar nome do arquivo
      const nomeArquivo = `tef_backup_${Date.now()}.enc`;
      const caminhoArquivo = path.join(this.backupDir, nomeArquivo);
      
      // Escrever arquivo criptografado
      fs.writeFileSync(caminhoArquivo, dadosCriptografados, 'utf8');
      resultado.arquivo_backup = caminhoArquivo;
      resultado.tamanho_bytes = fs.statSync(caminhoArquivo).size;
      
      // Registrar backup no banco
      await this._registrarBackup(resultado);
      
      // Limpar backups antigos
      await this._limparBackupsAntigos();
      
      resultado.sucesso = true;
      resultado.data_fim = new Date().toISOString();
      
      console.log(`Backup TEF concluído: ${nomeArquivo} (${resultado.tamanho_bytes} bytes)`);
      return resultado;
    } catch (error) {
      console.error('Erro no backup TEF:', error);
      resultado.erro = error.message;
      resultado.sucesso = false;
      resultado.data_fim = new Date().toISOString();
      return resultado;
    }
  }
  
  /**
   * Cria diretório de backup se não existir
   */
  async _criarDiretorioBackup() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }
  
  /**
   * Obtém dados para backup
   */
  async _obterDadosBackup() {
    const transacoes = await this._obterTransacoesBackup();
    const logs = await this._obterLogsBackup();
    
    return {
      transacoes,
      logs,
      data_backup: new Date().toISOString(),
      versao: '1.0.0'
    };
  }
  
  /**
   * Obtém transações para backup
   */
  async _obterTransacoesBackup() {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT id,
               venda_id,
               tipo,
               valor,
               parcelas,
               status,
               provedor,
               bandeira,
               nsu,
               autorizacao,
               codigo_transacao,
               payload_retorno,
               criado_em
        FROM tef_transacoes
        ORDER BY criado_em DESC
      `, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
  
  /**
   * Obtém logs para backup
   */
  async _obterLogsBackup() {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT id,
               transacao_id,
               tipo,
               mensagem,
               payload,
               hash_integridade,
               criado_em
        FROM tef_logs
        ORDER BY criado_em DESC
        LIMIT 10000
      `, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
  
  /**
   * Registra backup no banco
   */
  async _registrarBackup(resultado) {
    return new Promise((resolve, reject) => {
      db.run(`
        INSERT INTO tef_backups (
          arquivo,
          transacoes_backup,
          logs_backup,
          tamanho_bytes,
          sucesso,
          criado_em
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
      `, [
        resultado.arquivo_backup,
        resultado.transacoes_backup,
        resultado.logs_backup,
        resultado.tamanho_bytes,
        resultado.sucesso ? 1 : 0
      ], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  
  /**
   * Limpa backups antigos
   */
  async _limparBackupsAntigos() {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - this.retentionDays);
    
    // Remover arquivos antigos
    const arquivos = fs.readdirSync(this.backupDir);
    
    for (const arquivo of arquivos) {
      const caminhoArquivo = path.join(this.backupDir, arquivo);
      const stats = fs.statSync(caminhoArquivo);
      
      if (stats.mtime < dataLimite) {
        fs.unlinkSync(caminhoArquivo);
        console.log(`Backup antigo removido: ${arquivo}`);
      }
    }
    
    // Remover registros antigos do banco
    return new Promise((resolve, reject) => {
      db.run(`
        DELETE FROM tef_backups
        WHERE criado_em < ?
      `, [dataLimite.toISOString()], function(err) {
        if (err) return reject(err);
        console.log(`${this.changes} registros de backup antigos removidos`);
        resolve();
      });
    });
  }
  
  /**
   * Restaura backup criptografado
   * @param {string} caminhoArquivo - Caminho do arquivo de backup
   * @returns {Promise<Object>} Dados restaurados
   */
  async restaurarBackup(caminhoArquivo) {
    try {
      // Ler arquivo criptografado
      const dadosCriptografados = fs.readFileSync(caminhoArquivo, 'utf8');
      
      // Descriptografar dados
      const dados = cryptoService.descriptografarObjeto(dadosCriptografados);
      
      return {
        sucesso: true,
        dados,
        data_backup: dados.data_backup
      };
    } catch (error) {
      console.error('Erro ao restaurar backup:', error);
      return {
        sucesso: false,
        erro: error.message
      };
    }
  }
  
  /**
   * Obtém histórico de backups
   */
  async obterHistoricoBackups(dias = 30) {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - dias);
    
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT id,
               arquivo,
               transacoes_backup,
               logs_backup,
               tamanho_bytes,
               sucesso,
               criado_em
        FROM tef_backups
        WHERE criado_em >= ?
        ORDER BY criado_em DESC
      `, [dataLimite.toISOString()], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }
  
  /**
   * Inicia backup automático periódico
   */
  iniciarBackupAutomatico() {
    if (!this.backupAtivo) {
      console.log('Backup automático TEF desativado');
      return;
    }
    
    console.log(`Backup automático TEF iniciado (intervalo: ${this.backupInterval}h)`);
    
    // Executar backup imediatamente
    this.executarBackup();
    
    // Executar periodicamente
    setInterval(async () => {
      try {
        await this.executarBackup();
      } catch (error) {
        console.error('Erro no backup automático:', error);
      }
    }, this.backupInterval * 60 * 60 * 1000); // Converter horas para milissegundos
  }
}

module.exports = new TefBackupService();
