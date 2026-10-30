'use strict';

/**
 * MRT-28 — Configuração oficial de log da DLL Destaxa 1.83.
 *
 * Fonte da assinatura / formato:
 *   docs/05-api-iniciaclientdestaxa.md (pacote 1.83)
 *   void iniciaClientDestaxa(char *resultado, char *entrada, int tamanho_entrada);
 *   `entrada` = "chave=valor;chave=valor" (parâmetros opcionais na mesma string).
 *
 * Valores confirmados pelo especialista Destaxa (MRT-28):
 *   diretorio_trabalho, nivel_log=1, nome_arquivo_log, tamanho 10 MB, 5 backups.
 *
 * Unidade de `tam_max_log` (doc oficial): mega bytes (exemplo: tam_max_log=3 → 3MB).
 * Referência do especialista em bytes: 10485760 (= 10 × 1024 × 1024).
 * Valor enviado na string de entrada: "10" (unidade oficial da DLL — sem inventar outra escala).
 *
 * Não altera TX_START / CRT / CONTINUE / FINALIZE.
 */

const fs = require('fs');
const path = require('path');

/** Bytes confirmados pelo especialista (= 10 MiB). */
const TAM_MAX_LOG_BYTES_CONFIRMADO = 10485760;

/** Megabytes no formato exigido pela DLL 1.83 (doc + exemplo oficial). */
const TAM_MAX_LOG_MEGABYTES_DLL = Math.floor(TAM_MAX_LOG_BYTES_CONFIRMADO / (1024 * 1024));

/**
 * Parâmetros Destaxa enviados em `entrada` de iniciaClientDestaxa.
 * Valores como string — formato chave=valor da DLL (sem conversão adicional na montagem).
 */
const DESTAXA_DLL_LOG_PARAMS = Object.freeze({
  diretorio_trabalho: 'C:\\CDS-SISTEMAS\\logs\\destaxa',
  nivel_log: '1',
  nome_arquivo_log: 'destaxa-dll.log',
  tam_max_log: String(TAM_MAX_LOG_MEGABYTES_DLL),
  total_bkp_log: '5'
});

const DESTAXA_DLL_LOG_META = Object.freeze({
  sprint: 'MRT-28',
  fonteEspecialista: {
    diretorio_trabalho: 'C:\\CDS-SISTEMAS\\logs\\destaxa',
    nivel_log: 1,
    nome_arquivo_log: 'destaxa-dll.log',
    tam_max_log: TAM_MAX_LOG_BYTES_CONFIRMADO,
    total_bkp_log: 5
  },
  documentacaoOficial: {
    arquivo: '05-api-iniciaclientdestaxa.md',
    pacote: '1.83',
    nivel_log_escala: '5=FATAL … 0=TRACE; 1=DEBUG; <0 desativa',
    tam_max_log_unidade: 'mega bytes',
    exemploOficial: 'diretorio_trabalho=c:\\tmp;nome_arquivo_log=logs.txt;tam_max_log=3',
    assinaturaKoffi: 'void iniciaClientDestaxa(uint8 *resultado, uint8 *entrada, int tamanho_entrada)',
    nota: 'Os cinco parâmetros de log entram na string `entrada`, não como argumentos C separados.'
  },
  caminhoArquivoLogEsperado: path.join(
    DESTAXA_DLL_LOG_PARAMS.diretorio_trabalho,
    DESTAXA_DLL_LOG_PARAMS.nome_arquivo_log
  ),
  tamMaxBytesEquivalente: TAM_MAX_LOG_BYTES_CONFIRMADO,
  tamMaxMegabytesEnviadoDll: TAM_MAX_LOG_MEGABYTES_DLL
});

const CHAVES_LOG_DLL = Object.freeze([
  'diretorio_trabalho',
  'nivel_log',
  'nome_arquivo_log',
  'tam_max_log',
  'total_bkp_log'
]);

/**
 * Pares [chave, valor] na ordem documentada da sprint (após versao/aplicacao/códigos).
 */
function paresLogDll(params = DESTAXA_DLL_LOG_PARAMS) {
  return CHAVES_LOG_DLL.map((chave) => [chave, String(params[chave])]);
}

/**
 * Garante diretório de trabalho da DLL e permissão de gravação (sem INIT).
 */
function garantirDiretorioLogDll(params = DESTAXA_DLL_LOG_PARAMS) {
  const diretorio = String(params.diretorio_trabalho || '').trim();
  if (!diretorio) {
    return {
      ok: false,
      codigo: 'DESTAXA_LOG_DIR_AUSENTE',
      mensagem: 'diretorio_trabalho não configurado'
    };
  }

  try {
    fs.mkdirSync(diretorio, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      codigo: 'DESTAXA_LOG_DIR_CRIACAO_FALHOU',
      mensagem: error.message,
      diretorio
    };
  }

  const probe = path.join(diretorio, `.cds-destaxa-log-write-probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, `ok ${new Date().toISOString()}`, 'utf8');
    fs.unlinkSync(probe);
  } catch (error) {
    return {
      ok: false,
      codigo: 'DESTAXA_LOG_DIR_SEM_PERMISSAO',
      mensagem: error.message,
      diretorio
    };
  }

  return {
    ok: true,
    diretorio,
    arquivoLog: path.join(diretorio, params.nome_arquivo_log),
    gravavel: true
  };
}

/**
 * Anexa parâmetros de log à projeção de iniciaClientDestaxa (preserva pares existentes).
 */
function anexarParamsLogEntrada(paresExistentes = [], params = DESTAXA_DLL_LOG_PARAMS) {
  const base = Array.isArray(paresExistentes) ? [...paresExistentes] : [];
  const chavesJa = new Set(base.map(([k]) => k));
  for (const [chave, valor] of paresLogDll(params)) {
    if (chavesJa.has(chave)) continue;
    base.push([chave, valor]);
    chavesJa.add(chave);
  }
  return base;
}

function descreverConfigLogDll() {
  return {
    params: { ...DESTAXA_DLL_LOG_PARAMS },
    meta: { ...DESTAXA_DLL_LOG_META },
    chaves: [...CHAVES_LOG_DLL]
  };
}

module.exports = {
  DESTAXA_DLL_LOG_PARAMS,
  DESTAXA_DLL_LOG_META,
  CHAVES_LOG_DLL,
  TAM_MAX_LOG_BYTES_CONFIRMADO,
  TAM_MAX_LOG_MEGABYTES_DLL,
  paresLogDll,
  garantirDiretorioLogDll,
  anexarParamsLogEntrada,
  descreverConfigLogDll
};
