const fs = require('fs');
const path = require('path');
const db = require('../../database');
const { getFiscalConfig, incrementaNumeroFiscal, setConfiguracao } = require('./configService');
const { carregarCertificadoPfx } = require('./certificateService');
const {
  buildNfceXml
} = require('./xmlBuilder');
const { gerarQRCodeNFCe } = require('./qrcode');
const { assinarNFe } = require('./signer');
const { montarLote } = require('./soapClient');
const { enviarAutorizacao } = require('./autorizacaoRuntime');
const { compactarXml, extrairChaveEProtocoloAutorizados } = require('./utils');
const { validarItensFiscal } = require('./validadorFiscal');
const { validarXmlFiscal } = require('./validarXmlFiscal');
const { gerarDanfeHtml, montarDadosDanfe } = require('./danfe');
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

async function emitirPorVendaId(vendaId) {
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

  const notaPendenteAnterior = await new Promise((resolve, reject) => {
    db.get(`
      SELECT *
      FROM nfce_notas
      WHERE venda_id = ?
        AND status IN ('erro_transmissao', 'pendente', 'soap_enviado', 'rejeitada')
      ORDER BY id DESC
      LIMIT 1
    `, [vendaId], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });

  const config = await getFiscalConfig();

  let numero;

  if (notaPendenteAnterior && notaPendenteAnterior.numero) {
    numero = notaPendenteAnterior.numero;
    console.log(`REUTILIZANDO NÚMERO FISCAL DA TENTATIVA ANTERIOR: ${numero}`);
  } else {
    numero = await incrementaNumeroFiscal();
    console.log(`NÚMERO FISCAL GERADO: ${numero} (MAX no banco + 1)`);
  }

  if (!config.nomeEmpresa || !config.cnpj || !config.ie) {
    const notaId = await salvarNota({
      venda_id: vendaId,
      numero,
      serie: config.serie,
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
      serie: config.serie,
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

  const xmlBase = buildNfceXml({ config, venda, itens: itensFiscal, numero });

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
      serie: config.serie,
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

  const danfeHtml = await gerarDanfeHtml({
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
    serie: config.serie,
    qrCodeUrl,
    tributos: xmlBase.valores,
    nota: {
      tpAmb: config.ambiente
    }
  });

  let status = assinaturaErro ? 'configuracao_pendente' : 'pendente';
  let xmlRetorno = assinaturaErro ? assinaturaErro.message : null;
  let soapResponse = null;
  let chaveAutorizada = xmlBase.chave;

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
    } else if (raw.includes('<cStat>539</cStat>')) {
      status = 'rejeitada_duplicidade';

      const match = raw.match(/\[chNFe:(\d{44})\]/);

      if (match) {
        const chave = match[1];
        const numeroDuplicado = Number(chave.substring(25, 34));
        const proximo = numeroDuplicado + 1;

        await setConfiguracao('fiscal_numero_atual', String(proximo));

        console.warn(`Corrigido automaticamente para número ${proximo}`);
      }
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
    serie: config.serie,
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
  } else if (!autorizada) {
    message = soapResponse?.message || `NFC-e não autorizada (status: ${status}).`;
  }

  return {
    success: autorizada,
    notaId,
    status,
    numero,
    chaveAcesso: chaveAutorizada,
    qrCodeUrl,
    danfeHtml,
    message,
    soap: soapResponse
  };
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

  const dadosDanfe = await montarDadosDanfe(payloadDanfe);
  const danfeHtml = await gerarDanfeHtml(dadosDanfe);
  const termico = DanfeTermicoRenderer.gerar(dadosDanfe);

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
    htmlTermico: termico.html,
    textoTermico: termico.texto,
    nota
  };
}

module.exports = { emitirPorVendaId, obterDanfeHtmlAtualizado };