# Preparação da sessão NativeHost (sem execução nesta sprint)

Documento de preparação apenas. **Nenhum NativeHost foi iniciado na MRT-50.63.**

## Objetivo

Deixar explícitos os passos da próxima sessão controlada (init Client), sem pagamento.

## Passos

1. **Confirmar pré-condições ambientais**
   - PPC-930 em COM4 (OK).
   - `VSPagueClient.exe` ativo; portas 60603/60906 em LISTENING.
   - Gate `DESTAXA_REAL_TRANSACTION_ENABLED` **OFF** (exceto na sprint de cobrança autorizada).
   - Nenhum `DestaxaNativeHost.js` residual.
   - DLL hash de referência inalterado.

2. **Criar nova sessão NativeHost**
   - Bootstrap via caminho operacional: `TefManager` → `DestaxaRealAdapter` → `DestaxaHostBridge` → `DestaxaNativeHostClient` → processo `DestaxaNativeHost.js`.
   - Não reutilizar PID/sessão anterior encerrada (`STOPPED`).

3. **Inicializar o Client Destaxa**
   - `LOAD` DLL (quatro exports).
   - `iniciaClientDestaxa` com entrada documentada (versão/aplicação + parâmetros de log MRT-28).
   - **Não** enviar COM serial nessa entrada; TCP Client ≠ porta PinPad.

4. **Confirmar estado**
   - Diagnóstico: `CLIENT_INITIALIZED` e código de retorno `00`.
   - Registrar PID do Host e evidência JSONL.

5. **Preparar execução controlada (sprint futura)**
   - Revalidar `porta_com` persistida == COM4 (exige leitura autorizada do banco ou UI de configuração).
   - Revalidar CRT estático débito (`Débito` + `A vista`).
   - Somente com confirmação explícita imediata: habilitar gate, chamar caminho financeiro uma vez (R$ 1,00 débito).

## Proibições desta preparação

- Não habilitar `DESTAXA_REAL_TRANSACTION_ENABLED` fora da sprint de cobrança.
- Não chamar `iniciaTransacaoDestaxa` / `continuaTransacaoDestaxa` / `finalizaTransacaoDestaxa`.
- Não enviar comandos ao PinPad.
- Não abrir o banco oficial só para “testar” a sessão.
