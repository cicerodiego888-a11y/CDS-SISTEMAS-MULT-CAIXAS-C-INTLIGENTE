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
 * Prioridade:
 * 1. caminho explícito (config / DESTAXA_DLL_PATH)
 * 2. recursos da aplicação (process.resourcesPath)
 * 3. diretório oficial TEF do CDS (resources/tef)
 * 4. caminho de desenvolvimento (resources/tef/destaxa)
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
      pastaArquitetura: pastaArquitetura(arch)
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
  adicionar('recursos_aplicacao', caminhoPorArquitetura(path.join(recursosApp, 'tef', 'destaxa'), arch), 2);
  adicionar('recursos_aplicacao', path.join(recursosApp, DLL_NAME), 2);

  const oficial = diretorioOficialTef(raiz);
  adicionar('recursos_tef_cds', caminhoPorArquitetura(path.join(oficial, 'destaxa'), arch), 3);
  adicionar('recursos_tef_cds_unpacked', caminhoDesempacotado(
    caminhoPorArquitetura(path.join(oficial, 'destaxa'), arch)
  ), 3);

  const dev = diretorioDesenvolvimento(raiz);
  adicionar('desenvolvimento', caminhoPorArquitetura(dev, arch), 4);

  return { arch, raiz, candidatos };
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
      return {
        sucesso: true,
        processArch: arch,
        dllArch: rotuloArquiteturaDll(arch),
        dllPath: explicito.caminho,
        dllExists: true,
        origem: explicito.origem,
        candidatos
      };
    }
    const erro = criarErro(
      ERROS.DESTAXA_DLL_NOT_FOUND,
      `DLL Destaxa não encontrada no caminho configurado (${DLL_NAME})`,
      { processArch: arch, dllPath: explicito.caminho }
    );
    return {
      sucesso: false,
      codigo: erro.codigo,
      mensagem: erro.message,
      processArch: arch,
      dllArch: rotuloArquiteturaDll(arch),
      dllPath: explicito.caminho,
      dllExists: false,
      candidatos,
      erro
    };
  }

  const encontrado = candidatos.find((c) => fs.existsSync(c.caminho));

  if (!encontrado) {
    const erro = criarErro(
      ERROS.DESTAXA_DLL_NOT_FOUND,
      `DLL Destaxa não encontrada (${DLL_NAME}) para ${rotuloArquiteturaDll(arch)}`,
      { processArch: arch, candidatos: candidatos.map((c) => c.caminho) }
    );
    return {
      sucesso: false,
      codigo: erro.codigo,
      mensagem: erro.message,
      processArch: arch,
      dllArch: rotuloArquiteturaDll(arch),
      dllPath: candidatos[0]?.caminho || null,
      dllExists: false,
      candidatos,
      erro
    };
  }

  return {
    sucesso: true,
    processArch: arch,
    dllArch: rotuloArquiteturaDll(arch),
    dllPath: encontrado.caminho,
    dllExists: true,
    origem: encontrado.origem,
    candidatos
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
  diretorioRecursosAplicacao,
  diretorioOficialTef,
  diretorioDesenvolvimento
};
