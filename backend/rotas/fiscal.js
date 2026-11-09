const express = require('express');
const router = express.Router();
const db = require('../database');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getFiscalConfig, setConfiguracao } = require('../services/fiscal/configService');
const { carregarCertificadoPfx } = require('../services/fiscal/certificateService');
const { emitirPorVendaId, obterDanfeHtmlAtualizado } = require('../services/fiscal/emissor');
const cancelarNfce = require('../services/fiscal/cancelarNfce');
const { appendXmlRetornoNfce } = require('../services/fiscal/xmlRetornoNfce');
const { gravarAuditoria } = require('../services/auditoria');
const { validarMotivoTexto } = require('../services/validacao/validarMotivoTexto');
const { getFiscalSubDir } = require('../services/fiscal/paths');
const {
  exportarContabilidade,
  limparExportacaoTemporaria
} = require('../services/fiscal/exportarContabilidadeService');
const { criarHandlerExportarContabilidade } = require('../services/fiscal/exportarContabilidadeHandler');

// Middleware para carregar perfil do usuário
function carregarPerfilUsuario(req, res, next) {
  if (!req.user || !req.user.id) {
    return next();
  }

  db.get(
    'SELECT id, username, role, COALESCE(perfil, \'USUARIO\') as perfil FROM usuarios WHERE id = ?',
    [req.user.id],
    (err, usuario) => {
      if (err || !usuario) {
        return next();
      }
      req.user.perfil = usuario.perfil;
      next();
    }
  );
}

const pastaCertificados = getFiscalSubDir('certificados');

