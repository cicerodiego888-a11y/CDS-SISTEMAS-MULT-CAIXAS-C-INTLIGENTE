const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { getFiscalConfig } = require('./configService');
const { reservarProximaNumeracaoFiscal } = require('./numeracaoFiscalService');
const {
  aplicarOcupacaoPorRejeicao539Nfce,
  extrairChaveConflito539,
  parseChaveNfce
} = require('./nfceNumeracaoOcupadosService');
const { consultarProtocolo } = require('./consultaProtocoloRuntime');
const { ModelType } = require('./core/ModelType');
const { carregarCertificadoPfx } = require('./certificateService');
const {
  buildNfceXml
} = require('./xmlBuilder');
const { gerarQRCodeNFCe } = require('./qrcode');
const { assinarNFe } = require('./signer');
const { montarLote } = require('./soapClient');
const { enviarAutorizacao } = require('./autorizacaoRuntime');
const { withLock, lockAtivo } = require('./nfeEmissionLockService');
const { compactarXml, extrairChaveEProtocoloAutorizados } = require('./utils');
const { validarItensFiscal } = require('./validadorFiscal');
const { validarXmlFiscal } = require('./validarXmlFiscal');
const { montarDadosDanfe } = require('./danfe');
const DanfeTermicoRenderer = require('./DanfeTermicoRenderer');
const { getFiscalSubDir } = require('./paths');

function itemEntraNaNfce(item) {
  return Number(item.quantidade_fiscal || 0) > 0
    && Number(item.valor_fiscal || 0) > 0;
}

console.log('EMISSOR REAL:', __filename);

function salvarDebug(nome, conteudo) {
  const pasta = getFiscalSubDir('debug');
  fs.writeFileSync(path.join(pasta, nome), String(conteudo ?? ''), 'utf8');
}

