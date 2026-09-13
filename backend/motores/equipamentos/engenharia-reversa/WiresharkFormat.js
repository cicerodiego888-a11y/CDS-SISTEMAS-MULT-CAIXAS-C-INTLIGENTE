/**
 * WiresharkFormat — Exportação compatível para análise manual (Sprint 13).
 *
 * Não depende do Wireshark — gera informações comparáveis.
 *
 * @class WiresharkFormat
 */

class WiresharkFormat {
  /**
   * @param {Object[]} pacotes
   * @param {Object} [meta]
   * @returns {string}
   */
  gerar(pacotes, meta = {}) {
    const ipLocal = meta.ip_local || meta.ip_origem || '0.0.0.0';
    const ipRemoto = meta.ip || meta.ip_destino || meta.host || '0.0.0.0';
    const portaLocal = meta.porta_local ?? meta.porta_origem ?? '*';
    const portaRemota = meta.porta ?? meta.porta_destino ?? 9100;
    const linhas = [
      '# CDS Engenharia Reversa — Exportação estilo Wireshark',
      `# Gerado em: ${new Date().toISOString()}`,
      `# IP Local: ${ipLocal} | IP Remoto: ${ipRemoto}`,
      `# Porta Local: ${portaLocal} | Porta Remota: ${portaRemota}`,
      '# Colunas: Timestamp | IP Origem | IP Destino | Porta Origem | Porta Destino | Dir | Delta ms | HEX | ASCII',
      ''
    ];

    let anteriorTs = null;

    for (let i = 0; i < pacotes.length; i += 1) {
      const p = pacotes[i];
      const ts = p.timestamp ? new Date(p.timestamp).getTime() : Date.now();
      const delta = anteriorTs != null ? ts - anteriorTs : 0;
      anteriorTs = ts;

      const dir = String(p.direcao || 'TX').toUpperCase();
      const origem = dir === 'TX' ? ipLocal : ipRemoto;
      const destino = dir === 'TX' ? ipRemoto : ipLocal;
      const portaOrig = dir === 'TX' ? portaLocal : portaRemota;
      const portaDest = dir === 'TX' ? portaRemota : portaLocal;

      linhas.push([
        p.timestamp || new Date(ts).toISOString(),
        origem,
        destino,
        portaOrig,
        portaDest,
        dir,
        delta,
        p.hex || '',
        (p.ascii || '').replace(/\|/g, '/')
      ].join(' | '));
    }

    return linhas.join('\n');
  }

  /**
   * @param {Object} sessao
   * @returns {string}
   */
  gerarDeSessao(sessao) {
    return this.gerar(sessao.pacotes || [], {
      ip: sessao.ip,
      porta: sessao.porta,
      ip_local: sessao.ip_local
    });
  }
}

const wiresharkFormat = new WiresharkFormat();

module.exports = wiresharkFormat;
module.exports.WiresharkFormat = WiresharkFormat;
