# MRT-50.60 — Verificação de comunicação com PinPad Gertec PPC-930

**Status: BLOQUEADA**

Gerado em 2026-11-07T19:36:00Z. Investigação e enumeração Windows somente leitura. Nenhuma função da DLL foi chamada. `iniciaClientDestaxa` não foi repetida. Gate financeiro OFF. Sem venda, débito, crédito, PIX, `iniciaTransacaoDestaxa`, `continuaTransacaoDestaxa`, `finalizaTransacaoDestaxa`, banco oficial ou alteração de driver/V$Pague. Artefatos da MRT-50.59 preservados (hashes reconfirmados).

Diretório: `docs/homologacao/tef/MRT-50.60-20261107T193600Z`

## 1. Documentação oficial Destaxa 1.83

Fonte: `C:\Users\cicer\Desktop\DLL DESTAXA\1_83-20260831T165940Z-1-001\1_83\docs\04-interface-dll-ac.md`

A DLL documenta **somente quatro APIs**:

| Função | Natureza documentada | Adequada a consulta não financeira de PinPad? |
| --- | --- | --- |
| `iniciaClientDestaxa` | Inicia e configura a DLL (abertura de terminal) | Não — não consulta PinPad; já comprovada na MRT-50.59 (`00`) |
| `iniciaTransacaoDestaxa` | Inicia uma transação | Não — operação financeira/transacional |
| `continuaTransacaoDestaxa` | Continua transação interativa (inclui mensagens de senha no PinPad) | Não — exige transação em curso |
| `finalizaTransacaoDestaxa` | Confirma ou cancela a transação | Não — fechamento financeiro |

Tabela PE da DLL de referência (sem `LoadLibrary`/koffi): exatamente os mesmos quatro exports — `continuaTransacaoDestaxa`, `finalizaTransacaoDestaxa`, `iniciaClientDestaxa`, `iniciaTransacaoDestaxa` (`dll-pe-exports.txt`).

Não há API documentada de:

- consulta de disponibilidade do terminal/PinPad;
- identificação do PinPad;
- estado ou conexão do dispositivo;
- obtenção de informações do hardware.

### CST e CPF

Em `06-api-iniciatransacaodestaxa.md`, `CST` (“Consulta geral”) e `CPF` (“Usar pinpad para solicitar digitação do CPF”) são **códigos de operação de `iniciaTransacaoDestaxa`**. São início de fluxo transacional, não funções isoladas de status. Estão fora do escopo autorizado desta sprint.

## 2. Mecanismo de comunicação

| Camada | Evidência |
| --- | --- |
| CDS → DLL Destaxa | Quatro exports; PinPad não é endereçado por API própria |
| DLL → Client V$Pague | TCP/local ao Client Background (portas 60603/60906 na MRT-50.58/59) |
| Client → PinPad | Middleware do provedor; CDS não controla o hardware diretamente (`GertecPPC930.js`: `controleViaMiddleware: true`) |
| Windows ↔ dispositivo | USB CDC serial Gertec (`VID_1753` / `PID_C902`) |

Conclusão: a comunicação efetiva com o PinPad, no contrato Destaxa 1.83, ocorre **dentro do fluxo transacional** mediado pelo V$Pague, não por uma chamada de status da DLL.

## 3. Identificação Windows do Gertec PPC-930

Enumeração somente leitura (`windows-pinpad-enumeration.json`):

| Evidência | Valor |
| --- | --- |
| Porta serial ativa | `COM4` — `PPC-920/930 CDC USB-to-Serial Port (COM4)`, status OK |
| PnP | Mesmo dispositivo OK em COM4; entrada residual COM3 com status `Unknown` |
| USB | `USB\VID_1753&PID_C902\...` |

O hardware PPC-920/930 está presente no Windows em **COM4**. Isso **não** comprova comunicação Destaxa↔PinPad via DLL.

## 4. Consulta de status via DLL

**Não executada.** Motivo: inexistência de função segura e documentada exclusivamente para consulta não financeira. Improvisar `CST`/`CPF` ou qualquer `iniciaTransacao*` violaria as restrições. `iniciaClientDestaxa` não foi repetida (sem necessidade técnica nova além da MRT-50.59).

Eventos JSONL: `mrt5060.start`, `gate.check`, `dll.hash`, `windows.enumeration`, `dll.exports.pe`, `consulta.blocked`, `mrt5060.end`.

## 5. Gate, hash e ausência de transações

| Item | Resultado |
| --- | --- |
| Gate Process/User/Machine | OFF (`0` / vazio / vazio) |
| DLL SHA-256 | `65972ACA50ED6CA90ECA4B88A73489E57D9BA08A73D4077A4CCC3EBDC4D69279` (igual à MRT-50.58/59) |
| Transações financeiras | nenhuma |
| Chamadas nativas Destaxa nesta sprint | nenhuma |
| MRT-50.59 | artefatos inalterados |

## 6. Arquivos desta sprint

- `MRT-50.60-PINPAD-COMUNICACAO.md`
- `mrt-50.60-resultado.json`
- `observability.jsonl`
- `windows-pinpad-enumeration.json`
- `dll-pe-exports.txt`
- `destaxa-docs-inventory.txt`
- `mrt-50.59-artifacts-snapshot.json`

Nenhum arquivo da MRT-50.59 foi modificado. Nenhum teste unitário do repositório foi alterado.

## 7. Próxima pendência técnica

Para comprovar comunicação CDS↔DLL↔PinPad dentro do contrato Destaxa 1.83 será necessário um procedimento **autorizado de fluxo transacional controlado** (por exemplo CRT mínimo já reservado de R$ 1,00), com gate financeiro explicitamente liberado para aquela execução. Esta sprint **não** utiliza essa autorização.

Alternativa documental: solicitar à Destaxa se existe API/versão futura de diagnóstico de PinPad fora do ciclo `iniciaTransacao*`. No pacote 1.83 analisado, isso não existe.