function carregarVenda(vendaId) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT v.*, c.nome as cliente_nome, c.cpf_cnpj as cliente_cpf
      FROM vendas v
      LEFT JOIN clientes c ON c.id = v.cliente_id
      WHERE v.id = ?
    `, [vendaId], (err, venda) => {
      if (err) return reject(err);
      if (!venda) return reject(new Error('Venda não encontrada.'));

      db.all(`
        SELECT
          vi.*,
          p.nome as produto_nome,
          p.ncm as produto_ncm,
          p.cfop,
          p.csosn,
          p.origem,
          p.cest as produto_cest,
          p.codigo_barras as produto_codigo_barras,
          p.unidade,
          p.produto_fracionado,
          p.vendido_por_peso
        FROM vendas_itens vi
        INNER JOIN produtos p ON p.id = vi.produto_id
        WHERE vi.venda_id = ?
        ORDER BY vi.id
      `, [vendaId], (itErr, itens) => {
        if (itErr) return reject(itErr);

        const carregarTefEVoltar = () => {
          db.get(
            "SELECT * FROM tef_transacoes WHERE venda_id = ? LIMIT 1",
            [vendaId],
            (tefErr, tef) => {
              if (tefErr) {
                console.error('Erro ao carregar TEF:', tefErr);
              }
              if (tef) {
                venda.tef = tef;
              }
              resolve({ venda, itens });
            }
          );
        };

        const carregarPagamentosComerciaisEVoltar = () => {
          // Valores pagos pelo cliente (visão comercial do DANFE)
          db.all(
            'SELECT forma_pagamento, valor FROM venda_pagamentos WHERE venda_id = ? ORDER BY id',
            [vendaId],
            (pgErr, pagamentosComerciais) => {
              if (pgErr) return reject(pgErr);
              venda.pagamentos_comerciais = pagamentosComerciais || [];
              if (
                (!Array.isArray(venda.pagamentos) || venda.pagamentos.length === 0)
                && venda.pagamentos_comerciais.length > 0
              ) {
                venda.pagamentos = venda.pagamentos_comerciais;
              }
              carregarTefEVoltar();
            }
          );
        };

        db.all(`
          SELECT
            forma_pagamento,
            valor,
            tipo_recebimento,
            tef_transacao_id,
            nsu,
            autorizacao
          FROM venda_recebimentos
          WHERE venda_id = ?
            AND status = 'aprovado'
          ORDER BY id
        `, [vendaId], (recErr, recebimentos) => {
          if (recErr) return reject(recErr);

          if (Array.isArray(recebimentos) && recebimentos.length > 0) {
            venda.pagamentos = recebimentos;
          }
          carregarPagamentosComerciaisEVoltar();
        });
      });
    });
  });
}

function salvarNota(payload) {
  return new Promise((resolve, reject) => {
    db.get(`
      SELECT id
      FROM nfce_notas
      WHERE 
        (chave_acesso = ? AND chave_acesso IS NOT NULL AND chave_acesso <> '')
        OR (
          venda_id = ?
          AND numero = ?
          AND serie = ?
          AND ambiente = ?
        )
      ORDER BY id DESC
      LIMIT 1
    `, [
      payload.chave_acesso || '',
      payload.venda_id,
      payload.numero,
      payload.serie,
      payload.ambiente
    ], (selectErr, existente) => {
      if (selectErr) return reject(selectErr);

      if (existente) {
        db.run(`
          UPDATE nfce_notas
          SET
            status = ?,
            chave_acesso = COALESCE(NULLIF(?, ''), chave_acesso),
            xml_enviado = ?,
            xml_retorno = ?,
            protocolo = ?,
            recibo = ?,
            qr_code_url = ?,
            danfe_html = ?,
            updated_at = datetime('now', 'localtime')
          WHERE id = ?
        `, [
          payload.status,
          payload.chave_acesso || '',
          payload.xml_enviado || null,
          payload.xml_retorno || null,
          payload.protocolo || null,
          payload.recibo || null,
          payload.qr_code_url || null,
          payload.danfe_html || null,
          existente.id
        ], function(updateErr) {
          if (updateErr) return reject(updateErr);
          resolve(existente.id);
        });

        return;
      }

      db.run(`
        INSERT INTO nfce_notas (
          venda_id, numero, serie, chave_acesso, ambiente, status,
          xml_enviado, xml_retorno, protocolo, recibo, qr_code_url, danfe_html,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
      `, [
        payload.venda_id,
        payload.numero,
        payload.serie,
        payload.chave_acesso,
        payload.ambiente,
        payload.status,
        payload.xml_enviado || null,
        payload.xml_retorno || null,
        payload.protocolo || null,
        payload.recibo || null,
        payload.qr_code_url || null,
        payload.danfe_html || null
      ], function(err) {
        if (err) return reject(err);
        resolve(this.lastID);
      });
    });
  });
}

// Tentativas que nunca chegaram à SEFAZ ou foram rejeitadas sem registro: o nNF continua livre.
const STATUS_TENTATIVA_NUMERO_LIVRE = new Set(['configuracao_pendente', 'erro_validacao', 'rejeitada']);
// Tentativas que podem ter sido processadas pela SEFAZ: exigem consulta da chave antes de retransmitir.
const STATUS_TENTATIVA_POSSIVEL_PROCESSAMENTO = new Set(['pendente', 'soap_enviado', 'erro_transmissao', 'timeout']);
const STATUS_TENTATIVA_REUTILIZAVEL = [...STATUS_TENTATIVA_NUMERO_LIVRE, ...STATUS_TENTATIVA_POSSIVEL_PROCESSAMENTO];

const MSG_RECUPERAR_DUPLICIDADE =
  'Use "Recuperar duplicidades" no Fechamento Fiscal do Dia para consultar a situação na SEFAZ.';

function identidadeTentativa(nota) {
  return {
    notaId: nota && nota.id != null ? Number(nota.id) : null,
    numero: nota && nota.numero != null ? Number(nota.numero) : null,
    serie: nota && nota.serie != null ? Number(nota.serie) : null,
    chaveAcesso: (nota && nota.chave_acesso) || null
  };
}

async function avaliarBloqueioPorSituacaoFiscal(vendaId) {
  const {
    classificarSituacaoFiscalDaVenda,
    SITUACAO_NFCE
  } = require('../fechamento-fiscal/NfceSituacaoFiscalService');
  const situacao = await classificarSituacaoFiscalDaVenda(db, vendaId);
  const base = {
    success: false,
    notaId: situacao.nfce_id,
    numero: situacao.numero != null ? Number(situacao.numero) : null,
    serie: situacao.serie != null ? Number(situacao.serie) : null,
    chaveAcesso: situacao.chave_acesso || null,
    situacaoFiscal: situacao.situacao
  };

  if (situacao.situacao === SITUACAO_NFCE.DUPLICIDADE_PENDENTE) {
    return {
      ...base,
      status: 'duplicidade_pendente_consulta',
      message: `NFC-e nº ${base.numero} série ${base.serie} recebeu duplicidade (cStat 539) e a situação na SEFAZ ainda não foi confirmada. Nenhum novo número será gerado. ${MSG_RECUPERAR_DUPLICIDADE}`
    };
  }

  if (situacao.origem_classificacao !== 'RECUPERACAO_DUPLICIDADE') return null;

  if (situacao.situacao === SITUACAO_NFCE.AUTORIZADA) {
    return {
      ...base,
      status: 'autorizada_na_sefaz',
      protocolo: situacao.protocolo || null,
      message: `A consulta fiscal localizou NFC-e autorizada na SEFAZ para o número ${base.numero} série ${base.serie}. Nenhuma nova NFC-e será emitida para esta venda.`
    };
  }

  if ([SITUACAO_NFCE.PENDENTE, SITUACAO_NFCE.ERRO, SITUACAO_NFCE.DESCONHECIDA].includes(situacao.situacao)) {
    return {
      ...base,
      status: 'duplicidade_pendente_consulta',
      message: `A consulta da duplicidade da NFC-e nº ${base.numero} série ${base.serie} não foi conclusiva. Nenhum novo número será gerado. ${MSG_RECUPERAR_DUPLICIDADE}`
    };
  }

  return null;
}

function atualizarNotaAutorizadaPorConsulta(notaId, { protocolo, xmlRetorno }) {
  return new Promise((resolve, reject) => {
    db.run(`
      UPDATE nfce_notas
      SET status = 'autorizada',
          protocolo = ?,
          xml_retorno = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `, [protocolo, xmlRetorno, notaId], (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Tentativa anterior possivelmente processada (timeout/comunicação): consulta a chave
 * antes de qualquer retransmissão. Só libera retransmitir com o mesmo nNF quando a SEFAZ
 * confirma que a chave não consta (cStat 217).
 */
async function verificarSituacaoTentativaAnterior({ nota, config }) {
  const {
    interpretarRespostaConsulta
  } = require('../fechamento-fiscal/NfceDuplicidadeRecuperacaoService');
  const { SITUACAO_NFCE } = require('../fechamento-fiscal/NfceSituacaoFiscalService');
  const identidade = identidadeTentativa(nota);
  const chave = String(nota.chave_acesso || '').replace(/\D/g, '');

  if (chave.length !== 44) {
    return {
      bloqueio: {
        success: false,
        ...identidade,
        status: 'consulta_situacao_pendente',
        message: `A tentativa anterior da NFC-e nº ${identidade.numero} série ${identidade.serie} não tem chave de acesso registrada; não é possível confirmar a situação na SEFAZ. Nenhum novo número foi gerado.`
      }
    };
  }

  let consulta = null;
  let decisao;
  try {
    consulta = await consultarProtocolo({
      chave,
      modelo: ModelType.NFCE,
      ambiente: nota.ambiente || config.ambiente,
      cUF: config.codigoUf,
      certificadoPath: config.certificadoPath,
      certificadoSenha: config.certificadoSenha
    });
    decisao = interpretarRespostaConsulta(consulta);
  } catch (err) {
    decisao = {
      situacao_fiscal: SITUACAO_NFCE.ERRO,
      motivo: 'Não foi possível consultar a situação fiscal.',
      erro_tecnico: String((err && err.message) || err)
    };
  }

  console.log(
    `[FISCAL][NUMERACAO][NFCe] CONSULTA_TENTATIVA NUMERO=${identidade.numero} SERIE=${identidade.serie} SITUACAO=${decisao.situacao_fiscal} CSTAT=${decisao.cstat_consulta || ''}`
  );

  const chaveRetornada = String(decisao.chave_retornada || '').replace(/\D/g, '');
  if (decisao.situacao_fiscal === SITUACAO_NFCE.AUTORIZADA && (!chaveRetornada || chaveRetornada === chave)) {
    await atualizarNotaAutorizadaPorConsulta(nota.id, {
      protocolo: decisao.protocolo,
      xmlRetorno: (consulta && consulta.body) || null
    });
    return {
      autorizada: {
        success: true,
        reused: true,
        recuperadaPorConsulta: true,
        status: 'autorizada',
        ...identidade,
        protocolo: decisao.protocolo,
        qrCodeUrl: nota.qr_code_url || null,
        danfeHtml: nota.danfe_html || null,
        message: 'NFC-e da tentativa anterior já estava autorizada na SEFAZ; nenhuma nova emissão foi feita.'
      }
    };
  }

  if (decisao.situacao_fiscal === SITUACAO_NFCE.REJEITADA) {
    return { liberada: true, cStat: decisao.cstat_consulta || null };
  }

  return {
    bloqueio: {
      success: false,
      ...identidade,
      status: 'consulta_situacao_pendente',
      cStat: decisao.cstat_consulta || null,
      message: `Situação da NFC-e nº ${identidade.numero} série ${identidade.serie} ainda não confirmada na SEFAZ (${decisao.motivo || 'sem resposta conclusiva'}). Nenhum novo número foi gerado; tente novamente em instantes.`
    }
  };
}

async function emitirPorVendaId(vendaId) {
  const escopo = `nfce-venda:${Number(vendaId) || 0}`;
  if (lockAtivo(escopo)) {
    const err = new Error('Emissão NFC-e desta venda já está em andamento. Aguarde a conclusão.');
    err.code = 'EMISSAO_EM_ANDAMENTO';
    err.statusCode = 409;
    throw err;
  }

  return withLock(escopo, async () => {
    console.log('ENTROU NO EMISSOR FISCAL');
    const { venda, itens } = await carregarVenda(vendaId);

    if (
      venda.status_pagamento &&
      venda.status_pagamento !== 'quitada'
    ) {
      return {
        success: false,
        status: 'aguardando_pagamento',
        message: 'Venda ainda não está totalmente quitada.'
      };
    }

    const itensFiscal = itens.filter(itemEntraNaNfce);
    const itensDanfe = itens;

    if (itensFiscal.length === 0) {
      return {
        success: true,
        status: 'sem_itens_fiscais',
        message: 'Venda sem itens fiscais. NFC-e não necessária.'
      };
    }

    const notaAutorizada = await new Promise((resolve, reject) => {
      db.get(`
        SELECT *
        FROM nfce_notas
        WHERE venda_id = ?
          AND status = 'autorizada'
        ORDER BY id DESC
        LIMIT 1
      `, [vendaId], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

    if (notaAutorizada) {
      return {
        success: true,
        reused: true,
        status: notaAutorizada.status,
        notaId: notaAutorizada.id,
        numero: notaAutorizada.numero,
        chaveAcesso: notaAutorizada.chave_acesso,
        danfeHtml: notaAutorizada.danfe_html
      };
    }

    const bloqueioSituacao = await avaliarBloqueioPorSituacaoFiscal(vendaId);
    if (bloqueioSituacao) {
      console.warn(
        `[FISCAL][NUMERACAO][NFCe] EMISSAO_BLOQUEADA VENDA=${vendaId} STATUS=${bloqueioSituacao.status} NUMERO=${bloqueioSituacao.numero} SERIE=${bloqueioSituacao.serie}`
      );
      return bloqueioSituacao;
    }

    const notaPendenteAnterior = await new Promise((resolve, reject) => {
      const placeholders = STATUS_TENTATIVA_REUTILIZAVEL.map(() => '?').join(', ');
      db.get(`
        SELECT *
        FROM nfce_notas
        WHERE venda_id = ?
          AND status IN (${placeholders})
        ORDER BY id DESC
        LIMIT 1
      `, [vendaId, ...STATUS_TENTATIVA_REUTILIZAVEL], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

    const config = await getFiscalConfig();

    let numero;
    let serieEmissao = Number(config.serie);
    let cNFTentativa = null;

    const reutilizarTentativa = Boolean(
      notaPendenteAnterior
      && notaPendenteAnterior.numero
      && Number(notaPendenteAnterior.ambiente) === Number(config.ambiente)
    );

    if (reutilizarTentativa) {
      // Mesma tentativa: preserva nNF, série e cNF (mesma chave dentro do mês de emissão).
      numero = Number(notaPendenteAnterior.numero);
      serieEmissao = Number(notaPendenteAnterior.serie || config.serie);
      const idAnterior = parseChaveNfce(notaPendenteAnterior.chave_acesso);
      if (idAnterior && Number(idAnterior.numero) === numero && Number(idAnterior.serie) === serieEmissao) {
        cNFTentativa = idAnterior.cNF;
      }
      console.log(
        `[FISCAL][NUMERACAO][NFCe] REUTILIZANDO identidade da tentativa anterior NUMERO=${numero} SERIE=${serieEmissao} STATUS=${notaPendenteAnterior.status}`
      );

      if (STATUS_TENTATIVA_POSSIVEL_PROCESSAMENTO.has(String(notaPendenteAnterior.status))) {
        const verificacao = await verificarSituacaoTentativaAnterior({ nota: notaPendenteAnterior, config });
        if (verificacao.autorizada) return verificacao.autorizada;
        if (verificacao.bloqueio) return verificacao.bloqueio;
      }
    } else {
      const reserva = await reservarProximaNumeracaoFiscal({
        cnpj: config.cnpj,
        ambiente: config.ambiente,
        modelo: '65',
        serie: config.serie,
        origem: 'VENDA'
      });
      numero = reserva.numero;
      serieEmissao = Number(reserva.serie || config.serie);
      console.log(`[FISCAL][NUMERACAO][RESERVA] ORIGEM=VENDA NUMERO=${numero} SERIE=${serieEmissao}`);
    }

    const configEmissao = { ...config, serie: serieEmissao };

    if (!config.nomeEmpresa || !config.cnpj || !config.ie) {
      const notaId = await salvarNota({
        venda_id: vendaId,
        numero,
        serie: configEmissao.serie,
        chave_acesso: '',
        ambiente: config.ambiente,
        status: 'configuracao_pendente',
        xml_retorno: 'Preencha nome da empresa, CNPJ e IE nas configurações.'
      });

      return {
        success: false,
        notaId,
        status: 'configuracao_pendente',
        message: 'Configuração fiscal incompleta.'
      };
    }

    if (!config.certificadoPath || !fs.existsSync(config.certificadoPath)) {
      const caminhoInfo = config.certificadoPath || '(não informado)';

      const notaId = await salvarNota({
        venda_id: vendaId,
        numero,
        serie: configEmissao.serie,
        chave_acesso: '',
        ambiente: config.ambiente,
        status: 'configuracao_pendente',
        xml_retorno: `Certificado A1/PFX não encontrado em: ${caminhoInfo}`
      });

      return {
        success: false,
        notaId,
        status: 'configuracao_pendente',
        message: `Certificado A1/PFX não encontrado em: ${caminhoInfo}`
      };
    }

    const errosFiscais =
      validarItensFiscal(
        itensFiscal,
        config.ambiente
      );
    if (errosFiscais.length > 0) {
      console.warn('Avisos fiscais (homologação):', errosFiscais.join('; '));
    }

    // RC5 — validação de equipamentos via IntegrationService (consulta Heartbeat pela fachada).
    try {
      const { modulos } = require('../equipamentos-integracao');
      const ids = String(process.env.FISCAL_EQUIPAMENTOS_OBRIGATORIOS || '')
        .split(',')
        .map((s) => Number(String(s).trim()))
        .filter(Boolean);
      if (ids.length) {
        const check = await modulos.fiscal.antesDaEmissao(
          { perfil: 'SUPER_ADMIN' },
          { equipamento_ids: ids }
        );
        if (!check.ok) {
          console.warn('[RC5] Equipamentos indisponíveis na emissão:', JSON.stringify(check.indisponiveis));
          if (process.env.FISCAL_BLOQUEAR_SEM_EQUIPAMENTO === '1') {
            return {
              success: false,
              status: 'equipamento_indisponivel',
              message: 'Equipamentos obrigatórios indisponíveis para emissão.',
              indisponiveis: check.indisponiveis
            };
          }
        }
      }
    } catch (eqErr) {
      console.warn('[RC5] validação equipamentos fiscal:', eqErr.message);
    }

    const xmlBase = buildNfceXml({
      config: configEmissao,
      venda,
      itens: itensFiscal,
      numero,
      cNF: cNFTentativa
    });

    // RC7.10.4 — aborta emissão se XML inconsistente (antes da assinatura)
    try {
      validarXmlFiscal({
        xml: xmlBase.xmlSemAssinatura,
        fase: 'pre_assinatura',
        modeloDoc: '65',
        validarXsd: false
      });
    } catch (validErr) {
      const notaId = await salvarNota({
        venda_id: vendaId,
        numero,
        serie: configEmissao.serie,
        chave_acesso: xmlBase.chave || '',
        ambiente: config.ambiente,
        status: 'erro_validacao',
        xml_enviado: xmlBase.xmlSemAssinatura,
        xml_retorno: String(validErr.message || validErr)
      });
      return {
        success: false,
        notaId,
        status: 'erro_validacao',
        message: validErr.message || 'XML fiscal inconsistente.',
        code: validErr.code || 'XML_INVALIDO',
        detalhes: validErr.detalhes || null
      };
    }

    let xmlAssinadoFinal = null;
    let qrCodeUrl = '';
    let assinaturaErro = null;
    let certificado = null;

    try {
      salvarDebug('01-xml-nfe-original.xml', xmlBase.xmlSemAssinatura);

      certificado = carregarCertificadoPfx(config.certificadoPath, config.certificadoSenha);

      console.log('ANTES DE CHAMAR assinarNFe');
      console.log('TIPO xmlNfe:', typeof xmlBase.xmlSemAssinatura);
      console.log('TAMANHO xmlNfe:', xmlBase.xmlSemAssinatura ? xmlBase.xmlSemAssinatura.length : 0);
      console.log('CHAVE PRIVADA OK:', !!certificado.privateKeyPem);
      console.log('CERT PEM OK:', !!certificado.certPem);

      salvarDebug('01b-antes-assinatura.txt', [
        `TIPO xmlNfe: ${typeof xmlBase.xmlSemAssinatura}`,
        `TAMANHO xmlNfe: ${xmlBase.xmlSemAssinatura ? xmlBase.xmlSemAssinatura.length : 0}`,
        `CHAVE PRIVADA OK: ${!!certificado.privateKeyPem}`,
        `CERT PEM OK: ${!!certificado.certPem}`
      ].join('\n'));

      const xmlParaAssinar = compactarXml(xmlBase.xmlSemAssinatura);
      salvarDebug('01a-xml-nfe-compactado-antes-assinatura.xml', xmlParaAssinar);

      const assinatura = assinarNFe(
        xmlParaAssinar,
        certificado.privateKeyPem,
        certificado.certPem
      );

      console.log('DEPOIS DE CHAMAR assinarNFe');
      console.log('TAMANHO xmlAssinado:', assinatura.xmlAssinado ? assinatura.xmlAssinado.length : 0);

      salvarDebug('01c-depois-assinatura.txt', [
        `TAMANHO xmlAssinado: ${assinatura.xmlAssinado ? assinatura.xmlAssinado.length : 0}`,
        `DigestValue: ${assinatura.digestValue || ''}`
      ].join('\n'));

      const consultaUrlQr = String(config.urls?.consultaQr || '').trim();
      if (!consultaUrlQr) {
        throw new Error(
          Number(config.ambiente) === 1
            ? 'URL de consulta QR Code em PRODUÇÃO não configurada (fiscal_csc_qrcode_url_producao).'
            : 'URL de consulta QR Code em HOMOLOGAÇÃO não configurada (fiscal_csc_qrcode_url_homologacao).'
        );
      }

      qrCodeUrl = gerarQRCodeNFCe({
        chave: xmlBase.chave,
        ambiente: config.ambiente,
        idCSC: config.idCSC,
        CSC: config.tokenCSC,
        consultaUrl: consultaUrlQr,
        uf: config.uf
      });

      const urlConsulta = String(config.urls?.consultaChave || '').trim();
      if (!urlConsulta) {
        throw new Error(
          Number(config.ambiente) === 1
            ? 'URL de consulta por chave em PRODUÇÃO não configurada (fiscal_consulta_chave_url_producao).'
            : 'URL de consulta por chave em HOMOLOGAÇÃO não configurada (fiscal_consulta_chave_url_homologacao).'
        );
      }

      const infNFeSupl = `<infNFeSupl><qrCode><![CDATA[${qrCodeUrl}]]></qrCode><urlChave>${urlConsulta}</urlChave></infNFeSupl>`;

      // Inserir infNFeSupl antes da assinatura (que deve vir apos infNFe)
      const signatureMatch = assinatura.xmlAssinado.match(/(<Signature[\s>])/);
      if (signatureMatch) {
        xmlAssinadoFinal = assinatura.xmlAssinado.replace(signatureMatch[0], `${infNFeSupl}${signatureMatch[0]}`);
      } else {
        // Fallback: adicionar antes de </NFe>
        xmlAssinadoFinal = assinatura.xmlAssinado.replace('</NFe>', `${infNFeSupl}</NFe>`);
      }

      salvarDebug('02-xml-nfe-assinado.xml', assinatura.xmlAssinado);
      salvarDebug('02b-qrcode-url.txt', qrCodeUrl);
      salvarDebug('02c-infNFeSupl.xml', infNFeSupl);
      salvarDebug('02d-xml-nfe-assinado-final.xml', xmlAssinadoFinal);

      if (!xmlAssinadoFinal.includes('<Signature')) {
        throw new Error('XML final ficou sem Signature.');
      }

      console.log('XML final length:', xmlAssinadoFinal.length);
      console.log('XML includes infNFeSupl:', xmlAssinadoFinal.includes('<infNFeSupl>'));
      console.log('XML includes infNFeSupl xmlns:', xmlAssinadoFinal.includes('<infNFeSupl xmlns'));
      if (!xmlAssinadoFinal.includes('<infNFeSupl')) {
        throw new Error('XML final ficou sem infNFeSupl.');
      }

      if (!xmlAssinadoFinal.includes('<qrCode>') && !xmlAssinadoFinal.includes('<qrCode><![CDATA[')) {
        throw new Error('XML final ficou sem qrCode.');
      }
    } catch (error) {
      assinaturaErro = error;

      salvarDebug(
        '99-erro-assinatura-emissor.txt',
        error && error.stack ? error.stack : String(error)
      );

      console.error('ERRO FINAL CAPTURADO NO EMISSOR:', error);
    }

    const cupomOficial = await renderCupomNfceOficial({
      venda: {
        ...venda,
        tpAmb: config.ambiente
      },
      itens: itensDanfe,
      itensFiscal,
      empresa: {
        nome: config.nomeEmpresa,
        nomeFantasia: config.nomeFantasia || config.nomeEmpresa,
        razaoSocial: config.razaoSocial || config.nomeEmpresa,
        cnpj: config.cnpj,
        endereco: config.endereco,
        telefone: config.telefone,
        logradouro: config.logradouro,
        numero: config.numeroEndereco,
        bairro: config.bairro,
        municipio: config.municipioNome,
        uf: config.uf,
        cep: config.cep,
        larguraMm: config.danfeLarguraMm || 80
      },
      chave: xmlBase.chave,
      numero,
      serie: configEmissao.serie,
      qrCodeUrl,
      tributos: xmlBase.valores,
      nota: {
        tpAmb: config.ambiente
      }
    });
    const danfeHtml = cupomOficial.html;

    let status = assinaturaErro ? 'configuracao_pendente' : 'pendente';
    let xmlRetorno = assinaturaErro ? assinaturaErro.message : null;
    let soapResponse = null;
    let chaveAutorizada = xmlBase.chave;
    let duplicidade = null;

    if (!assinaturaErro) {
      const loteXml = montarLote(xmlAssinadoFinal, String(numero));

      // Sprint F10 — transporte via Plataforma Fiscal (fallback automático para legado)
      const envio = await enviarAutorizacao({
        url: config.urls.autorizacao,
        loteXml,
        ambiente: config.ambiente,
        cUF: config.codigoUf || '23',
        versaoDados: '4.00',
        certificadoPath: config.certificadoPath,
        certificadoSenha: config.certificadoSenha
      });

      soapResponse = {
        success: envio.success,
        status: envio.status || (envio.success ? 'soap_enviado' : 'erro_transmissao'),
        raw: envio.raw || envio.body || null,
        message: envio.message || envio.error || null,
        code: envio.code || null,
        source: envio.source,
        fallbackUtilizado: envio.fallbackUtilizado,
        endpoint: envio.endpoint,
        cStat: envio.cStat,
        resultado: envio.resultado
      };

      salvarDebug('05-soap-resposta.json', JSON.stringify(soapResponse, null, 2));
      salvarDebug('06-soap-retorno.xml', String(soapResponse.raw || soapResponse.message || ''));

      const raw = String(soapResponse.raw || soapResponse.message || '');

      if (raw.includes('<cStat>100</cStat>')) {
        status = 'autorizada';

        const authSefaz = extrairChaveEProtocoloAutorizados(raw);
        if (authSefaz?.chaveAcesso) {
          chaveAutorizada = authSefaz.chaveAcesso;
        }

        const protMatch = raw.match(/<nProt>(.*?)<\/nProt>/);
        if (protMatch) {
          soapResponse.protocolo = protMatch[1];
        } else if (authSefaz?.protocolo) {
          soapResponse.protocolo = authSefaz.protocolo;
        }
      } else if (raw.includes('<cStat>539</cStat>') || String(soapResponse.cStat || '') === '539') {
        status = 'rejeitada_duplicidade';
        const xMotivosRetorno = [...raw.matchAll(/<xMotivo>\s*([^<]+)\s*<\/xMotivo>/gi)].map((m) => m[1].trim());
        const xMotivo539 = xMotivosRetorno.find((m) => /duplicidade/i.test(m)) || xMotivosRetorno[0] || null;
        duplicidade = {
          cStat: '539',
          xMotivo: xMotivo539,
          numero,
          serie: configEmissao.serie,
          chaveEnviada: xmlBase.chave,
          chaveSefaz: extrairChaveConflito539(xMotivo539, raw)
        };
        try {
          await aplicarOcupacaoPorRejeicao539Nfce({
            cnpj: config.cnpj,
            ambiente: config.ambiente,
            serie: configEmissao.serie,
            numeroEnviado: numero,
            chaveEnviada: xmlBase.chave,
            xMotivo: xMotivo539,
            xmlRetorno: raw,
            cStat: '539'
          });
        } catch (e539) {
          console.warn('[FISCAL][NUMERACAO][539] falha ao registrar ocupação:', e539.message || e539);
        }
      } else if (/<cStat>(103|105|204)<\/cStat>/.test(raw) && !/<protNFe[\s>]/.test(raw)) {
        // Lote em processamento ou chave já existente na SEFAZ: a situação depende de consulta.
        status = 'pendente';
      } else if (raw.includes('<cStat>') || /rejeic/i.test(raw)) {
        status = 'rejeitada';
      } else {
        status = soapResponse.status || 'pendente';
      }

      xmlRetorno = raw || null;
    }

    const notaId = await salvarNota({
      venda_id: vendaId,
      numero,
      serie: configEmissao.serie,
      chave_acesso: chaveAutorizada,
      ambiente: config.ambiente,
      status,
      xml_enviado: xmlAssinadoFinal,
      xml_retorno: xmlRetorno,
      protocolo: soapResponse?.protocolo || null,
      qr_code_url: qrCodeUrl,
      danfe_html: danfeHtml
    });

    const autorizada = status === 'autorizada';
    let message = null;

    if (assinaturaErro) {
      message = assinaturaErro.message;
    } else if (duplicidade) {
      message = `NFC-e nº ${numero} série ${configEmissao.serie} rejeitada por duplicidade (cStat 539): o número já existe na SEFAZ com outra chave de acesso. Nenhuma nova numeração será gerada automaticamente. ${MSG_RECUPERAR_DUPLICIDADE}`;
    } else if (!autorizada) {
      const infProt = (String(xmlRetorno || '').match(/<infProt[\s\S]*?<\/infProt>/i) || [])[0] || '';
      const cStatProt = (infProt.match(/<cStat>\s*(\d+)\s*<\/cStat>/i) || [])[1];
      const xMotivoProt = (infProt.match(/<xMotivo>\s*([^<]+?)\s*<\/xMotivo>/i) || [])[1];
      message = cStatProt
        ? `NFC-e nº ${numero} série ${configEmissao.serie} rejeitada pela SEFAZ (cStat ${cStatProt}): ${xMotivoProt || 'sem motivo informado'}`
        : (soapResponse?.message || `NFC-e não autorizada (status: ${status}).`);
    }

    return {
      success: autorizada,
      notaId,
      status,
      numero,
      serie: configEmissao.serie,
      chaveAcesso: chaveAutorizada,
      qrCodeUrl,
      danfeHtml,
      message,
      duplicidade,
      soap: soapResponse
    };
  }, { titular: `venda-${vendaId}` });
}

/**
 * Regenera o DANFE com pagamentos atuais (F+NF),
 * para a impressão não ficar presa ao HTML gerado só com a fatia fiscal.
 */
async function obterDanfeHtmlAtualizado(vendaId) {
  const id = Number(vendaId);
  if (!id) {
    throw new Error('Venda inválida para DANFE.');
  }

  const nota = await new Promise((resolve, reject) => {
    db.get(
      `SELECT *
       FROM nfce_notas
       WHERE venda_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [id],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });

  if (!nota) {
    throw new Error('NFC-e não encontrada para esta venda.');
  }

  const { venda, itens } = await carregarVenda(id);
  const config = await getFiscalConfig();
  const ambiente = Number(nota.ambiente || config.ambiente || 1);

  const payloadDanfe = {
    venda: {
      ...venda,
      tpAmb: ambiente
    },
    itens,
    itensFiscal: (itens || []).filter(itemEntraNaNfce),
    empresa: {
      nome: config.nomeEmpresa,
      nomeFantasia: config.nomeFantasia || config.nomeEmpresa,
      razaoSocial: config.razaoSocial || config.nomeEmpresa,
      cnpj: config.cnpj,
      endereco: config.endereco,
      telefone: config.telefone,
      logradouro: config.logradouro,
      numero: config.numeroEndereco,
      bairro: config.bairro,
      municipio: config.municipioNome,
      uf: config.uf,
      cep: config.cep,
      larguraMm: config.danfeLarguraMm || 80
    },
    chave: nota.chave_acesso,
    numero: nota.numero,
    serie: nota.serie || config.serie,
    qrCodeUrl: nota.qr_code_url || '',
    tributos: null,
    nota: {
      tpAmb: ambiente,
      protocolo: nota.protocolo || null,
      data_autorizacao: nota.updated_at || nota.created_at || null
    }
  };

  const cupomOficial = await renderCupomNfceOficial(payloadDanfe);
  const danfeHtml = cupomOficial.html;

  if (nota.id && danfeHtml) {
    db.run(
      `UPDATE nfce_notas
       SET danfe_html = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ?`,
      [danfeHtml, nota.id],
      (err) => {
        if (err) console.error('Erro ao atualizar danfe_html:', err.message);
      }
    );
  }

  return {
    html: danfeHtml,
    htmlTermico: danfeHtml,
    textoTermico: cupomOficial.texto,
    nota
  };
}

async function renderCupomNfceOficial(payload) {
  const dadosDanfe = await montarDadosDanfe(payload);
  const termico = DanfeTermicoRenderer.gerar(dadosDanfe);
  return {
    html: termico.html,
    texto: termico.texto || ''
  };
}

module.exports = { emitirPorVendaId, obterDanfeHtmlAtualizado };