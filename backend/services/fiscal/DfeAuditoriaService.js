/**
 * RC3.6.E — Persistência e consulta da auditoria DistDFe.
 * Somente rastreabilidade — não altera regras de negócio.
 *
 * @module services/fiscal/DfeAuditoriaService
 */

'use strict';

const db = require('../../database');
const {
  DfeAuditoriaResultado,
  DfeAuditoriaEtapa,
  criarCorrelationIdDfeSync
} = require('./dfeAuditoriaConstantes');

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
}

class DfeAuditoriaService {
  /**
   * @param {Object} evento
   * @returns {Promise<number|null>} id inserido
   */
  async registrar(evento = {}) {
    const correlationId = evento.correlation_id || evento.correlationId || null;
    const nsu = evento.nsu != null ? String(evento.nsu) : null;
    const tipo = evento.tipo || evento.etapa || null;
    const schema = evento.schema || null;
    const chave = evento.chave || null;
    const resultado = evento.resultado || DfeAuditoriaResultado.DESCONHECIDO;
    const motivo = evento.motivo || null;
    const tempoMs = evento.tempo_ms != null ? Number(evento.tempo_ms) : (evento.tempoMs != null ? Number(evento.tempoMs) : null);
    const empresaId = evento.empresa_id != null ? evento.empresa_id : (evento.empresaId != null ? evento.empresaId : null);
    const cnpj = evento.cnpj ? String(evento.cnpj).replace(/\D/g, '') : null;
    const ambiente = evento.ambiente != null ? Number(evento.ambiente) : null;
    const detalheJson = evento.detalhe != null
      ? (typeof evento.detalhe === 'string' ? evento.detalhe : JSON.stringify(evento.detalhe))
      : null;

    try {
      const r = await runAsync(
        `INSERT INTO dfe_auditoria (
          correlation_id, empresa_id, cnpj, ambiente, nsu, tipo, schema, chave,
          resultado, motivo, tempo_ms, detalhe_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          correlationId,
          empresaId,
          cnpj,
          ambiente,
          nsu,
          tipo,
          schema,
          chave,
          resultado,
          motivo,
          tempoMs,
          detalheJson
        ]
      );

      const prefix = correlationId || 'SYNC';
      console.log(
        `[DFE][AUDIT] ${prefix} | NSU=${nsu || '—'} | tipo=${tipo || '—'} | resultado=${resultado}`
          + (motivo ? ` | motivo=${motivo}` : '')
      );

      return r.id;
    } catch (err) {
      console.error('[DFE][AUDIT] falha ao gravar auditoria:', err.message);
      return null;
    }
  }

  async registrarConsulta(dados = {}) {
    return this.registrar({
      ...dados,
      tipo: DfeAuditoriaEtapa.CONSULTA,
      resultado: dados.resultado || DfeAuditoriaResultado.CONSULTA,
      motivo: dados.motivo || `cStat=${dados.cStat || '—'} ultNSU=${dados.ultNsuEnviado || '—'} maxNSU=${dados.maxNsuRecebido || '—'}`,
      detalhe: {
        empresa: dados.empresa || null,
        cnpj: dados.cnpj || null,
        ambiente: dados.ambiente,
        ultNsuEnviado: dados.ultNsuEnviado,
        maxNsuRecebido: dados.maxNsuRecebido,
        ultNsuRecebido: dados.ultNsuRecebido,
        cStat: dados.cStat,
        xMotivo: dados.xMotivo,
        lotes: dados.lotes,
        tempoMs: dados.tempoMs
      }
    });
  }

  async registrarNsuAvanco(dados = {}) {
    return this.registrar({
      ...dados,
      tipo: DfeAuditoriaEtapa.NSU,
      nsu: dados.nsu || dados.ultNsu,
      resultado: dados.avancou
        ? DfeAuditoriaResultado.NSU_AVANCO
        : DfeAuditoriaResultado.NSU_PRESERVADO,
      motivo: dados.motivo || (dados.avancou ? 'Cursor atualizado=TRUE' : 'Cursor atualizado=FALSE'),
      detalhe: {
        ultNsuAnterior: dados.ultNsuAnterior,
        ultNsuNovo: dados.ultNsuNovo || dados.ultNsu,
        maxNsu: dados.maxNsu,
        avancou: !!dados.avancou,
        cStat: dados.cStat
      }
    });
  }

  async registrarResumoSync(dados = {}) {
    return this.registrar({
      ...dados,
      tipo: DfeAuditoriaEtapa.SYNC,
      resultado: DfeAuditoriaResultado.SYNC_RESUMO,
      motivo: dados.motivo || 'Resumo da sincronização',
      detalhe: {
        recebidos: dados.recebidos,
        processados: dados.processados,
        atualizados: dados.atualizados,
        duplicados: dados.duplicados,
        eventos: dados.eventos,
        xml: dados.xml,
        resumo: dados.resumo,
        erros: dados.erros,
        tempoTotalMs: dados.tempoTotalMs,
        ultNsu: dados.ultNsu,
        maxNsu: dados.maxNsu,
        cStat: dados.cStat
      }
    });
  }

  /**
   * @param {Object} filtros
   * @returns {Promise<{ itens: Object[], total: number }>}
   */
  async listar(filtros = {}) {
    const where = [];
    const params = [];

    if (filtros.correlationId || filtros.correlation_id) {
      where.push('correlation_id = ?');
      params.push(filtros.correlationId || filtros.correlation_id);
    }
    if (filtros.nsu) {
      where.push('nsu LIKE ?');
      params.push(`%${String(filtros.nsu).replace(/\D/g, '')}%`);
    }
    if (filtros.chave) {
      where.push('chave LIKE ?');
      params.push(`%${String(filtros.chave).replace(/\D/g, '')}%`);
    }
    if (filtros.resultado) {
      where.push('resultado = ?');
      params.push(filtros.resultado);
    }
    if (filtros.schema) {
      where.push('schema LIKE ?');
      params.push(`%${filtros.schema}%`);
    }
    if (filtros.tipo) {
      where.push('tipo = ?');
      params.push(filtros.tipo);
    }
    if (filtros.cnpj) {
      where.push('cnpj = ?');
      params.push(String(filtros.cnpj).replace(/\D/g, ''));
    }
    if (filtros.dataInicio || filtros.data_inicio) {
      where.push('date(created_at) >= date(?)');
      params.push(filtros.dataInicio || filtros.data_inicio);
    }
    if (filtros.dataFim || filtros.data_fim) {
      where.push('date(created_at) <= date(?)');
      params.push(filtros.dataFim || filtros.data_fim);
    }

    const clausula = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limite = Math.min(500, Math.max(1, Number(filtros.limite) || 100));
    const offset = Math.max(0, Number(filtros.offset) || 0);

    const totalRow = await getAsync(
      `SELECT COUNT(*) AS total FROM dfe_auditoria ${clausula}`,
      params
    );
    const itens = await allAsync(
      `SELECT * FROM dfe_auditoria ${clausula}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limite, offset]
    );

    return {
      itens,
      total: Number(totalRow?.total || 0),
      limite,
      offset
    };
  }

  async buscarPorId(id) {
    return getAsync('SELECT * FROM dfe_auditoria WHERE id = ?', [id]);
  }

  /**
   * @param {Object} filtros
   * @param {'csv'|'json'} formato
   */
  async exportar(filtros = {}, formato = 'json') {
    const { itens } = await this.listar({ ...filtros, limite: 5000, offset: 0 });
    if (String(formato).toLowerCase() === 'csv') {
      const cols = [
        'id', 'correlation_id', 'empresa_id', 'cnpj', 'ambiente', 'nsu', 'tipo',
        'schema', 'chave', 'resultado', 'motivo', 'tempo_ms', 'created_at'
      ];
      const esc = (v) => {
        const s = v == null ? '' : String(v);
        if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
      };
      const lines = [cols.join(';')];
      itens.forEach((row) => {
        lines.push(cols.map((c) => esc(row[c])).join(';'));
      });
      return { contentType: 'text/csv; charset=utf-8', body: lines.join('\n') };
    }
    return {
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ total: itens.length, itens }, null, 2)
    };
  }
}

module.exports = {
  DfeAuditoriaService,
  DfeAuditoriaResultado,
  DfeAuditoriaEtapa,
  criarCorrelationIdDfeSync
};
