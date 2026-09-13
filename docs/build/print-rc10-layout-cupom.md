# PRINT-RC1.0 — Novo layout profissional do Cupom Fiscal (DANFE NFC-e)

## Motor identificado

| Tecnologia | Uso no CDS |
|---|---|
| **HTML + CSS** | Cupom Fiscal / DANFE NFC-e (`backend/services/fiscal/danfe.js`) |
| Chromium / Electron | Pré-visualização e impressão térmica |
| ESC/POS | **Somente TEF** — não usado no DANFE NFC-e |

Esta sprint altera **somente o layout HTML** do cupom.

## Não alterado

- XML NFC-e
- Assinatura digital
- QR Code (URL / payload SEFAZ)
- Tributação / cálculos
- TEF
- Separação Fiscal / Não Fiscal

## Layout

- Nome Fantasia em destaque (fonte maior + negrito)
- Razão Social imediatamente abaixo
- CNPJ, endereço (linhas curtas) e telefone (se houver)
- Ícones SVG monocromáticos leves (empresa / local / telefone)
- Separadores discretos (`hr.sep`)
- Produtos em colunas: Cód | Descrição | Qtd | Vl.Unit | Total
- TOTAL em destaque
- Pagamentos alinhados (PIX, Dinheiro, Cartão, Troco)
- QR centralizado com margem
- Rodapé: chave, protocolo, data/hora, agradecimento
- Largura responsiva **58 mm** / **80 mm** (`empresa.larguraMm` ou config `fiscal_danfe_largura_mm`)

## Configuração

Chaves usadas no cabeçalho (já existentes + largura opcional):

- `nome_fantasia`
- `razao_social`
- `nome_empresa` (fallback)
- `telefone`
- `fiscal_emitente_*` / `endereco`
- `fiscal_danfe_largura_mm` (`58` ou `80`, padrão `80`)

## Testes

```bash
npm run test:print-layout
```
