/**
 * Validação de motivos/justificativas — espelho UX das regras do backend.
 * Fonte oficial: backend/services/validacao/validarMotivoTexto.js
 *
 * Uso no browser: validarMotivoTexto(texto, opcoes) (global via window)
 */
(function (root, factory) {
  const api = factory();
  if (root) {
    root.validarMotivoTexto = api.validarMotivoTexto;
    root.VALIDACAO_MOTIVO_REGRAS = api.VALIDACAO_MOTIVO_REGRAS;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VALIDACAO_MOTIVO_REGRAS = {
    minCaracteres: 15,
    minPalavras: 2,
    minLetrasPorPalavra: 3,
    proporcaoMinimaLetras: 0.6
  };

  const VOGAIS = 'aeiouáàâãéèêíìîóòôõúùûAEIOUÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛ';

  // Sequências de teclado / numéricas conhecidas (usadas como base para detectar lixo).
  const SEQUENCIAS_TECLADO = [
    'qwertyuiop',
    'asdfghjkl',
    'zxcvbnm',
    'abcdefghijklmnopqrstuvwxyz',
    '01234567890',
    '09876543210'
  ];

  function contarLetras(texto) {
    const match = String(texto).match(/[a-zA-ZáàâãéèêíìîóòôõúùûçÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ]/g);
    return match ? match.length : 0;
  }

  function temVogal(texto) {
    for (const ch of String(texto)) {
      if (VOGAIS.indexOf(ch) !== -1) return true;
    }
    return false;
  }

  /** Detecta caractere único repetido em toda a palavra (aaaaaa, bbbbbb). */
  function ehCaractereRepetido(palavra) {
    const limpa = String(palavra).replace(/[^a-zA-Z0-9À-ÿ]/g, '').toLowerCase();
    if (limpa.length < 3) return false;
    return /^(.)\1+$/.test(limpa);
  }

  /** Detecta padrão curto repetido (123123, abab, xyzxyz). */
  function ehPadraoRepetido(palavra) {
    const limpa = String(palavra).replace(/[^a-zA-Z0-9À-ÿ]/g, '').toLowerCase();
    if (limpa.length < 4) return false;
    for (let tam = 1; tam <= Math.floor(limpa.length / 2); tam++) {
      const bloco = limpa.slice(0, tam);
      if (bloco.repeat(Math.ceil(limpa.length / tam)).slice(0, limpa.length) === limpa) {
        return true;
      }
    }
    return false;
  }

  /** Detecta se a palavra é trecho de uma sequência de teclado (asdf, qwert, 123456). */
  function ehSequenciaTeclado(palavra) {
    const limpa = String(palavra).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (limpa.length < 4) return false;
    const invertida = limpa.split('').reverse().join('');
    return SEQUENCIAS_TECLADO.some(
      (seq) => seq.indexOf(limpa) !== -1 || seq.indexOf(invertida) !== -1
    );
  }

  function ehPalavraLixo(palavra) {
    return (
      ehCaractereRepetido(palavra) ||
      ehPadraoRepetido(palavra) ||
      ehSequenciaTeclado(palavra)
    );
  }

  /**
   * @param {string} texto
   * @param {object} [opcoes] sobrescreve VALIDACAO_MOTIVO_REGRAS
   * @returns {{ valido: boolean, erro: string|null }}
   */
  function validarMotivoTexto(texto, opcoes) {
    const regras = Object.assign({}, VALIDACAO_MOTIVO_REGRAS, opcoes || {});
    const original = String(texto == null ? '' : texto);
    const limpo = original.trim();

    if (!limpo) {
      return { valido: false, erro: 'Informe o motivo.' };
    }

    if (limpo.length < regras.minCaracteres) {
      return {
        valido: false,
        erro: `O motivo deve ter no mínimo ${regras.minCaracteres} caracteres.`
      };
    }

    const totalCaracteresSemEspaco = limpo.replace(/\s/g, '').length;
    const totalLetras = contarLetras(limpo);

    if (totalCaracteresSemEspaco > 0 && totalLetras / totalCaracteresSemEspaco < regras.proporcaoMinimaLetras) {
      return {
        valido: false,
        erro: 'O motivo deve conter majoritariamente letras (evite números e símbolos em excesso).'
      };
    }

    if (!temVogal(limpo)) {
      return { valido: false, erro: 'O motivo não parece um texto válido (sem vogais).' };
    }

    const palavras = limpo.split(/\s+/).filter(Boolean);

    if (palavras.length < regras.minPalavras) {
      return {
        valido: false,
        erro: `O motivo deve ter no mínimo ${regras.minPalavras} palavras.`
      };
    }

    const palavrasComLetras = palavras.filter((p) => contarLetras(p) > 0);
    const palavrasValidas = palavrasComLetras.filter(
      (p) => contarLetras(p) >= regras.minLetrasPorPalavra
    );

    if (palavrasValidas.length < regras.minPalavras) {
      return {
        valido: false,
        erro: `O motivo deve ter pelo menos ${regras.minPalavras} palavras com ${regras.minLetrasPorPalavra} letras ou mais.`
      };
    }

    const palavrasLixo = palavras.filter((p) => ehPalavraLixo(p));
    if (palavrasLixo.length && palavrasLixo.length >= palavras.length / 2) {
      return {
        valido: false,
        erro: 'O motivo parece inválido (texto repetido ou aleatório).'
      };
    }

    return { valido: true, erro: null };
  }

  return {
    validarMotivoTexto,
    VALIDACAO_MOTIVO_REGRAS
  };
});
