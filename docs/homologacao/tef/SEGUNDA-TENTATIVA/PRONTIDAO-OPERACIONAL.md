# SEGUNDA TENTATIVA TEF — Prontidão operacional

**Data/hora:** 2026-11-10 ~17:18 BRT  
**Decisão:** ambiente **PRONTO** para a tentativa autorizada.  
**Ainda não executado:** permit, CRT, cobrança.

---

## Restauração realizada

1. PID **21968** (`node backend/server.js`, probe F12) **confirmado e encerrado**.
2. V$PagueClient **20760** **preservado**.
3. ERP iniciado com `npm start` → Electron **5700** (`electron.exe .` / `electron-erp.js`).
4. PDV oficial visível via fluxo do app (janela **CDS SISTEMAS - PDV**, operador Diego SUPER ADMIN, **Caixa Aberto**).
5. Porta **3001** atendida pelo Electron **5700** (não mais pelo probe).

---

## PIDs

| Papel | PID | Observação |
| --- | ---: | --- |
| Shell `npm start` | 20812 | wrapper npm |
| **ERP Electron (main + backend)** | **5700** | escuta `:3001`; DB oficial |
| Renderer (janela 1) | 18632 | filho de 5700 |
| Renderer (janela 2 / PDV) | 8800 | filho de 5700 |
| Utility NetworkService | 5220 | Chromium; **não** é DestaxaNativeHost |
| **NativeHost Destaxa** | — | **ainda não spawnado** (esperado até o 1º `prepararAutorizacao`) |
| V$PagueClient | **20760** | UP; Destaxa cloud |

---

## Pré-checks

| # | Item | Resultado |
| --- | --- | --- |
| 1 | Backend `:3001` | **OK** — Electron **5700** |
| 2 | Banco oficial | **OK** — `C:\ProgramData\MercantilFiscal\dados` (`dbDir` no boot) |
| 3 | TX id=2 | **OK** — `negado`; NSU/autorização/comprovantes null |
| 4 | TX ativa / UNKNOWN | **OK** — nenhuma |
| 5 | Lease / bloqueio | **OK para nova tentativa** — allocator em memória no processo **5700** (boot limpo). Histórico: `lease_1ddd…` ficou inconclusivo nos logs; leases posteriores já tiveram `LIBERAR` |
| 6 | Capacidade NativeHost | **OK** — Host sobe no **mesmo** Electron **5700** via `utilityProcess` no primeiro CRT; ainda não iniciado (sem cobrança) |
| 7 | Destaxa / PinPad | **OK** — `tef_configuracao` destaxa/homologação habilitado; Gertec PPC930 **COM4** ativo |
| 8 | Gate financeiro | **OFF** — `DESTAXA_REAL_TRANSACTION_ENABLED` não ligado |
| 9 | Permit | **não emitido** — ledger sem ISSUED ativos; só CONSUMED anteriores |

---

## Próximo passo (fora desta restauração)

Somente após confirmação explícita de prontidão pelo PO/operador no PinPad:

1. Emitir permit one-shot R$ 1,00 débito (novo; não reutilizar o anterior).
2. Uma única CRT no fluxo do PDV oficial.
3. Se UNKNOWN/timeout → parar; preservar estado; sem retry.

**Nenhuma cobrança foi executada nesta etapa.**
