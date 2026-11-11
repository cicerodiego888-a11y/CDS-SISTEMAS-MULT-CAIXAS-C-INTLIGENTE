# Primeira venda homologação — CDS + Destaxa

**Data:** 2026-11-10  
**Escopo:** conclusão funcional no PDV oficial. Sem auditoria genérica. Sem TX até GO do PO.

---

## Estado confirmado (agora)

| Item | Estado |
| --- | --- |
| PDV Electron **10292** (`electron-pdv.js --cds-forcar-local`) | UP; backend `:3001` |
| V$PagueClient **20760** | UP; `:60603` / `:60906` |
| NativeHost TEF | **zero** (runner 15164 / Host 2176 já encerrados) |
| Gate `DESTAXA_REAL_TRANSACTION_ENABLED` | **OFF** (deliberado) |
| Ledger excepcional | só autorizações **CONSUMED** — falta ISSUED no momento da venda |
| `tef_configuracao` | `destaxa` / `homologacao` / habilitado |
| `tef_operacoes.debito` | **1** |
| `tef_pinpads` | Gertec PPC930 **COM4** habilitado |
| PinPad PnP | COM4 = PPC-920/930 CDC USB-to-Serial |
| Persistência 00 pré-FINALIZE(0) | já no código (`exigirEvidenciasAntesFinalize: true`) |
| Transação histórica `id=1` | `nao_realizada` (INEXISTENT 51.27) — não bloqueia nova |

---

## O que foi corrigido (operacional)

Nenhuma alteração de código foi necessária para o caminho oficial de venda.

Correção operacional já feita (51.37): **remoção do NativeHost de inspeção** (PPID runner). Sem isso, a venda no PDV criaria um **segundo** Host e competiria com o V$Pague.

Arquitetura oficial já correta:

`PDV 10292` → `TefManager.autorizar` → `DestaxaRealAdapter.prepararAutorizacao` → `DestaxaHostBridge` → `obterClienteCompartilhado()` → `utilityProcess.fork(DestaxaNativeHost)` **filho do 10292** → LOAD → INIT_CLIENT → (com permit) INSERT → CRT → evidências 00 → FINALIZE(0).

---

## Como o PDV utilizará o NativeHost

1. No **primeiro** `prepararAutorizacao` do processo 10292, o singleton sobe **um** NativeHost via `electron.utilityProcess.fork`.
2. LOAD + INIT_CLIENT ocorrem nesse Host **antes** de qualquer TX.
3. O ciclo CRT (`TX_START` / `CONTINUE` / `FINALIZE`) usa **somente** esse Host.
4. Não há bridge para Host externo; não reutilizar runner; não duplicar.

**Reinício do PDV:** **não necessário** para essa arquitetura. Só seria necessário se o 10292 caísse, se o código em disco mudasse após o boot, ou se um Host órfão/duplicado aparecesse.

---

## Como será a primeira venda (após GO do PO)

### Pré-condições no momento do GO

- Operador presente no PinPad COM4.
- PDV 10292 e V$Pague 20760 ainda UP.
- Nenhuma outra operação TEF em andamento.
- Uma única venda: **R$ 1,00** / **débito** / Gertec COM4.

### Passos

1. **PO confirma verbalmente** a autorização da cobrança real.
2. Emitir permit one-shot (**não liga gate**):

```text
node docs/homologacao/tef/TEF-DESTAXA-PRIMEIRA-VENDA/emitir-auth-oneshot.js
```

   TTL padrão: **30 minutos**. Ledger: `%LOCALAPPDATA%\CDS-SISTEMAS\tef\destaxa-autorizacao-excepcional.json`.

3. No PDV oficial: criar venda **R$ 1,00**, pagamento **débito TEF**.
4. Fluxo automático:
   - spawn NativeHost sob **10292** (se ainda não existir);
   - LOAD + INIT_CLIENT;
   - localiza ISSUED compatível (R$1 / débito / CRT);
   - INSERT `tef_transacoes` (pendente);
   - consome permit → habilita CRT só nessa operação;
   - PinPad coleta; retorno **00** → **CONFIRMAR_PERSISTENCIA** (NSU/autorização/comprovantes) → **FINALIZE(0)**.
5. Se status **UNKNOWN** / inconclusivo: **parar**. Sem retry automático. Sem segunda cobrança. Sem ligar gate global.

### Proibido nesta operação

- Gate global ON sem necessidade.
- Runner auxiliar / endpoint provisório.
- Fabricar NSU / autorização / comprovante / UPDATE de aprovação.
- Evento fiscal/SEFAZ fora do fluxo normal autorizado.
- Reinício automático do PDV.

---

## Bloqueios concretos (antes do GO)

| Bloqueio | Impacto | Resolução |
| --- | --- | --- |
| Sem autorização excepcional **ISSUED** | `prepararAutorizacao` → `pronto:false` (gate OFF) | Emitir script **após** GO verbal |
| Sem GO do PO | Nenhuma chamada financeira autorizada | Aguardar confirmação presencial |
| NativeHost ainda não filho do 10292 | Esperado (zero Host agora) | Sobe no 1º `prepararAutorizacao` da venda |

**Não são bloqueios:** reinício do PDV; endpoint INIT-only; gate global; COM4/cadastro débito; persistência pré-FINALIZE.

---

## Critério de sucesso

- NativeHost TEF com **PPID = 10292** (um só).
- Transação nova (≠ id=1) com retorno **00**, NSU/autorização/comprovantes persistidos **antes** do FINALIZE(0).
- Gate permanece OFF; permit consumido (CONSUMED).
- Uma única operação; operador acompanhou o PinPad.