function agoraLocalBrasil() {
  const agora = new Date();
  const dataBrasil = new Date(
    agora.toLocaleString('en-US', { timeZone: 'America/Fortaleza' })
  );
  const ano = dataBrasil.getFullYear();
  const mes = String(dataBrasil.getMonth() + 1).padStart(2, '0');
  const dia = String(dataBrasil.getDate()).padStart(2, '0');
  const hora = String(dataBrasil.getHours()).padStart(2, '0');
  const min = String(dataBrasil.getMinutes()).padStart(2, '0');
  const seg = String(dataBrasil.getSeconds()).padStart(2, '0');
  return `${ano}-${mes}-${dia} ${hora}:${min}:${seg}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, pastaCertificados);
  },
  filename: (req, file, cb) => {
    cb(null, 'certificado.pfx');
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext !== '.pfx') {
      return cb(new Error('Envie apenas arquivo .pfx'));
    }

    cb(null, true);
  }
});

router.post('/certificado/upload', upload.single('certificado'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum certificado enviado.' });
    }

    const caminhoCompleto = path.resolve(pastaCertificados, 'certificado.pfx');

    await setConfiguracao(
      'fiscal_certificado_path',
      caminhoCompleto,
      'string',
      'Caminho interno do certificado A1'
    );

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'fiscal',
      acao: 'upload_certificado',
      referencia_tipo: 'certificado',
      referencia_id: null,
      detalhes: { path: caminhoCompleto, ip: req.ip || null },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de certificado:', auditErr));

    res.json({
      success: true,
      message: 'Certificado enviado com sucesso.',
      path: caminhoCompleto
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/config', async (req, res) => {
  try {
    const config = await getFiscalConfig({ validarUrls: false });
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/config', carregarPerfilUsuario, async (req, res) => {
  try {
    const payload = req.body || {};

    // Validação do número NFC-e
    if (payload.fiscal_numero_atual !== undefined) {
      const numeroAtual = parseInt(payload.fiscal_numero_atual);

      if (numeroAtual < 0) {
        return res.status(400).json({
          error: 'Número NFC-e inválido'
        });
      }

      // Proteção: apenas SUPER_ADMIN pode alterar numeração NFC-e
      const usuario = req.user || {};
      if (usuario.perfil !== 'SUPER_ADMIN') {
        gravarAuditoria({
          usuario_id: usuario.id || null,
          usuario_nome: usuario.username || usuario.nome || null,
          modulo: 'fiscal',
          acao: 'tentativa_alterar_numeracao_nfce_negada',
          referencia_tipo: 'nfce',
          referencia_id: null,
          detalhes: {
            numero_solicitado: numeroAtual,
            perfil: usuario.perfil || null,
            ip: req.ip || null
          },
          ip_requisicao: req.ip || null
        }).catch((auditErr) => console.error('Erro ao gravar auditoria fiscal:', auditErr));
        return res.status(403).json({
          error: 'Apenas SUPER ADMIN pode alterar a numeração NFC-e.'
        });
      }

      gravarAuditoria({
        usuario_id: usuario.id || null,
        usuario_nome: usuario.username || usuario.nome || null,
        modulo: 'fiscal',
        acao: 'alterar_numeracao_nfce',
        referencia_tipo: 'nfce',
        referencia_id: null,
        detalhes: { numero_atual: numeroAtual, ip: req.ip || null },
        ip_requisicao: req.ip || null
      }).catch((auditErr) => console.error('Erro ao gravar auditoria fiscal:', auditErr));
    }

    const proximoNfeUi = payload.proximoNumeroNfe != null && payload.proximoNumeroNfe !== ''
      ? parseInt(payload.proximoNumeroNfe, 10)
      : (payload.fiscal_numero_atual_nfe != null && payload.fiscal_numero_atual_nfe !== ''
        ? parseInt(payload.fiscal_numero_atual_nfe, 10)
        : null);
    if (payload.fiscal_serie_nfe !== undefined || proximoNfeUi != null) {
      const usuario = req.user || {};
      if (usuario.perfil !== 'SUPER_ADMIN') {
        return res.status(403).json({
          error: 'Apenas SUPER ADMIN pode alterar a numeração da NF-e modelo 55.'
        });
      }
      const { validarNumeracaoFiscal } = require('../services/fiscal/numeracaoFiscalService');
      try {
        validarNumeracaoFiscal({
          serie: payload.fiscal_serie_nfe != null ? payload.fiscal_serie_nfe : 1,
          proximoNumero: proximoNfeUi != null ? proximoNfeUi : 1
        });
      } catch (numErr) {
        return res.status(400).json({ error: numErr.message, code: numErr.code });
      }
      delete payload.proximoNumeroNfe;
      if (proximoNfeUi != null) payload.fiscal_numero_atual_nfe = String(proximoNfeUi);
    }

    const entries = Object.entries(payload);

    for (const [chave, valor] of entries) {
      await setConfiguracao(chave, String(valor ?? ''), 'string', `Configuração fiscal: ${chave}`);
    }

    if (payload.fiscal_numero_atual !== undefined) {
      try {
        const { salvarProximaNumeracaoFiscal } = require('../services/fiscal/numeracaoFiscalService');
        const cfgAtual = await getFiscalConfig({ validarUrls: false });
        await salvarProximaNumeracaoFiscal({
          cnpj: payload.cnpj || cfgAtual.cnpj,
          ambiente: payload.fiscal_ambiente || cfgAtual.ambiente,
          modelo: '65',
          serie: payload.fiscal_serie || cfgAtual.serie,
          proximoNumero: parseInt(payload.fiscal_numero_atual, 10) + 1
        });
      } catch (numErr) {
        return res.status(400).json({ error: numErr.message, code: numErr.code });
      }
    }

    if (payload.fiscal_serie_nfe !== undefined || payload.fiscal_numero_atual_nfe !== undefined) {
      try {
        const { salvarProximaNumeracaoFiscal } = require('../services/fiscal/numeracaoFiscalService');
        const cfgAtual = await getFiscalConfig({ validarUrls: false });
        await salvarProximaNumeracaoFiscal({
          cnpj: payload.cnpj || cfgAtual.cnpj,
          ambiente: payload.fiscal_ambiente || cfgAtual.ambiente,
          modelo: '55',
          serie: payload.fiscal_serie_nfe || cfgAtual.serieNfe,
          proximoNumero: payload.fiscal_numero_atual_nfe || cfgAtual.numeroAtualNfe
        });
      } catch (numErr) {
        return res.status(400).json({ error: numErr.message, code: numErr.code });
      }
    }

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'fiscal',
      acao: 'atualizar_config_fiscal',
      referencia_tipo: 'configuracao_fiscal',
      referencia_id: null,
      detalhes: { chaves: entries.map(([chave]) => chave), ip: req.ip || null },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria fiscal:', auditErr));

    res.json({ message: 'Configurações fiscais atualizadas com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/config/certificado/testar', async (req, res) => {
  try {
    const { certificadoPath, senha } = req.body;
    const certificado = carregarCertificadoPfx(certificadoPath, senha);
    res.json({
      success: true,
      certBase64Length: certificado.certBase64.length
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/emitir/venda/:vendaId', async (req, res) => {
  try {
    const vendaId = Number(req.params.vendaId);
    const resultado = await emitirPorVendaId(vendaId);

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'fiscal',
      acao: 'emitir_nfce',
      referencia_tipo: 'venda',
      referencia_id: vendaId,
      detalhes: {
        status: resultado?.status || null,
        nota_id: resultado?.notaId || resultado?.id || null,
        ip: req.ip || null
      },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de emissão NFC-e:', auditErr));

    res.json(resultado);
  } catch (error) {
    console.error('Erro ao emitir NFC-e:', error);
    res.json({
      success: false,
      status: 'erro_emissao',
      message: error?.message || 'Erro ao emitir NFC-e.'
    });
  }
});

router.get('/danfe/venda/:vendaId', async (req, res) => {
  const vendaId = Number(req.params.vendaId);

  try {
    const { html, htmlTermico, textoTermico } = await obterDanfeHtmlAtualizado(vendaId);
    const htmlOficial = /danfe-termico/.test(String(htmlTermico || ''))
      ? htmlTermico
      : (/danfe-termico/.test(String(html || '')) ? html : '');
    if (!htmlOficial) {
      return res.status(404).send('DANFE não gerado para esta NFC-e.');
    }

    const formato = String(req.query.formato || '').toLowerCase();
    const pacote = req.query.pacote === '1' || formato === 'pacote' || formato === 'json';

    if (pacote) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        html: htmlOficial,
        htmlTermico: htmlOficial,
        textoTermico: textoTermico || ''
      });
    }

    if (formato === 'termico') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(htmlOficial);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(htmlOficial);
  } catch (error) {
    console.error('Erro ao gerar DANFE atualizado:', error);
    const msg = error?.message || 'Erro interno ao buscar DANFE.';
    const status = /não encontrada/i.test(msg) ? 404 : 500;
    return res.status(status).send(msg);
  }
});

function extrairTagXml(xml, tag) {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, 'i');
  const match = String(xml || '').match(regex);
  return match ? match[1] : null;
}

function extrairCancelamentoSefaz(xml) {
  const texto = String(xml || '');
  const lotes = [...texto.matchAll(/<retEnvEvento[\s\S]*?<\/retEnvEvento>/gi)];
  const retornoAtual = lotes.length ? lotes[lotes.length - 1][0] : texto;
  const eventos = [...retornoAtual.matchAll(/<retEvento[\s\S]*?<\/retEvento>/gi)];
  const blocoEvento = eventos.length ? eventos[eventos.length - 1][0] : retornoAtual;

  return {
    cStatLote: extrairTagXml(retornoAtual, 'cStat'),
    xMotivoLote: extrairTagXml(retornoAtual, 'xMotivo'),
    cStatEvento: extrairTagXml(blocoEvento, 'cStat'),
    xMotivoEvento: extrairTagXml(blocoEvento, 'xMotivo'),
    protocoloCancelamento: extrairTagXml(blocoEvento, 'nProt'),
    dataCancelamento: extrairTagXml(blocoEvento, 'dhRegEvento')
  };
}

function dbRunAsync(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

router.post('/notas/:id/cancelar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { justificativa } = req.body || {};

    const validacaoJustificativa = validarMotivoTexto(justificativa);
    if (!validacaoJustificativa.valido) {
      return res.status(400).json({
        error: validacaoJustificativa.erro
      });
    }

    db.get(`
      SELECT *
      FROM nfce_notas
      WHERE id = ?
    `, [id], async (err, nota) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!nota) {
        return res.status(404).json({ error: 'NFC-e não encontrada.' });
      }

      // Sprint 08.3 — NFC-e do Fechamento (sem venda_id): cancelamento fiscal puro
      const origemFechamento = String(nota.origem || '') === 'fechamento_fiscal_dia'
        || (nota.fechamento_fiscal_id != null && !nota.venda_id);

      if (origemFechamento && !nota.venda_id) {
        try {
          const {
            cancelarDocumentoFiscalFechamento
          } = require('../services/fechamento-fiscal/NfceCancelamentoFechamentoService');

          const out = await cancelarDocumentoFiscalFechamento(db, id, justificativa.trim(), {
            usuario: {
              id: req.user?.id || null,
              nome: req.user?.username || req.user?.nome || null
            }
          });

          gravarAuditoria({
            usuario_id: req.user?.id || null,
            usuario_nome: req.user?.username || req.user?.nome || null,
            modulo: 'fiscal',
            acao: 'cancelar_nfce_fechamento',
            referencia_tipo: 'nfce',
            referencia_id: id,
            detalhes: {
              venda_id: null,
              fechamento_fiscal_id: nota.fechamento_fiscal_id || null,
              justificativa: justificativa.trim(),
              protocolo: out.protocoloCancelamento || null,
              idempotente: Boolean(out.idempotente),
              ip: req.ip || null
            },
            ip_requisicao: req.ip || null
          }).catch((auditErr) => console.error('Erro ao gravar auditoria cancelamento FF:', auditErr));

          return res.json(out);
        } catch (cancelFfErr) {
          const status = cancelFfErr.statusCode || 500;
          return res.status(status).json({
            success: false,
            error: cancelFfErr.message || 'Erro ao cancelar NFC-e do fechamento.',
            code: cancelFfErr.code || null,
            status: cancelFfErr.status || null,
            dadosCancelamento: cancelFfErr.dadosCancelamento || null,
            diagnostico: cancelFfErr.diagnostico || cancelFfErr.prazo || null
          });
        }
      }

      if (!nota.venda_id) {
        return res.status(400).json({
          error: 'NFC-e sem venda vinculada. Não é possível cancelar.'
        });
      }

      try {
        const claim = await dbRunAsync(db, `
          UPDATE nfce_notas
          SET status = 'cancelamento_em_andamento',
              updated_at = datetime('now', 'localtime')
          WHERE id = ?
            AND status IN ('autorizada', 'cancelamento_rejeitado')
            AND (
              (chave_acesso IS NOT NULL AND chave_acesso <> '')
              OR (xml_retorno IS NOT NULL AND xml_retorno LIKE '%<cStat>100</cStat>%')
            )
        `, [id]);

        if (claim.changes !== 1) {
          return res.status(409).json({
            success: false,
            error: 'NFC-e não está disponível para cancelamento ou já possui operação em andamento.',
            code: 'CONCORRENCIA'
          });
        }

        let cancelamento;
        try {
          cancelamento = await cancelarNfce.cancelarNfcePorId(
            id,
            justificativa.trim(),
            { db, cancelamentoClaimed: true }
          );
        } catch (cancelErr) {
          await dbRunAsync(db, `
            UPDATE nfce_notas
            SET status = 'cancelamento_desconhecido',
                updated_at = datetime('now', 'localtime')
            WHERE id = ? AND status = 'cancelamento_em_andamento'
          `, [id]).catch((persistErr) => {
            console.error('Falha ao bloquear NFC-e após erro de cancelamento:', persistErr);
          });
          return res.status(cancelErr.statusCode || 500).json({
            success: false,
            error: cancelErr.message || 'Resultado do cancelamento desconhecido.',
            code: cancelErr.code || 'RESULTADO_DESCONHECIDO',
            status: 'cancelamento_desconhecido'
          });
        }

        const retornoTexto = typeof cancelamento.sefaz === 'string'
          ? cancelamento.sefaz
          : JSON.stringify(cancelamento.sefaz);
        const confirmacao = cancelamento.confirmacaoCancelamento;
        const confirmadoPorConsulta = confirmacao?.confirmado === true;
        const retornoConsulta = String(confirmacao?.retornoXml || '');
        const retornoPersistido = [retornoTexto, retornoConsulta].filter(Boolean).join('\n');
        const dadosCancelamento = Object.assign(
          {},
          extrairCancelamentoSefaz(retornoTexto),
          confirmadoPorConsulta
            ? {
              cStatEvento: confirmacao.cStat,
              xMotivoEvento: confirmacao.xMotivo,
              protocoloCancelamento: confirmacao.protocolo,
              dataCancelamento: confirmacao.dataCancelamento
            }
            : {}
        );
        const cStatEvento = String(dadosCancelamento.cStatEvento || '');
        const loteProcessado = confirmadoPorConsulta
          || String(dadosCancelamento.cStatLote || '') === '128';
        const canceladoComSucesso = confirmadoPorConsulta
          || (loteProcessado && (cStatEvento === '135' || cStatEvento === '155'));
        const rejeicaoConhecida = !confirmadoPorConsulta
          && loteProcessado
          && ['501', '631'].includes(cStatEvento);
        const novoStatus = canceladoComSucesso
          ? 'cancelada'
          : (rejeicaoConhecida ? 'autorizada' : 'cancelamento_desconhecido');
        const retornoNfcePersistido = appendXmlRetornoNfce(nota.xml_retorno, retornoPersistido);

        const persistencia = await dbRunAsync(db, `
          UPDATE nfce_notas
          SET status = ?,
              xml_retorno = ?,
              updated_at = datetime('now', 'localtime')
          WHERE id = ? AND status = 'cancelamento_em_andamento'
        `, [novoStatus, retornoNfcePersistido, id]);

        if (persistencia.changes !== 1) {
          return res.status(409).json({
            success: false,
            error: 'O estado da NFC-e mudou durante a persistência; o cancelamento exige reconciliação.',
            code: 'PERSISTENCIA_CANCELAMENTO_INDETERMINADA',
            status: 'cancelamento_em_andamento'
          });
        }

        if (!canceladoComSucesso) {
          const desconhecido = novoStatus === 'cancelamento_desconhecido';
          return res.status(desconhecido ? 409 : 400).json({
            success: false,
            error: cStatEvento === '573'
              ? `cStat 573: a duplicidade não comprova o cancelamento; ${confirmacao?.motivo || 'o evento 110111 não foi validado oficialmente'}. A NFC-e permanece bloqueada para reconciliação.`
              : (dadosCancelamento.xMotivoEvento || (desconhecido
                ? 'Retorno fiscal desconhecido; a NFC-e foi bloqueada para nova tentativa.'
                : 'Cancelamento rejeitado pela SEFAZ.')),
            code: desconhecido
              ? (cStatEvento === '136'
                ? 'PENDENCIA_DOCUMENTAL_CSTAT_136'
                : (cStatEvento === '573' ? 'PENDENCIA_RECONCILIACAO_CSTAT_573' : 'RESULTADO_DESCONHECIDO'))
              : 'SEFAZ_REJEICAO',
            status: novoStatus,
            notaId: id,
            chaveAcesso: cancelamento.chaveAcesso,
            retorno: cancelamento.sefaz,
            dadosCancelamento
          });
        }

        res.json({
          success: true,
          message: 'NFC-e cancelada com sucesso.',
          status: novoStatus,
          notaId: id,
          chaveAcesso: cancelamento.chaveAcesso,
          protocoloCancelamento: dadosCancelamento.protocoloCancelamento,
          dataCancelamento: dadosCancelamento.dataCancelamento,
          retorno: cancelamento.sefaz,
          dadosCancelamento
        });

        gravarAuditoria({
          usuario_id: req.user?.id || null,
          usuario_nome: req.user?.username || req.user?.nome || null,
          modulo: 'fiscal',
          acao: 'cancelar_nfce',
          referencia_tipo: 'nfce',
          referencia_id: id,
          detalhes: {
            venda_id: nota.venda_id,
            justificativa: justificativa.trim(),
            protocolo: dadosCancelamento.protocoloCancelamento || null,
            ip: req.ip || null
          },
          ip_requisicao: req.ip || null
        }).catch((auditErr) => console.error('Erro ao gravar auditoria de cancelamento NFC-e:', auditErr));
      } catch (cancelErr) {
        return res.status(500).json({ error: cancelErr.message });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/notas/:id/reconciliar-cancelamento', async (req, res) => {
  try {
    const { reconciliarCancelamentoNfce } = require('../services/fiscal/NfceCancelamentoReconciliacaoService');
    const resultado = await reconciliarCancelamentoNfce(req.params.id, {
      db,
      confirmacaoConsulta: req.body?.confirmacao_consulta === true
    });

    gravarAuditoria({
      usuario_id: req.user?.id || null,
      usuario_nome: req.user?.username || req.user?.nome || null,
      modulo: 'fiscal',
      acao: 'reconciliar_cancelamento_nfce',
      referencia_tipo: 'nfce',
      referencia_id: resultado.notaId,
      detalhes: {
        chave_acesso: resultado.chaveAcesso,
        status: resultado.status,
        cstat_consulta: resultado.cStat,
        protocolo_consulta: resultado.protocolo || null,
        ip: req.ip || null
      },
      ip_requisicao: req.ip || null
    }).catch((auditErr) => console.error('Erro ao gravar auditoria de reconciliação NFC-e:', auditErr));

    return res.status(resultado.success ? 200 : 409).json(resultado);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Falha ao reconciliar a situação da NFC-e.',
      code: error.code || 'ERRO_RECONCILIACAO'
    });
  }
});

router.get('/notas', (req, res) => {
  const todas = req.query.todas === '1';
  const params = [];
  let where = '';

  if (!todas) {
    const dataHoje = agoraLocalBrasil().split(' ')[0];
    where = ' WHERE DATE(n.created_at) = ? ';
    params.push(dataHoje);
  }

  db.all(`
    SELECT n.*, v.codigo as venda_codigo, v.total as venda_total
    FROM nfce_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    ${where}
    ORDER BY n.id DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const safeRows = (rows || []).map((row) => {
      const safeRow = { ...row };
      delete safeRow.xml_autorizado;
      return safeRow;
    });
    res.json(safeRows);
  });
});

