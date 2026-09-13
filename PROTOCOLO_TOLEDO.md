# Protocolo Toledo Prix 4 Uno — Documentação por Engenharia Reversa

> **Aviso:** Documento gerado automaticamente pelo CDS. Não constitui especificação oficial.
> Baseado em capturas TCP entre MGV7 e balança. Hipóteses devem ser validadas.

**Última atualização:** 2026-07-10T19:35:49.959Z

---

## Resumo

- Frames analisados: **2**
- Padrões STX observados: 2
- Padrões ETX observados: 2
- Padrões ACK observados: 0
- Padrões NAK observados: 0
- Hipóteses CRC: 2
- Hipóteses Checksum: 0

## Frames descobertos

### Frame #0 (TX) — categoria: `ping`

- HEX: `02 50 4E 1C 7B 22 74 73 22 3A 31 37 38 33 37 31 32 31 34 39 39 32 35 7D 03`

### Frame #1 (RX) — categoria: `desconhecido`

- HEX: `02 41 4B 1C 7B 22 6F 6B 22 3A 74 72 75 65 2C 22 63 6F 6D 61 6E 64 6F 22 3A 22 50 4E 22 2C 22 72 65 66 65 72 65 6E 63 69 61 22 3A 7B 22 74 73 22 3A 31 37 38 33 37 31 32 31 34 39 39 32 35 7D 7D 03`

## Comandos identificados (hipótese)

- **PN**: 1 ocorrência(s)
- **AK**: 1 ocorrência(s)

## Padrões

| Padrão | Ocorrências |
|--------|-------------|
| STX | 2 |
| ETX | 2 |
| ACK | 0 |
| NAK | 0 |
| CRC | 2 |
| CHECKSUM | 0 |

## Categorias documentadas

- **handshake**: 0 frame(s)
- **ping**: 1 frame(s)
- **status**: 0 frame(s)
- **produto**: 0 frame(s)
- **departamento**: 0 frame(s)
- **promocao**: 0 frame(s)
- **etiqueta**: 0 frame(s)
- **peso**: 0 frame(s)
- **ack**: 0 frame(s)
- **nak**: 0 frame(s)
- **desconhecido**: 1 frame(s)

## Campos conhecidos (heurística)

- possivel_stx
- possivel_comando_ascii
- possivel_etx

## Campos desconhecidos

- possivel_separador@3

## CRC / Checksum

_Aguardando validação com capturas MGV7 reais._

## ACK / NAK

- ACK hipotético: byte `0x06`
- NAK hipotético: byte `0x15`

## Observações

_Adicione observações via API ou durante captura._
