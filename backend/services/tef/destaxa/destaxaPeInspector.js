'use strict';

/**
 * Inspeção estática do cabeçalho PE da DLL Destaxa (sem LoadLibrary/INIT).
 * Machine: 0x8664 = AMD64, 0x14c = i386.
 */

const fs = require('fs');

const PE_MACHINE = Object.freeze({
  AMD64: 0x8664,
  I386: 0x14c
});

function lerPeMachine(dllPath) {
  if (!dllPath || !fs.existsSync(dllPath)) {
    return {
      ok: false,
      codigo: 'ARQUIVO_AUSENTE',
      peMachine: null,
      dllArch: null,
      processArchCompat: null
    };
  }

  let fd;
  try {
    fd = fs.openSync(dllPath, 'r');
    const cabecalho = Buffer.alloc(64);
    fs.readSync(fd, cabecalho, 0, 64, 0);
    if (cabecalho.readUInt16LE(0) !== 0x5a4d) {
      return {
        ok: false,
        codigo: 'MZ_INVALIDO',
        peMachine: null,
        dllArch: null,
        processArchCompat: null
      };
    }

    const eLfanew = cabecalho.readUInt32LE(0x3c);
    const pe = Buffer.alloc(6);
    fs.readSync(fd, pe, 0, 6, eLfanew);
    if (pe.readUInt32LE(0) !== 0x00004550) {
      return {
        ok: false,
        codigo: 'PE_INVALIDO',
        peMachine: null,
        dllArch: null,
        processArchCompat: null
      };
    }

    const machine = pe.readUInt16LE(4);
    if (machine === PE_MACHINE.AMD64) {
      return {
        ok: true,
        codigo: null,
        peMachine: 'AMD64',
        machineHex: '0x8664',
        dllArch: 'x64',
        processArchCompat: 'x64'
      };
    }
    if (machine === PE_MACHINE.I386) {
      return {
        ok: true,
        codigo: null,
        peMachine: 'i386',
        machineHex: '0x14c',
        dllArch: 'x86',
        processArchCompat: 'ia32'
      };
    }
    return {
      ok: false,
      codigo: 'MACHINE_DESCONHECIDO',
      peMachine: `0x${machine.toString(16)}`,
      machineHex: `0x${machine.toString(16)}`,
      dllArch: null,
      processArchCompat: null
    };
  } catch (error) {
    return {
      ok: false,
      codigo: 'LEITURA_FALHOU',
      peMachine: null,
      dllArch: null,
      processArchCompat: null,
      mensagem: error.message
    };
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function compatibilidadeArquitetura(dllPath, processArch = process.arch) {
  const pe = lerPeMachine(dllPath);
  if (!pe.ok || !pe.processArchCompat) {
    return {
      compativel: false,
      motivo: pe.codigo || 'PE_INVALIDO',
      pe,
      processArch
    };
  }
  const compativel = pe.processArchCompat === processArch;
  return {
    compativel,
    motivo: compativel ? null : 'ARCHITECTURE_MISMATCH',
    pe,
    processArch
  };
}

module.exports = {
  PE_MACHINE,
  lerPeMachine,
  compatibilidadeArquitetura
};
