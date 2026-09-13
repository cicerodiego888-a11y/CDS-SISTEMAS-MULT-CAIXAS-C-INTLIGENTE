const express = require("express");
const router = express.Router();
const db = require("../database");

// 🔎 detectar impressora automaticamente
function detectarImpressoraCupom(impressoras) {
  return impressoras.find(imp =>
    imp.name.toLowerCase().includes("cupom")
  );
}

router.post("/imprimir", async (req, res) => {
  try {
    const win = global.mainWindow;

    if (!win) {
      return res.status(500).json({
        sucesso: false,
        mensagem: "Janela principal não disponível (não está rodando em Electron)"
      });
    }

    // 1️⃣ buscar impressora salva
    db.get(
      "SELECT valor FROM configuracoes WHERE chave = 'impressora_cupom'",
      async (err, row) => {
        if (err) {
          return res.status(500).json({ sucesso: false });
        }

        let nomeImpressora = row?.valor;

        const impressoras = await win.webContents.getPrintersAsync();

        // 2️⃣ se não tiver salva → detectar automaticamente
        if (!nomeImpressora) {
          const encontrada = detectarImpressoraCupom(impressoras);

          if (encontrada) {
            nomeImpressora = encontrada.name;

            // salvar no banco
            db.run(
              `INSERT INTO configuracoes (chave, valor)
               VALUES ('impressora_cupom', ?)
               ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
              [nomeImpressora]
            );
          }
        }

        // 3️⃣ imprimir
        const printOptions = {
          silent: true,
          printBackground: true
        };

        // Só definir deviceName se tiver impressora configurada
        if (nomeImpressora) {
          printOptions.deviceName = nomeImpressora;
        }

        win.webContents.print(printOptions);

        res.json({
          sucesso: true,
          impressora: nomeImpressora || "padrão do Windows"
        });
      }
    );
  } catch (error) {
    console.error(error);

    res.status(500).json({
      sucesso: false,
      mensagem: error.message
    });
  }
});

router.post('/tef', async (req, res) => {
  try {

    const {
      comprovante_cliente,
      comprovante_estabelecimento
    } = req.body;

    if (!comprovante_cliente && !comprovante_estabelecimento) {
      return res.status(400).json({
        error: 'Nenhum comprovante TEF informado.'
      });
    }

    const escpos = require('escpos');
    escpos.USB = require('escpos-usb');

    const device = new escpos.USB();

    const printer = new escpos.Printer(device, {
      encoding: 'GB18030'
    });

    device.open((err) => {

      if (err) {
        console.error('Erro impressora TEF:', err);

        return res.status(500).json({
          error: err.message
        });
      }

      printer
        .align('CT')
        .style('B')
        .size(1, 1)
        .text('COMPROVANTE TEF')
        .text('------------------------------')
        .style('NORMAL')
        .align('LT');

      if (comprovante_cliente) {

        printer
          .text('VIA CLIENTE')
          .text('------------------------------');

        comprovante_cliente
          .split('\n')
          .forEach(linha => printer.text(linha));

        printer.text(' ');
      }

      if (comprovante_estabelecimento) {

        printer
          .text('VIA ESTABELECIMENTO')
          .text('------------------------------');

        comprovante_estabelecimento
          .split('\n')
          .forEach(linha => printer.text(linha));
      }

      printer
        .text(' ')
        .text(' ')
        .cut()
        .close();

      res.json({
        success: true
      });

    });

  } catch (error) {

    console.error('Erro impressão TEF:', error);

    res.status(500).json({
      error: error.message
    });
  }
});

module.exports = router;
