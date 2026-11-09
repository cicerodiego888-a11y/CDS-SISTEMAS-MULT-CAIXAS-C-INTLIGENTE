# MRT-50.78 — Pendências

## Ajustes de sistema (driver/COM/CDS)

**Nenhum ajuste obrigatório identificado** nesta sprint para driver Gertec, associação COM4 ou cadastro CDS PinPad.

## Interação manual do operador (antes de verificação operacional futura)

| # | Ação | Por quê |
|---|---|---|
| M1 | Confirmar PinPad ligado e cabo USB estável | PnP OK agora; estado físico pode mudar |
| M2 | Na UI V$Pague, conferir porta PinPad = **COM4** (evitar COM3 fantasma) | `.conf` não expõe COM legível; UI é a fonte |
| M3 | Não selecionar/alterar COM3 | Entrada `CM_PROB_PHANTOM` |
| M4 | Observar se V$Pague permanece no mesmo PID/listen 60906 | Processo já ativo; não reiniciar nesta sprint |
| M5 | Qualquer Identificar / CRT / gate ON | Exige **nova autorização** explícita (fora desta MRT) |

## Pendências externas (já conhecidas — não resolvidas aqui)

| # | Item | Origem |
|---|---|---|
| E1 | `Connection breaked` pós-TLS no Identificar Partner Cloud | MRT-50.74–76 |
| E2 | Estabilidade do endpoint `app-partner.destaxa.cloud:60410` | MRT-50.75 |
| E3 | Confirmação Destaxa de prontidão sem compra | MRT-50.76 |

## Não verificável sem comunicação (restrito)

- Lock exclusivo da COM4 por handle  
- Resposta AT/APDU do PPC-930  
- Sucesso do Identificar remoto  
