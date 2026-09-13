/**
 * ProtocolDocumentation — Documentação automática do protocolo (Sprint 13).
 *
 * Gera e atualiza PROTOCOLO_TOLEDO.md a partir de capturas.
 * Nunca afirma protocolo oficial — apenas registra descobertas.
 *
 * @class ProtocolDocumentation
 */

const fs = require('fs');
const frameAnalyzer = require('./FrameAnalyzer');
const { caminhoProtocoloMd } = require('./paths');

const CATEGORIAS = [
  'handshake',
  'ping',
  'status',
  'produto',
  'departamento',
  'promocao',
  'etiqueta',
  'peso',
  'ack',
  'nak',
  'desconhecido'
];

/** @type {Map<string, Object>} */
const observacoesPorCaptura = new Map();

class ProtocolDocumentation {
  /**
   * @returns {string[]}
   */
  listarCategorias() {
    return [...CATEGORIAS];
  }

  /**
   * @param {string} capturaId
   * @param {number} indicePacote
   * @param {string} texto
   * @param {string} [categoria]
   */
  adicionarObservacao(capturaId, indicePacote, texto, categoria = null) {
    const chave = `${capturaId}:${indicePacote}`;
    observacoesPorCaptura.set(chave, {
      captura_id: capturaId,
      indice: indicePacote,
      texto,
      categoria,
      registrado_em: new Date().toISOString()
    });
  }

  /**
   * Classifica pacote por heurística + observação manual.
   * @param {Object} pacote
   * @param {Object} [analise]
   * @param {string} [observacao]
   * @returns {string}
   */
  classificarPacote(pacote, analise, observacao = '') {
    const obs = String(observacao || '').toLowerCase();
    for (const cat of CATEGORIAS) {
      if (obs.includes(cat)) return cat;
    }

    const a = analise || (pacote.buffer || pacote.buffer_hex || pacote.hex
      ? frameAnalyzer.analisarFrame(pacote.buffer || pacote.buffer_hex || pacote.hex)
      : null);

    if (!a) return 'desconhecido';

    if (a.padroes?.ack?.frame_inteiro_ack || pacote.ack) return 'ack';
    if (a.padroes?.nak?.frame_inteiro_nak || pacote.nak) return 'nak';

    const cmd = a.campos?.find((c) => c.tipo === 'possivel_comando_ascii')?.valor || '';
    const cmdMap = {
      HS: 'handshake',
      PN: 'ping',
      PI: 'ping',
      ST: 'status',
      RS: 'status',
      EP: 'produto',
      UP: 'produto',
      RP: 'produto',
      PR: 'promocao',
      DP: 'departamento',
      ET: 'etiqueta',
      PW: 'peso'
    };
    if (cmdMap[cmd]) return cmdMap[cmd];

    const op = String(pacote.operacao || pacote.comando || '').toLowerCase();
    if (op.includes('handshake')) return 'handshake';
    if (op.includes('ping')) return 'ping';
    if (op.includes('status')) return 'status';
    if (op.includes('produto')) return 'produto';
    if (op.includes('promocao')) return 'promocao';
    if (op.includes('departamento')) return 'departamento';
    if (op.includes('etiqueta')) return 'etiqueta';
    if (op.includes('peso')) return 'peso';

    return 'desconhecido';
  }

  /**
   * Agrega descobertas de uma ou mais sessões.
   * @param {Object|Object[]} sessoes
   * @returns {Object}
   */
  agregarDescobertas(sessoes) {
    const lista = Array.isArray(sessoes) ? sessoes : [sessoes];
    const frames = [];
    const comandos = new Map();
    const camposConhecidos = [];
    const camposDesconhecidos = [];
    const padroes = { stx: 0, etx: 0, ack: 0, nak: 0, crc: 0, checksum: 0 };
    const porCategoria = {};

    for (const cat of CATEGORIAS) porCategoria[cat] = [];

    for (const sessao of lista) {
      for (let i = 0; i < (sessao.pacotes || []).length; i += 1) {
        const pacote = sessao.pacotes[i];
        const buf = pacote.buffer || pacote.buffer_hex || pacote.hex;
        if (!buf) continue;

        const analise = pacote.analise || frameAnalyzer.analisarFrame(buf);
        const obsKey = `${sessao.id}:${i}`;
        const obs = observacoesPorCaptura.get(obsKey);
        const categoria = this.classificarPacote(pacote, analise, obs?.texto);

        const registro = {
          sessao_id: sessao.id,
          indice: i,
          direcao: pacote.direcao,
          categoria,
          hex: analise.hex,
          analise,
          observacao: obs?.texto || null
        };

        frames.push(registro);
        porCategoria[categoria].push(registro);

        if (analise.padroes?.stx?.detectado) padroes.stx += 1;
        if (analise.padroes?.etx?.detectado) padroes.etx += 1;
        if (analise.padroes?.ack?.detectado) padroes.ack += 1;
        if (analise.padroes?.nak?.detectado) padroes.nak += 1;
        if (analise.padroes?.crc?.detectado) padroes.crc += 1;
        if (analise.padroes?.checksum?.detectado) padroes.checksum += 1;

        const cmd = analise.campos?.find((c) => c.tipo === 'possivel_comando_ascii');
        if (cmd?.valor) {
          if (!comandos.has(cmd.valor)) comandos.set(cmd.valor, []);
          comandos.get(cmd.valor).push(registro);
        }

        for (const campo of analise.campos || []) {
          if (campo.confianca === 'baixa' && campo.tipo !== 'possivel_comando_ascii') {
            camposDesconhecidos.push({ ...campo, frame_hex: analise.hex });
          } else {
            camposConhecidos.push({ ...campo, frame_hex: analise.hex });
          }
        }
      }
    }

    return {
      total_frames: frames.length,
      frames,
      por_categoria: porCategoria,
      padroes_contagem: padroes,
      comandos_identificados: Object.fromEntries(comandos),
      campos_conhecidos: camposConhecidos,
      campos_desconhecidos: camposDesconhecidos
    };
  }

