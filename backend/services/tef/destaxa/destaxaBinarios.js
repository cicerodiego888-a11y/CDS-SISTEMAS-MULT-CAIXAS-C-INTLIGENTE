'use strict';

/**
 * Metadados dos binários oficiais Destaxa 1.83 copiados para o CDS.
 * Origem: PARCERIA-DESTAXA.zip → 1_83/build64 e 1_83/build32.
 * Não alterar os hashes sem recalcular o arquivo original.
 */
module.exports = Object.freeze({
  versaoPacote: '1.83',
  origem: 'PARCERIA-DESTAXA.zip',
  origemInterna: '1_83-20260831T165940Z-1-001/1_83',
  arquivos: Object.freeze({
    'win-x64': Object.freeze({
      origem: 'build64/libdll-integracao-tef.dll',
      nome: 'libdll-integracao-tef.dll',
      peMachine: 'AMD64',
      tamanho: 136782,
      sha256: '65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279'
    }),
    'win-ia32': Object.freeze({
      origem: 'build32/libdll-integracao-tef.dll',
      nome: 'libdll-integracao-tef.dll',
      peMachine: 'i386',
      tamanho: 130997,
      sha256: '0160FAD1EF27D6EF6FB79AD4899998B36FAFD2FA836BF20039104CF6364C10CE'
    })
  })
});
