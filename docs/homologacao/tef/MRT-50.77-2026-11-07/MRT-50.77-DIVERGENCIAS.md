# MRT-50.77 — Divergências (implementação × doc × fornecedor)

## Alinhamentos confirmados

| Tema | Status |
|---|---|
| DLL = pacote **1.83** `build64` (hash) | Alinhado |
| `nivel_log=1` + log em arquivo | Alinhado |
| Códigos estabelecimento/loja/terminal **não** obrigatórios no init | Alinhado (omitidos quando null) |
| Sem cadastro de adquirentes no contrato DLL inspecionado | Alinhado |
| Literal CRT `Debito` (MRT-50.73) | Alinhado aos examples / docs07 |
| Ambiente CDS `homologacao` + endpoint `app-partner.destaxa.cloud` | Identificado |

## Divergências / ressalvas (sem correção nesta sprint)

| # | Item | Detalhe | Impacto |
|---|---|---|---|
| D1 | Doc narrativa `docs/06` ainda cita `Débito` | CDS e examples usam `Debito` | Já tratado em 50.73; doc 06 residual |
| D2 | `avaliarMapeamentoTerminal` → `MAPEAMENTO_OFICIAL_PENDENTE` / `tefProntoParaVenda=false` com códigos null | Contrato init **não** exige códigos; flag de prontidão CDS permanece conservadora | UX/diagnóstico; **não** bloqueia montagem de `iniciaClientDestaxa` |
| D3 | Terminal “liberado” (fornecedor) × falhas Identificar 50.74–76 | Liberação cadastral ≠ sessão Identificar estável no dia 07/11 | Exige **verificação do ambiente**, não troca de DLL/params |
| D4 | Binários em `examples/java|dotnet` do zip 1.83 têm SHA **diferente** do `build64` | CDS usa `build64` (correto para produção x64) | Não usar DLLs dos examples |
| D5 | Cartões reais/teste sem cobrança (orientação fornecedor) | **Não testado** nesta sprint (restrito) | Próxima sprint autorizada |

## Não divergências inventadas

- Não se concluiu que códigos null impedem init (evidência 50.69/50.74: init `00`).
- Não se substituiu DLL nem se alterou identidade/MAC/rede.
