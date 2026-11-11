# TEF-DESTAXA-51.32 — Auditoria pós-ativação Destaxa

**Data da auditoria:** 2026-11-10 ~15:40 BRT  
**Tipo:** diagnóstico exclusivo (sem operações financeiras)  
**Contexto Destaxa:** terminal confirmado como ativado; duas sessões locais com Identificar sem `00151`, Ativar OK, `Terminal ativado`, novo `.conf`, listener 60906.

**Proibições cumpridas:** sem CRT; sem `TX_*`; sem `iniciaClientDestaxa` / inicia|continua|finalizaTransacao; sem NativeHost; sem COM4; sem PIX/débito/crédito; sem alterar gate/banco/`.conf`/produção; sem reiniciar V$Pague; sem matar processos nem liberar portas.

---

## 1. Estado da configuração

| Item | Valor |
| --- | --- |
| Arquivo efetivo | `C:\VBI\V$Pague\Client\V$PagueClient_Destaxa_LojaACB_TACB0120.conf` |
| Único `.conf` no diretório Client | Sim (somente este) |
| `V$PagueClient.conf` genérico | **Ausente** |
| Tamanho | **89311** bytes |
| LastWriteTime | **2026-11-10 15:37:00** (coincide com Ativar da sessão atual) |
| SHA-256 | `344336ABA29142164781E4B4EA870665468AD204F63C371AE85059ED14CE9B51` |
| Versão no log (sessão 15:33) | `20261110083950` |
| Versão no log (sessão 15:37 — vigente) | **`20261110153350`** (confirma pedido Destaxa) |
| Integridade | Arquivo presente, gravado no Ativar, hash capturado; **não** editado nesta sprint |
| Formato | Blob serializado Java (não inspecionado além de metadados/hash/log) |

**Conclusão config:** `.conf` Destaxa LojaACB/TACB0120 vigente na versão **20261110153350**.

---

## 2. Quantidade de processos

| Métrica | Resultado |
| --- | --- |
| Processos `VSPagueClient` | **1** |
| PID | **20760** |
| StartTime | 2026-11-10 **15:36:59** |
| Path | `C:\VBI\Java\bin\VSPagueClient.exe` |
| CommandLine | `VSPagueClient -Xms64m -Xmx512m … -jar C:\VBI\V$Pague\Client\V$PagueClient.jar -h app-partner.destaxa.cloud -p 60410 -atv server -tls` |
| PPID | 18536 |

**Conclusão:** uma única instância. Nenhum processo finalizado por esta sprint.

---

## 3. PID e proprietário das portas 60603 e 60906

| Porta | Estado | PID proprietário | Processo |
| --- | --- | --- | --- |
| **60603** | LISTENING (0.0.0.0 e [::]) | **20760** | `VSPagueClient` |
| **60906** | LISTENING (0.0.0.0 e [::]) | **20760** | `VSPagueClient` |
| Sessões ESTABLISHED em 60906 | **Nenhuma** | — | CDS/NativeHost não conectados |

### Conflito `Address already in use: bind` (60603)

| Evidência | Detalhe |
| --- | --- |
| Log | `2026-11-10 15:37:02,289 ERROR … V$PagueClient (60603) - Application already running: Address already in use: bind` |
| Momento | ~1,4 s **após** Background + listen 60906 da mesma sessão (`vspg-id-82fea91a`) |
| Estado atual | Porta **60603** está LISTENING no **mesmo** PID 20760 |
| Segunda instância viva? | **Não** (count=1) |
| Interpretação | Erro residual de bind gráfico/secundário no boot; **não** há duas instâncias operacionais agora. Listener de automação 60906 subiu **antes** do ERROR e permanece ativo. |
| Ação nesta sprint | **Nenhuma** (não liberar porta, não matar, não reiniciar) |

---

## 4. Estado do Background / comunicação

### Duas ativações bem-sucedidas (10/11)

| Sessão | Horário | Identificar | Ativar | Conf versão | 60906 | Background |
| --- | --- | --- | --- | --- | --- | --- |
| `vspg-id-7c894d70` | 15:33:38–15:36:27 | Sem `00151` | `Terminal ativado` | `20261110083950` | listen OK | Sim |
| `vspg-id-82fea91a` | 15:36:59–**atual** | Sem `00151` | `Terminal ativado` | **`20261110153350`** | listen OK | Sim |

### Sessão vigente

| Item | Estado |
| --- | --- |
| Background | **Sim** — `aplicacao configurada com modo de processamento "Background"` |
| Última ativação | Concluída (`Terminal ativado` + conf `20261110153350` + listen 60906) |
| TLS Partner | Connected successful no boot |
| Canal local CDS | **60906 LISTENING** disponível; **sem** cliente CDS conectado (NativeHost **não** iniciado) |

---

## 5. Estado do backend CDS

| Item | Estado |
| --- | --- |
| Listener `:3001` | **Ausente** (apenas TIME_WAIT remanescentes) |
| `GET http://127.0.0.1:3001/login` | **UNREACHABLE** |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | **unset** (não alterado) |

---

## 6. Estado do PDV

| Item | Estado |
| --- | --- |
| `electron.exe` com `electron-pdv` / `--cds-forcar-local` | **Nenhum** |
| Nota | Mais cedo na 51.32 o PDV foi recuperado (HTTP 200) e depois encerrou (`exit_code: 0`); neste snapshot pós-ativação permanece **offline** |

---

## 7. Bloqueios encontrados

1. **CDS PDV/backend offline** — impede handshake CDS ↔ Client nesta janela (NativeHost também não autorizado/iniciado).  
2. **Erro de bind 60603 no log** — residual; portas hoje OK no PID único; monitorar se reaparecer em boots futuros com 2ª instância.  
3. **Nenhuma sessão ESTABLISHED em 60906** — comunicação local pronta no Client, ainda não exercitada pelo CDS (restrito).

**Não bloqueiam o Client Destaxa agora:** `00151` (ausente nas duas últimas ativações), ausência de `.conf` genérico, gate OFF (esperado).

---

## 8. Classificação final

| Componente | Status |
| --- | --- |
| Configuração Destaxa (`20261110153350`) | OK |
| Processos V$Pague (1×) | OK |
| Portas 60603 / 60906 | OK (dono único 20760) |
| Background + Ativar | OK |
| Backend `:3001` | OFF |
| PDV Electron | OFF |
| Handshake CDS | Não validado |
| CRT | Não executado |

### **Classificação final: PARTIAL**

Client Destaxa pós-ativação **operacional** (Identificar/Ativar OK, conf vigente, Background, 60906). Ambiente CDS **incompleto** neste instante (PDV/backend fora). Pronto para nova subida do PDV e, com autorização PO, handshake isolado — **sem** CRT.

---

## Anexo — Linha do tempo resumida (10/11)

```
15:33:38  Sessão 7c894d70 — Identificar OK → Ativar OK → conf 20261110083950 → Background/60906
15:36:27  Sessão 7c894d70 — Fechado
15:36:59  Sessão 82fea91a — boot PID 20760
15:37:00  Identificar OK → Ativar OK → conf 20261110153350 → Background/60906
15:37:02  ERROR bind 60603 (já em uso) — processo segue; 60603+60906 LISTENING em 20760
~15:40    Auditoria: 1 processo; CDS :3001/PDV offline
```

FIM DO RELATÓRIO TEF-DESTAXA-51.32 (auditoria pós-ativação).