router.get('/notas/:id/danfe', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      obterDanfeHtmlPorNfceId
    } = require('../services/fechamento-fiscal/NfceHistoricoOficialService');
    const pacote = await obterDanfeHtmlPorNfceId(db, id);
    const htmlOficial = /danfe-termico/.test(String(pacote?.htmlTermico || ''))
      ? pacote.htmlTermico
      : (/danfe-termico/.test(String(pacote?.html || '')) ? pacote.html : '');
    if (!htmlOficial) {
      return res.status(404).json({ error: 'DANFE não disponível para esta NFC-e.' });
    }

    const formato = String(req.query.formato || '').toLowerCase();
    const asPacote = req.query.pacote === '1' || formato === 'pacote' || formato === 'json';
    if (asPacote) {
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        html: htmlOficial,
        htmlTermico: htmlOficial,
        textoTermico: pacote.textoTermico || '',
        nota: {
          id: pacote.nota?.id,
          numero: pacote.nota?.numero,
          serie: pacote.nota?.serie,
          chave_acesso: pacote.nota?.chave_acesso,
          protocolo: pacote.nota?.protocolo,
          ambiente: pacote.nota?.ambiente,
          status: pacote.nota?.status,
          origem: pacote.nota?.origem,
          fechamento_fiscal_id: pacote.nota?.fechamento_fiscal_id,
          valor_total: pacote.total != null ? pacote.total : undefined
        }
      });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(htmlOficial);
  } catch (error) {
    const status = error.statusCode || (/não encontrada/i.test(error.message || '') ? 404 : 500);
    return res.status(status).json({ error: error.message || 'Erro ao obter DANFE.' });
  }
});

