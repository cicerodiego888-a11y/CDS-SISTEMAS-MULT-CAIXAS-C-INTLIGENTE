'use strict';

const fs = require('fs');
const path = require('path');
const {
  DLL_NAME,
  ERROS,
  pastaArquitetura,
  rotuloArquiteturaDll,
  criarErro
} = require('./destaxaConstantes');
const { compatibilidadeArquitetura } = require('./destaxaPeInspector');

function encontrarRaizProjeto(inicio = __dirname) {
  let atual = inicio;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(atual, 'package.json'))) {
      return atual;
    }
    const pai = path.dirname(atual);
    if (pai === atual) break;
    atual = pai;
  }
  return path.resolve(__dirname, '../../../..');
}

function caminhoDesempacotado(caminho) {
  if (!caminho) return caminho;
  const asarSeg = `${path.sep}app.asar${path.sep}`;
  const unpackedSeg = `${path.sep}app.asar.unpacked${path.sep}`;
  if (caminho.includes(asarSeg) && !caminho.includes(unpackedSeg)) {
    return caminho.replace(asarSeg, unpackedSeg);
  }
  return caminho;
}

function normalizarCandidatoDll(caminhoInformado) {
  if (!caminhoInformado || !String(caminhoInformado).trim()) {
    return null;
  }
  const bruto = path.resolve(String(caminhoInformado).trim());
  const stat = fs.existsSync(bruto) ? fs.statSync(bruto) : null;
  if (stat && stat.isDirectory()) {
    return path.join(bruto, DLL_NAME);
  }
  if (path.extname(bruto).toLowerCase() === '.dll') {
    return bruto;
  }
  return path.join(bruto, DLL_NAME);
}

function diretorioRecursosAplicacao(raiz = encontrarRaizProjeto(), opcoes = {}) {
  if (process.resourcesPath && !opcoes.raizProjeto) {
    return process.resourcesPath;
  }
  return path.join(raiz, 'resources');
}

function diretorioOficialTef(raiz) {
  return path.join(raiz, 'resources', 'tef');
}

function diretorioDesenvolvimento(raiz) {
  return path.join(raiz, 'resources', 'tef', 'destaxa');
}

function caminhoPorArquitetura(base, arch) {
  const pasta = pastaArquitetura(arch);
  if (!pasta || !base) return null;
  return path.join(base, pasta, DLL_NAME);
}

/**
 * Layout Electron com asarUnpack: process.resourcesPath aponta para
 *   <install>/resources
 * enquanto a DLL desempacotada fica em
 *   <install>/resources/app.asar.unpacked/resources/tef/destaxa/<arch>/
 * O candidato "resources/tef/..." irmão do app.asar NÃO existe no instalador NSIS.
 */
function diretorioAsarUnpackedDestaxa(recursosApp) {
  if (!recursosApp) return null;
  return path.join(recursosApp, 'app.asar.unpacked', 'resources', 'tef', 'destaxa');
}

/**
 * Prioridade:
 * 1. caminho explícito (config / DESTAXA_DLL_PATH)
 * 2. app.asar.unpacked sob process.resourcesPath (artefato instalado)
 * 3. recursos da aplicação (process.resourcesPath/tef — legado / extraResources)
 * 4. diretório oficial TEF do CDS (resources/tef via raiz do projeto/asar)
 * 5. caminho de desenvolvimento (resources/tef/destaxa)
 */
function listarCandidatos(config = {}, opcoes = {}) {
  const arch = opcoes.arch || config.processArch || process.arch;
  const raiz = opcoes.raizProjeto || encontrarRaizProjeto();
  const candidatos = [];
  const vistos = new Set();

  const adicionar = (origem, caminho, prioridade) => {
    if (!caminho) return;
    const resolvido = caminhoDesempacotado(path.normalize(caminho));
    const chave = resolvido.toLowerCase();
    if (vistos.has(chave)) return;
    vistos.add(chave);
    candidatos.push({
      origem,
      prioridade,
      caminho: resolvido,
      arquitetura: rotuloArquiteturaDll(arch),
      pastaArquitetura: pastaArquitetura(arch),
      existe: fs.existsSync(resolvido)
    });
  };

  const explicito = normalizarCandidatoDll(
    config.sdkPath
    || config.sdk_path
    || config.dllPath
    || config.dll_path
    || opcoes.dllPath
    || process.env.DESTAXA_DLL_PATH
  );
  adicionar('configurado', explicito, 1);

  const recursosApp = diretorioRecursosAplicacao(raiz, opcoes);
  const unpackedDestaxa = diretorioAsarUnpackedDestaxa(recursosApp);
  adicionar('asar_unpacked', caminhoPorArquitetura(unpackedDestaxa, arch), 2);
  adicionar('recursos_aplicacao', caminhoPorArquitetura(path.join(recursosApp, 'tef', 'destaxa'), arch), 3);
  adicionar('recursos_aplicacao', path.join(recursosApp, DLL_NAME), 3);

  const oficial = diretorioOficialTef(raiz);
  adicionar('recursos_tef_cds', caminhoPorArquitetura(path.join(oficial, 'destaxa'), arch), 4);

  const dev = diretorioDesenvolvimento(raiz);
  adicionar('desenvolvimento', caminhoPorArquitetura(dev, arch), 5);

  return { arch, raiz, recursosApp, candidatos };
}

