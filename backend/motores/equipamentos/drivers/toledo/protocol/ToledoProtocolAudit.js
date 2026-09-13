/**
 * RC14.14.2 — ToledoProtocolAudit
 * Valida consolidação do protocolo oficial TX/RX.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { OFFICIAL, validarSemColisao } = require('./ToledoOfficialCommands');

const EQUIP = path.join(__dirname, '..');

function ler(rel) {
  try {
    return fs.readFileSync(path.join(EQUIP, rel), 'utf8');
  } catch {
    return '';
  }
}

function auditar() {
  const oficialBuilder = ler('protocol/ToledoFrameBuilder.js');
  const oficialParser = ler('protocol/ToledoFrameParser.js');
  const rxBuffer = ler('protocol/ToledoRxBuffer.js');
  const ackRouter = ler('protocol/ToledoAckRouter.js');
  const engine = ler('protocol/Toledo90AXEngine.js');
  const rootBuilder = ler('ToledoFrameBuilder.js');
  const rootParser = ler('ToledoFrameParser.js');
  const prix4Builder = ler('prix4/ToledoPrix4FrameBuilder.js');
  const protocolConsts = ler('ToledoProtocol.js');

  const builderOficialExiste = /function build\(/.test(oficialBuilder) && /checksum|toHex/.test(oficialBuilder);
  const parserOficialExiste = /function parse\(/.test(oficialParser);
  const rxFrameAware = /STX/.test(rxBuffer) && /ETX/.test(rxBuffer) && /class ToledoRxBuffer/.test(rxBuffer);
  const ackPorOperacao = /operationId/.test(ackRouter) && /awaitAck|deliver/.test(ackRouter);
  const engineUsaPipeline = /ToledoRxBuffer/.test(engine)
    && /ToledoAckRouter|ackRouter/.test(engine)
    && /OperationQueue|queue/.test(engine);
  const rootDelegaOficial = /protocol\/ToledoFrameBuilder/.test(rootBuilder)
    && /protocol\/ToledoFrameParser/.test(rootParser);
  const prix4LegadoSemChk = /sem CHK|SEM checksum|temporário|TEMPORÁRIO|11A|laborat|LEGADO/i.test(prix4Builder)
    || (!/toHex|checksum\.|xorChecksum/i.test(prix4Builder) && /ETX/.test(prix4Builder));

  const dpUnicoDownload = OFFICIAL.DOWNLOAD_PLU.wire === 'DP' && OFFICIAL.DOWNLOAD_PLU.name === 'downloadPlu';
  const deptNaoUsaDp = OFFICIAL.UPLOAD_DEPARTMENT.wire === 'UD';
  const cmdTableDp = /DOWNLOAD_PLU:\s*['"]DP['"]/.test(protocolConsts)
    && /UPLOAD_DEPARTMENT:\s*['"]UD['"]/.test(protocolConsts);

  const colisao = validarSemColisao();

  const ok = builderOficialExiste
    && parserOficialExiste
    && rxFrameAware
    && ackPorOperacao
    && engineUsaPipeline
    && rootDelegaOficial
    && colisao.ok
    && deptNaoUsaDp
    && dpUnicoDownload
    && cmdTableDp;

  return {
    ok,
    builderOficialExiste,
    parserOficialExiste,
    rxFrameAware,
    ackPorOperacao,
    engineUsaPipeline,
    rootDelegaOficial,
    prix4LegadoSemChk,
    dpUnicoDownload,
    deptNaoUsaDp,
    cmdTableDp,
    colisao,
    criterios: {
      umFrameBuilderOficial: builderOficialExiste && rootDelegaOficial,
      umParserOficial: parserOficialExiste && rootDelegaOficial,
      rxOrientadoAFrames: rxFrameAware,
      checksumObrigatorio: builderOficialExiste && parserOficialExiste,
      ackCorreto: ackPorOperacao,
      semColisaoComandos: colisao.ok
    }
  };
}

module.exports = {
  auditar,
  ToledoProtocolAudit: { auditar }
};
