const fs = require("fs");
const path = require("path");

const DEBUG_DIR = path.join(__dirname, "../../fiscal/xml/debug");

function garantirPastaDebug() {
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
  }
}

function salvarXmlDebug(nomeArquivo, xml) {
  garantirPastaDebug();
  const caminho = path.join(DEBUG_DIR, nomeArquivo);
  fs.writeFileSync(caminho, xml, "utf8");
  return caminho;
}

function limpar(valor) {
  return String(valor || "").trim();
}

function pegarTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
  return match ? match[1].trim() : "";
}

function validarXmlNFe(xml, nomeDebug = "devolucao-compra.xml") {
  const caminhoDebug = salvarXmlDebug(nomeDebug, xml);
  const erros = [];

  const modelo = pegarTag(xml, "mod");
  const finNFe = pegarTag(xml, "finNFe");
  const refNFe = pegarTag(xml, "refNFe");

  if (!limpar(xml).startsWith("<")) {
    erros.push("XML vazio ou inválido.");
  }

  if (modelo === "55" && xml.includes("<infNFeSupl>")) {
    erros.push("NF-e modelo 55 não pode conter <infNFeSupl>. Essa tag é de NFC-e modelo 65.");
  }

  if (modelo !== "55") {
    erros.push("Devolução de compra deve ser NF-e modelo 55.");
  }

  if (finNFe !== "4") {
    erros.push("Para devolução fiscal, <finNFe> deve ser 4.");
  }

  if (!refNFe || refNFe.length !== 44) {
    erros.push("A tag <refNFe> deve conter a chave da NF-e original com 44 dígitos.");
  }

  if (!xml.includes("<Signature")) {
    erros.push("XML ainda não está assinado. Assine antes de enviar para SEFAZ.");
  }

  if (!xml.includes("<emit>")) {
    erros.push("XML sem grupo <emit>.");
  }

  if (!xml.includes("<dest>")) {
    erros.push("XML sem grupo <dest>.");
  }

  if (!xml.includes("<det ")) {
    erros.push("XML sem itens <det>.");
  }

  if (!xml.includes("<total>")) {
    erros.push("XML sem grupo <total>.");
  }

  return {
    valido: erros.length === 0,
    etapa: erros.length === 0 ? "pre-validado" : "pre-validacao",
    caminhoDebug,
    erros,
  };
}

module.exports = {
  validarXmlNFe,
  salvarXmlDebug,
};