  /**
   * @param {Object} descobertas
   * @returns {string}
   */
  gerarMarkdown(descobertas) {
    const agora = new Date().toISOString();
    const linhas = [
      '# Protocolo Toledo Prix 4 Uno — Documentação por Engenharia Reversa',
      '',
      '> **Aviso:** Documento gerado automaticamente pelo CDS. Não constitui especificação oficial.',
      '> Baseado em capturas TCP entre MGV7 e balança. Hipóteses devem ser validadas.',
      '',
      `**Última atualização:** ${agora}`,
      '',
      '---',
      '',
      '## Resumo',
      '',
      `- Frames analisados: **${descobertas.total_frames}**`,
      `- Padrões STX observados: ${descobertas.padroes_contagem?.stx ?? 0}`,
      `- Padrões ETX observados: ${descobertas.padroes_contagem?.etx ?? 0}`,
      `- Padrões ACK observados: ${descobertas.padroes_contagem?.ack ?? 0}`,
      `- Padrões NAK observados: ${descobertas.padroes_contagem?.nak ?? 0}`,
      `- Hipóteses CRC: ${descobertas.padroes_contagem?.crc ?? 0}`,
      `- Hipóteses Checksum: ${descobertas.padroes_contagem?.checksum ?? 0}`,
      '',
      '## Frames descobertos',
      ''
    ];

    const amostra = (descobertas.frames || []).slice(-50);
    for (const f of amostra) {
      linhas.push(`### Frame #${f.indice} (${f.direcao}) — categoria: \`${f.categoria}\``);
      linhas.push('');
      linhas.push(`- HEX: \`${f.hex}\``);
      if (f.observacao) linhas.push(`- Observação: ${f.observacao}`);
      linhas.push('');
    }

    linhas.push('## Comandos identificados (hipótese)');
    linhas.push('');
    const cmds = descobertas.comandos_identificados || {};
    if (!Object.keys(cmds).length) {
      linhas.push('_Nenhum comando ASCII de 2 letras identificado ainda._');
    } else {
      for (const [cmd, ocorrencias] of Object.entries(cmds)) {
        linhas.push(`- **${cmd}**: ${ocorrencias.length} ocorrência(s)`);
      }
    }
    linhas.push('');

    linhas.push('## Padrões');
    linhas.push('');
    linhas.push('| Padrão | Ocorrências |');
    linhas.push('|--------|-------------|');
    for (const [k, v] of Object.entries(descobertas.padroes_contagem || {})) {
      linhas.push(`| ${k.toUpperCase()} | ${v} |`);
    }
    linhas.push('');

    linhas.push('## Categorias documentadas');
    linhas.push('');
    for (const cat of CATEGORIAS) {
      const qtd = (descobertas.por_categoria?.[cat] || []).length;
      linhas.push(`- **${cat}**: ${qtd} frame(s)`);
    }
    linhas.push('');

    linhas.push('## Campos conhecidos (heurística)');
    linhas.push('');
    const uniqCampos = new Set((descobertas.campos_conhecidos || []).map((c) => c.tipo));
    if (!uniqCampos.size) linhas.push('_Nenhum._');
    else uniqCampos.forEach((t) => linhas.push(`- ${t}`));
    linhas.push('');

    linhas.push('## Campos desconhecidos');
    linhas.push('');
  const uniqDesc = new Set((descobertas.campos_desconhecidos || []).map((c) => `${c.tipo}@${c.offset}`));
    if (!uniqDesc.size) linhas.push('_Nenhum registrado._');
    else uniqDesc.forEach((t) => linhas.push(`- ${t}`));
    linhas.push('');

    linhas.push('## CRC / Checksum');
    linhas.push('');
    linhas.push('_Aguardando validação com capturas MGV7 reais._');
    linhas.push('');

    linhas.push('## ACK / NAK');
    linhas.push('');
    linhas.push('- ACK hipotético: byte `0x06`');
    linhas.push('- NAK hipotético: byte `0x15`');
    linhas.push('');

    linhas.push('## Observações');
    linhas.push('');
    linhas.push('_Adicione observações via API ou durante captura._');
    linhas.push('');

    return linhas.join('\n');
  }

  /**
   * @param {Object|Object[]} sessoes
   * @returns {{ caminho: string, descobertas: Object }}
   */
  atualizarDocumento(sessoes) {
    const descobertas = this.agregarDescobertas(sessoes);
    const markdown = this.gerarMarkdown(descobertas);
    const caminho = caminhoProtocoloMd();
    fs.writeFileSync(caminho, markdown, 'utf8');
    return { caminho, descobertas };
  }

  reiniciarObservacoes() {
    observacoesPorCaptura.clear();
  }
}

const protocolDocumentation = new ProtocolDocumentation();

module.exports = protocolDocumentation;
module.exports.ProtocolDocumentation = ProtocolDocumentation;
module.exports.CATEGORIAS = CATEGORIAS;
