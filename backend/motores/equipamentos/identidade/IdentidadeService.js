'use strict';

/**
 * IdentidadeService (MIE) — RC2.1
 *
 * Camada pós-Discovery: enriquece candidatos sem alterar Discovery/CandidateDTO.
 */

const repo = require('./IdentidadeRepository');
const {
  extrairSinais,
  chaveIdentidade,
  pontuarCorrespondencia,
  classificarScore,
  resolverStatus,
  LIMIARES
} = require('./IdentidadeScore');

class IdentidadeService {
  /**
   * Enriquece lista de candidatos após discovery.
   * @param {Object[]} candidatos
   * @param {{ sessao_id?: number|null }} [ctx]
   * @returns {Promise<Object[]>}
   */
  async enriquecerCandidatos(candidatos = [], ctx = {}) {
    await repo.garantirSchema();
    const sessaoId = ctx.sessao_id || null;
    const saida = [];

    for (const c of candidatos || []) {
      try {
        const enriquecido = await this._processarUm(c, sessaoId);
        saida.push(enriquecido);
      } catch (_) {
        // Falha de identidade não deve quebrar o discovery
        saida.push({
          ...this._comoObjeto(c),
          identidade: {
            id: null,
            score: 0,
            classe: 'novo',
            status: 'novo',
            rotulo: 'Novo equipamento',
            erro: 'falha_ao_resolver_identidade'
          }
        });
      }
    }

    return saida;
  }

