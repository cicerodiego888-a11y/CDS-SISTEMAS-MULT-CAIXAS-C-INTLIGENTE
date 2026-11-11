# SEGUNDA TENTATIVA TEF — BLOQUEIO (pré-checks)

**Data/hora:** 2026-11-10 ~17:13 BRT  
**Decisão:** **NÃO EXECUTAR** a cobrança.  
**Motivo:** falha de pré-condição obrigatória — PDV oficial ausente.

---

## Checklist

| # | Condição | Resultado |
| --- | --- | --- |
| 1 | TX id=2 **NEGADA** | **OK** — `status=negado`, NSU/autorização/comprovantes null |
| 2 | Lease anterior liberada (read-only) | **ATENÇÃO** — `lease_1ddd7a48f3655670` nos logs ficou em `MARCAR_INCONCLUSIVO` / `liberado=false`. Store do allocator é **em memória**; processo atual não é o Electron da TX2. Leases posteriores (`lease_40cb…`, `lease_84b9…`) foram adquiridas/liberadas depois. **Não bloqueia sozinho após subir PDV oficial limpo**, mas não há liberação explícita registrada para `lease_1ddd`. |
| 3 | Sem TX ativa / UNKNOWN | **OK** — lista vazia; só id=1 `nao_realizada` e id=2 `negado` |
| 4 | PDV oficial no backend correto | **FALHA** — **nenhum Electron/`electron-pdv.js`**. Em `:3001` há apenas `node backend/server.js` (probe F12, PPID shell), **não** o backend embutido do PDV |
| 5 | NativeHost / Destaxa no processo oficial | **FALHA** — NativeHost **zero**; sem PDV pai para `utilityProcess.fork` |
| 6 | Permit excepcional emitível R$1 débito | **OK (capacidade)** — `VALOR_HOMOLOGACAO_CENTAVOS=100`; tipos `cartao_debito`/`debito`; ledger só `CONSUMED` (permit anterior **não** reutilizável); gate env **OFF**; COM4 Gertec PPC-920/930 presente; V$PagueClient **20760** UP |

---

## Ambiente observado

| Item | Estado |
| --- | --- |
| `:3001` | `node` PID **21968** → `backend/server.js` (não-oficial para esta operação) |
| Electron PDV | **DOWN** |
| NativeHost Destaxa | **DOWN** |
| V$PagueClient | **20760** UP |
| PinPad | **COM4** PPC-920/930 CDC USB-to-Serial |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | **OFF** (não ligado) |
| Banco | `C:\ProgramData\MercantilFiscal\dados\mercadao.db` |

---

## Ação ao PO

A cobrança de **R$ 1,00 débito** **não foi iniciada**.  
Nenhum permit foi emitido. Nenhuma chamada a `/api/tef/pagar`. TX id=2 **não** alterada.

Para desbloquear a segunda tentativa autorizada:

1. Subir o **PDV oficial** (`electron-pdv.js --cds-forcar-local`) com operador logado.
2. Confirmar que `:3001` é o backend **do Electron** (não um `node server.js` órfão).
3. Revalidar NativeHost sob o PID do PDV (filho via utilityProcess) no primeiro `prepararAutorizacao`.
4. Só então emitir permit one-shot novo e executar **uma** CRT no fluxo do PDV.

Aguardando decisão do PO para subir o PDV oficial e retomar o GO.
