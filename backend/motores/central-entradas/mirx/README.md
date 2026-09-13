# MIRX — Motor Inteligente de Recuperação de XML (RC3.4.1 / RC3.4.2)

Fila única + worker único + Gate SEFAZ + backoff + **SLEEP/WAKEUP** (RC3.4.2).

## SLEEP (cStat 656)

Documento sai da fila. Sem tick útil, sem Gate, sem logs repetitivos.  
Em `proximaTentativa` → `MIRX_WAKEUP` → reentra na fila.

## Solicitação manual

`solicitarXmlManual(id)` — se Gate bloqueado, retorna mensagem e **não** enfileira.

## Backoff

5 → 15 → 30 → 60 → 120 → 240 → 480 → 1440 minutos