  /**
   * @param {Object} candidate
   * @param {number|null} sessaoId
   * @private
   */
  async _processarUm(candidate, sessaoId) {
    const base = this._comoObjeto(candidate);
    const sinais = extrairSinais(base);
    const { chave, nivel } = chaveIdentidade(sinais);

    let melhor = null;
    let melhorScore = 0;
    let melhorMatches = [];

    const porChave = await repo.buscarPorChave(chave);
    if (porChave) {
      const p = pontuarCorrespondencia(sinais, porChave);
      melhor = porChave;
      melhorScore = Math.max(p.score, 0.95);
      melhorMatches = p.matches.length ? p.matches : [nivel];
    } else {
      const candidatosDb = await repo.listarCandidatosMatch(sinais);
      for (const reg of candidatosDb) {
        const p = pontuarCorrespondencia(sinais, reg);
        if (p.score > melhorScore) {
          melhorScore = p.score;
          melhor = reg;
          melhorMatches = p.matches;
        }
      }
    }

    const { status, rotulo } = resolverStatus(sinais, melhor, melhorScore);
    const classe = classificarScore(melhorScore);
    const agora = new Date().toISOString();

    // Merge apenas com evidência forte (≥70%). Semelhante (40–69%) = novo registro.
    const podeMesclar = Boolean(melhor && melhorScore >= LIMIARES.PROVAVEL);

    let identidade;
    if (!podeMesclar) {
      identidade = await repo.criar({
        chave,
        nivel_chave: nivel,
        serial_number: sinais.serial_number,
        mac: sinais.mac,
        modelo: sinais.modelo,
        firmware: sinais.firmware,
        vid: sinais.vid,
        pid: sinais.pid,
        driver_codigo: sinais.driver_codigo,
        assinatura_ref: sinais.assinatura,
        transporte: sinais.transporte,
        ip_atual: sinais.ip,
        porta_atual: sinais.porta,
        porta_com_atual: sinais.porta_com,
        caminho_dispositivo: sinais.caminho_dispositivo,
        ultima_sessao_id: sessaoId
      });
      await repo.registrarHistorico({
        identidade_id: identidade.id,
        evento: 'CRIADO',
        de_valor: null,
        para_valor: chave,
        sessao_id: sessaoId,
        score: 0,
        snapshot: this._snapshotLeve(base)
      });
      melhorScore = 0;
      const statusNovo = { status: 'novo', rotulo: 'Novo equipamento' };
      await repo.vincularSessao({
        identidade_id: identidade.id,
        sessao_id: sessaoId,
        score: 0,
        status: statusNovo.status
      });
      return {
        ...base,
        identidade: {
          id: identidade.id,
          chave: identidade.chave,
          nivel_chave: identidade.nivel_chave || nivel,
          score: 0,
          score_pct: 0,
          classe: 'novo',
          status: statusNovo.status,
          rotulo: statusNovo.rotulo,
          matches: [],
          vezes_visto: identidade.vezes_visto,
          primeira_vez_em: identidade.primeira_vez_em,
          ultimo_visto_em: identidade.ultimo_visto_em,
          ip_anterior: null,
          ip_atual: identidade.ip_atual || sinais.ip || null,
          ultima_mudanca_ip_em: null,
          firmware: identidade.firmware,
          sessao_id: sessaoId
        }
      };
    } else {
      const patch = {
        serial_number: sinais.serial_number || melhor.serial_number,
        mac: sinais.mac || melhor.mac,
        modelo: sinais.modelo || melhor.modelo,
        firmware: sinais.firmware || melhor.firmware,
        vid: sinais.vid || melhor.vid,
        pid: sinais.pid || melhor.pid,
        driver_codigo: sinais.driver_codigo || melhor.driver_codigo,
        assinatura_ref: sinais.assinatura || melhor.assinatura_ref,
        transporte: sinais.transporte || melhor.transporte,
        porta_atual: sinais.porta != null ? sinais.porta : melhor.porta_atual,
        porta_com_atual: sinais.porta_com || melhor.porta_com_atual,
        caminho_dispositivo: sinais.caminho_dispositivo || melhor.caminho_dispositivo,
        vezes_visto: Number(melhor.vezes_visto || 0) + 1,
        ultimo_visto_em: agora,
        ultima_sessao_id: sessaoId
      };

      if (sinais.ip && melhor.ip_atual && sinais.ip !== melhor.ip_atual) {
        patch.ip_anterior = melhor.ip_atual;
        patch.ip_atual = sinais.ip;
        patch.ultima_mudanca_ip_em = agora;
        await repo.registrarHistorico({
          identidade_id: melhor.id,
          evento: 'IP_ALTERADO',
          de_valor: melhor.ip_atual,
          para_valor: sinais.ip,
          sessao_id: sessaoId,
          score: melhorScore,
          snapshot: this._snapshotLeve(base)
        });
      } else if (sinais.ip) {
        patch.ip_atual = sinais.ip;
      }

      if (
        sinais.firmware
        && melhor.firmware
        && String(sinais.firmware).toLowerCase() !== String(melhor.firmware).toLowerCase()
      ) {
        await repo.registrarHistorico({
          identidade_id: melhor.id,
          evento: 'FIRMWARE_ALTERADO',
          de_valor: melhor.firmware,
          para_valor: sinais.firmware,
          sessao_id: sessaoId,
          score: melhorScore,
          snapshot: this._snapshotLeve(base)
        });
      }

      await repo.registrarHistorico({
        identidade_id: melhor.id,
        evento: 'VISTO',
        de_valor: null,
        para_valor: sinais.assinatura || chave,
        sessao_id: sessaoId,
        score: melhorScore,
        snapshot: this._snapshotLeve(base)
      });

      identidade = await repo.atualizar(melhor.id, patch);
    }

    await repo.vincularSessao({
      identidade_id: identidade.id,
      sessao_id: sessaoId,
      score: melhorScore,
      status
    });

    return {
      ...base,
      identidade: {
        id: identidade.id,
        chave: identidade.chave,
        nivel_chave: identidade.nivel_chave || nivel,
        score: melhorScore,
        score_pct: Math.round(melhorScore * 100),
        classe,
        status,
        rotulo,
        matches: melhorMatches,
        vezes_visto: identidade.vezes_visto,
        primeira_vez_em: identidade.primeira_vez_em,
        ultimo_visto_em: identidade.ultimo_visto_em,
        ip_anterior: identidade.ip_anterior,
        ip_atual: identidade.ip_atual || sinais.ip || null,
        ultima_mudanca_ip_em: identidade.ultima_mudanca_ip_em || null,
        firmware: identidade.firmware,
        sessao_id: sessaoId
      }
    };
  }

  _comoObjeto(c) {
    if (!c || typeof c !== 'object') return {};
    return { ...c };
  }

  _snapshotLeve(c) {
    return {
      transporte: c.transporte,
      driver_codigo: c.driver_codigo,
      assinatura: c.assinatura,
      ip: c.ip,
      porta: c.porta,
      porta_com: c.porta_com,
      vid: c.vid,
      pid: c.pid,
      modelo: c.modelo,
      firmware: c.firmware,
      mac: c.mac
    };
  }

  async listar(limite = 50) {
    return repo.listar(limite);
  }

  async buscarPorId(id) {
    const idn = await repo.buscarPorId(id);
    if (!idn) return null;
    const historico = await repo.listarHistorico(id, 30);
    const sessoes = await repo.listarSessoesDaIdentidade(id, 30);
    return { ...idn, historico, sessoes };
  }
}

const identidadeService = new IdentidadeService();

module.exports = identidadeService;
module.exports.IdentidadeService = IdentidadeService;
module.exports.LIMIARES = LIMIARES;
