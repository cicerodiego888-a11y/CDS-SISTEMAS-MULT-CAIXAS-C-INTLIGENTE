# Release Certification Report — RC4.32.0

## Ambiente

- Versão: 1.0.3
- Commit: b73ee19
- Build: 2026-09-23T16:13:19.015Z
- Hash app.asar: `f9ce01624111565784c4deee0fc248e9b7427b70e5aa5d858231bcb21edbcd54`
- Origem: instalador-desatualizado
- Data: 2026-09-23T16:31:10.760Z

## Resultados

✔ Inicialização do ERP
  - DB ok | pacote: instalador-desatualizado | asar: f9ce01624111…
✔ Login
  - user=rc4320_1790181069658 perfil=SUPER_ADMIN
✔ Cadastro de Produtos
  - CRUD ok | embalagem CX×12 | codigo=RC4320-1790181068381-P
✔ Compras
  - NF-e …00000064 | status=EM_REVISAO
✔ Financeiro
  - parser financeiro OK | parcela R$500 | registros financeiro=58
✔ Estoque
  - fiscal=6+3 | total=15 UN
✔ MIIP
  - MUC 10×12 → 120 UN (MULTIPLICADOR)
✔ Central Inteligente
  - documento 000064 processado
✔ NFC-e
  - homologação dest.xNome + módulo emissor presente
✔ NF-e
  - autorização cStat=100 | protocolo=123
✔ Relatórios
  - compras=2 fin=58 prod=391
✔ Performance
  - 2.4s | mem 29.9MB | sql=16

## Estatísticas

- Tempo total: 2.4s
- Memória máxima: 29.9 MB
- CPU user: 1844 ms
- Testes/etapas: 12
- Exceções: 0
- Consultas SQL: 16
- Cobertura funcional: 100%

## Status da Release

**APROVADA**
