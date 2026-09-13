/**
 * Sprint 3.9 / Hotfix RC1.1 — Licenciamento CDS (aviso no login + QR PIX).
 * NÃO bloqueia o sistema (bloqueio permanece em licencaMiddleware).
 * QR PIX via QRCodePixGenerator (sem imagens estáticas / sem arquivos).
 */
'use strict';

const configService = require('./configuracaoService');
const licencaService = require('./licencaService');
const verificarLicenca = require('./verificarLicenca');
const QRCodePixGenerator = require('./pix/QRCodePixGenerator');
const QRCodeService = require('./qrcode/QRCodeService');

const MENSAGEM_PADRAO = configService.MENSAGEM_RENOVACAO_PADRAO
  || 'Sua assinatura do CDS Sistemas expira em {dias} dias.';

function montarMensagem(template, dias) {
  const base = String(template || MENSAGEM_PADRAO);
  return base.replace(/\{dias\}/gi, String(Math.max(0, Number(dias) || 0)));
}

/** @deprecated use QRCodeService / QRCodePixGenerator — compatibilidade. */
async function gerarQrDataUrl(conteudo) {
  return QRCodeService.gerarBase64(conteudo);
}

/**
 * Payload público de aviso de renovação (login).
 * Níveis: none | info(3) | renew(2|1) | critical(0)
 */
async function obterAvisoRenovacaoLogin() {
  const cfg = configService.getLicenciamentoCds();
  const diasAviso = Number(cfg.dias_aviso || 3);
  const resultado = await verificarLicenca();
  const licenca = await licencaService.obterLicenca().catch(() => null);

  const diasRestantes = Number(
    resultado?.diasRestantes != null
      ? resultado.diasRestantes
      : (resultado?.dias_restantes != null
        ? resultado.dias_restantes
        : (licenca?.diasRestantes || 0))
  );

  const valido = resultado?.valido === true;
  const vencida = resultado?.motivo === 'VENCIDA'
    || String(resultado?.status || '').toLowerCase() === 'vencida'
    || (valido === false && diasRestantes <= 0 && resultado?.motivo !== 'PENDENTE');

  if (!valido && resultado?.motivo === 'PENDENTE') {
    return { mostrar: false, nivel: 'none', motivo: 'PENDENTE' };
  }

  if (!vencida && diasRestantes > diasAviso) {
    return { mostrar: false, nivel: 'none', dias_restantes: diasRestantes };
  }

  let nivel = 'info';
  if (vencida || diasRestantes <= 0) nivel = 'critical';
  else if (diasRestantes <= 2) nivel = 'renew';
  else nivel = 'info';

  const mensagem = montarMensagem(cfg.mensagem_renovacao, Math.max(0, diasRestantes));
  const chavePix = String(cfg.chave_pix || '').trim();
  const whatsappUrl = String(cfg.whatsapp_url || '').trim();
  const incluirCanais = nivel === 'renew' || nivel === 'critical';

  let pix = {
    configurado: false,
    mensagem: QRCodePixGenerator.MSG_PIX_NAO_CONFIGURADO,
    qr_pix: null,
    chave_pix: '',
    dinamico_preparado: true,
    dinamico_ativo: false
  };
  let qrWhatsapp = null;

  if (incluirCanais) {
    const gerado = await QRCodePixGenerator.gerar({
      chavePix,
      modo: QRCodePixGenerator.MODO_PIX.ESTATICO,
      formato: 'dataurl',
      largura: 220
    });
    pix = {
      configurado: gerado.configurado === true,
      mensagem: gerado.configurado ? null : (gerado.mensagem || QRCodePixGenerator.MSG_PIX_NAO_CONFIGURADO),
      qr_pix: gerado.imagem || null,
      chave_pix: gerado.configurado ? (gerado.payload || chavePix) : '',
      dinamico_preparado: gerado.dinamico_preparado === true,
      dinamico_ativo: gerado.dinamico_ativo === true
    };

    if (whatsappUrl) {
      const wa = await QRCodeService.gerarWhatsApp(whatsappUrl, { formato: 'dataurl', largura: 220 });
      qrWhatsapp = wa.sucesso ? wa.imagem : null;
    }
  }

  return {
    mostrar: true,
    nivel,
    dias_restantes: Math.max(0, diasRestantes),
    dias_aviso: diasAviso,
    mensagem,
    chave_pix: incluirCanais ? pix.chave_pix : '',
    whatsapp_url: incluirCanais ? whatsappUrl : '',
    qr_pix: incluirCanais ? pix.qr_pix : null,
    qr_whatsapp: incluirCanais ? qrWhatsapp : null,
    pix_configurado: incluirCanais ? pix.configurado : false,
    pix_mensagem: incluirCanais && !pix.configurado ? pix.mensagem : null,
    pix_dinamico: {
      preparado: true,
      ativo: false,
      modo_atual: 'estatico'
    },
    botoes: nivel === 'info'
      ? ['lembrar_depois', 'renovar_agora']
      : ['copiar_pix', 'enviar_comprovante', 'lembrar_depois'],
    renovacao_automatica: {
      preparada: true,
      ativa: false,
      fluxo: ['PIX', 'Webhook', 'Servidor CDS', 'Renovar assinatura']
    }
  };
}

module.exports = {
  MENSAGEM_PADRAO,
  montarMensagem,
  gerarQrDataUrl,
  obterAvisoRenovacaoLogin,
  QRCodePixGenerator,
  QRCodeService
};