router.get('/notas/:id/xml', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const nota = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM nfce_notas WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });
    if (!nota) return res.status(404).json({ success: false, error: 'NFC-e não encontrada.' });

    let evidencia;
    try {
      const { obterXmlAutorizadoNota } = require('../services/fiscal/nfceXmlAutorizado');
      evidencia = obterXmlAutorizadoNota(nota);
    } catch (validationErr) {
      console.warn('[FISCAL][NFCe][XML_AUTORIZADO] indisponível:', {
        nota_id: id,
        code: validationErr.code || 'XML_AUTORIZADO_INVALIDO',
        erro: validationErr.message || String(validationErr)
      });
      return res.status(404).json({
        success: false,
        error: 'XML processado válido não está disponível para esta NFC-e.',
        code: validationErr.code || 'XML_AUTORIZADO_NAO_DISPONIVEL'
      });
    }

    const nome = `NFCe-${String(nota.chave_acesso || nota.id).replace(/[^\w.-]/g, '')}-autorizada.xml`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    if (String(req.query.download || '') === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      return res.send(evidencia.xml);
    }
    return res.json({
      success: true,
      xml: evidencia.xml,
      chave: evidencia.chaveAcesso,
      cStat: evidencia.cStat,
      xMotivo: evidencia.xMotivo,
      protocolo: evidencia.protocolo
    });
  } catch (err) {
    console.error('[FISCAL][NFCe][XML_AUTORIZADO] falha ao consultar documento:', {
      nota_id: id,
      erro: err.message || String(err)
    });
    return res.status(err.statusCode || 500).json({
      success: false,
      error: err.message || 'Falha ao obter XML autorizado.'
    });
  }
});