function validarArquiteturaDll(dllPath, arch) {
  const check = compatibilidadeArquitetura(dllPath, arch);
  if (check.compativel) {
    return { ok: true, pe: check.pe };
  }
  if (check.motivo === 'ARCHITECTURE_MISMATCH') {
    const erro = criarErro(
      ERROS.DESTAXA_ARCHITECTURE_MISMATCH,
      `Arquitetura da DLL Destaxa (${check.pe.dllArch || check.pe.peMachine}) incompatível com o processo (${arch})`,
      {
        processArch: arch,
        dllPath,
        peMachine: check.pe.peMachine,
        dllArch: check.pe.dllArch
      }
    );
    return { ok: false, erro, pe: check.pe };
  }
  const erro = criarErro(
    ERROS.DESTAXA_DLL_LOAD_FAILED,
    `Cabeçalho PE da DLL Destaxa inválido ou ilegível (${check.motivo})`,
    { processArch: arch, dllPath, pe: check.pe }
  );
  return { ok: false, erro, pe: check.pe };
}

function montarSucesso(encontrado, candidatos, arch, pe = null) {
  return {
    sucesso: true,
    processArch: arch,
    dllArch: rotuloArquiteturaDll(arch),
    dllPath: encontrado.caminho,
    dllExists: true,
    origem: encontrado.origem,
    peMachine: pe?.peMachine || null,
    candidatos
  };
}

function montarFalha(erro, candidatos, arch, dllPath = null) {
  return {
    sucesso: false,
    codigo: erro.codigo,
    mensagem: erro.message,
    processArch: arch,
    dllArch: rotuloArquiteturaDll(arch),
    dllPath: dllPath || candidatos.find((c) => c.existe)?.caminho || candidatos[0]?.caminho || null,
    dllExists: Boolean(dllPath && fs.existsSync(dllPath)),
    candidatos,
    erro
  };
}

function resolverDll(config = {}, opcoes = {}) {
  const arch = opcoes.arch || config.processArch || process.arch;
  const pasta = pastaArquitetura(arch);
  if (!pasta) {
    return {
      sucesso: false,
      codigo: ERROS.DESTAXA_ARCHITECTURE_NOT_SUPPORTED,
      mensagem: `Arquitetura de processo não suportada para DLL Destaxa: ${arch}`,
      processArch: arch,
      dllPath: null,
      dllExists: false,
      candidatos: []
    };
  }

  const { candidatos } = listarCandidatos(config, { ...opcoes, arch });
  const explicito = candidatos.find((c) => c.origem === 'configurado');
  if (explicito) {
    if (fs.existsSync(explicito.caminho)) {
      const archCheck = validarArquiteturaDll(explicito.caminho, arch);
      if (!archCheck.ok) {
        return montarFalha(archCheck.erro, candidatos, arch, explicito.caminho);
      }
      return montarSucesso(explicito, candidatos, arch, archCheck.pe);
    }
    const erro = criarErro(
      ERROS.DESTAXA_DLL_NOT_FOUND,
      `DLL Destaxa não encontrada no caminho configurado (${DLL_NAME})`,
      { processArch: arch, dllPath: explicito.caminho }
    );
    return montarFalha(erro, candidatos, arch, explicito.caminho);
  }

  const encontrado = candidatos.find((c) => c.existe === true || fs.existsSync(c.caminho));

  if (!encontrado) {
    const erro = criarErro(
      ERROS.DESTAXA_DLL_NOT_FOUND,
      `DLL Destaxa não encontrada (${DLL_NAME}) para ${rotuloArquiteturaDll(arch)}`,
      {
        processArch: arch,
        candidatos: candidatos.map((c) => ({
          origem: c.origem,
          caminho: c.caminho,
          existe: false
        }))
      }
    );
    return montarFalha(erro, candidatos, arch);
  }

  const archCheck = validarArquiteturaDll(encontrado.caminho, arch);
  if (!archCheck.ok) {
    return montarFalha(archCheck.erro, candidatos, arch, encontrado.caminho);
  }

  return montarSucesso(encontrado, candidatos, arch, archCheck.pe);
}

/**
 * Diagnóstico de resolução sem carregar a DLL (sem koffi.load / sem INIT).
 */
function diagnosticarResolucao(config = {}, opcoes = {}) {
  const resolucao = resolverDll(config, opcoes);
  const classe = !resolucao.sucesso
    ? (resolucao.codigo === ERROS.DESTAXA_DLL_NOT_FOUND
      ? 'DLL_AUSENTE'
      : resolucao.codigo === ERROS.DESTAXA_ARCHITECTURE_MISMATCH
        ? 'ARQUITETURA_INCOMPATIVEL'
        : resolucao.codigo === ERROS.DESTAXA_ARCHITECTURE_NOT_SUPPORTED
          ? 'ARQUITETURA_PROCESSO_NAO_SUPORTADA'
          : 'ERRO_RESOLUCAO')
    : 'DLL_PRESENTE';

  return {
    ...resolucao,
    classeDiagnostico: classe,
    candidatosPresentes: (resolucao.candidatos || []).filter((c) => c.existe).map((c) => c.caminho),
    candidatosAusentes: (resolucao.candidatos || []).filter((c) => !c.existe).map((c) => c.caminho)
  };
}

module.exports = {
  DLL_NAME,
  encontrarRaizProjeto,
  caminhoDesempacotado,
  pastaArquitetura,
  rotuloArquiteturaDll,
  listarCandidatos,
  resolverDll,
  diagnosticarResolucao,
  diretorioRecursosAplicacao,
  diretorioOficialTef,
  diretorioDesenvolvimento,
  diretorioAsarUnpackedDestaxa,
  validarArquiteturaDll
};