router.get('/notas/:id/cancelamento-diagnostico', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      diagnosticarCancelamentoNfce
    } = require('../services/fechamento-fiscal/NfceCancelamentoFechamentoService');
    const diag = await diagnosticarCancelamentoNfce(db, id);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(diag);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message || 'Erro no diagnóstico de cancelamento.' });
  }
});

router.get('/notas/:id', (req, res) => {
  db.get(`
    SELECT n.*, v.codigo as venda_codigo, v.total as venda_total
    FROM nfce_notas n
    LEFT JOIN vendas v ON v.id = n.venda_id
    WHERE n.id = ?
  `, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'NFC-e não encontrada.' });
    try {
      const { obterXmlAutorizadoNota } = require('../services/fiscal/nfceXmlAutorizado');
      row.xml_autorizado = obterXmlAutorizadoNota(row).xml;
    } catch (validationErr) {
      row.xml_autorizado = null;
      console.warn('[FISCAL][NFCe][XML_AUTORIZADO] documento sem evidência válida:', {
        nota_id: row.id,
        code: validationErr.code || 'XML_AUTORIZADO_INVALIDO',
        erro: validationErr.message || String(validationErr)
      });
    }
    return res.json(row);
  });
});

router.post('/exportar-contabilidade', criarHandlerExportarContabilidade({
  exportarContabilidade,
  limparExportacaoTemporaria,
  fsApi: fs
}));

// Sprint 01 — Fechamento Fiscal do Dia (fundação / prévia)
router.use('/fechamentos', require('./fechamento-fiscal'));

module.exports = router;
