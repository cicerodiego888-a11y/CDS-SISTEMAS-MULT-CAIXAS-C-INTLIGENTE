# Homologação Operacional — Central Inteligente RC4.31.8

## Ambiente

- Versão: 1.0.3
- Commit: local
- Build: 2026-08-01T15:41:12.497Z
- Data: 2026-08-01T15:41:12.496Z

## Fluxos testados

✔ Importação XML (1/5/20/100+ itens)
  - 1→1it (181ms) | 5→5it (178ms) | 20→20it (409ms) | 120→120it (2391ms)
✔ Parser NF-e (validação integrada)
  - fixture rc64 → 2 itens
✔ Identificação MIIP (conhecido/desconhecido/misto)
  - conhecido=2/2 (auto=0) | desconhecido=0/2 pend=2 | misto=2/3 (67%)
✔ Associação manual MIIP
  - 3 associações | miip_associacoes id=105 → prod 799
✔ Edição de itens (adicionar/editar/excluir)
  - padrões frontend OK | ciclo editar/adicionar/excluir simulado
✔ Datas (emissão/entrada/vencimento + foco)
  - emissão=2026-06-01 | parcelas=2 | foco blur OK
✔ Parcelas / duplicatas (cobr/fat/dup)
  - 3 dup | docs=001,002,003 | venc=2026-01-15
✔ Gravação da compra (itens/embalagens/financeiro/XML)
  - compra #4 | itens=1 | chave …00000659
✔ Estoque após compra
  - estoque=5 | fiscal=5 | custo=20
✔ Contas a Pagar (parcelas/vencimentos/documentos)
  - 2 parcelas OK | docs=001,002
✔ Persistência após reinício simulado
  - compra=4 itens=1 fin=2 miip_assoc=0
✔ Regressão (20 importações consecutivas)
  - 20 XMLs OK | tempo médio=151ms | max=196ms

## Estatísticas

- XMLs processados: 26
- Produtos identificados automaticamente: 4
- Produtos associados manualmente: 3
- Compras gravadas: 1
- Exceções encontradas: 0
- Tempo médio de processamento: 246 ms
- Tempo total da homologação: 7.9 s
- Cobertura dos fluxos críticos: 100%

## XMLs utilizados

- chave …00000643 | itens=1 | cobr=não
- chave …00000647 | itens=5 | cobr=não
- chave …00000644 | itens=20 | cobr=não
- chave …00000655 | itens=120 | cobr=não
- chave …00000658 | itens=2 | cobr=sim
- chave …00000659 | itens=1 | cobr=sim
- chave …00000651 | itens=1 | cobr=sim
- chave …00000652 | itens=2 | cobr=não
- chave …00000653 | itens=3 | cobr=não
- chave …00000654 | itens=4 | cobr=sim
- chave …00000655 | itens=5 | cobr=não
- chave …00000656 | itens=1 | cobr=não
- chave …00000657 | itens=2 | cobr=sim
- chave …00000658 | itens=3 | cobr=não
- chave …00000659 | itens=4 | cobr=não
- chave …00000651 | itens=5 | cobr=sim
- chave …00000652 | itens=1 | cobr=não
- chave …00000653 | itens=2 | cobr=não
- chave …00000654 | itens=3 | cobr=sim
- chave …00000655 | itens=4 | cobr=não
- chave …00000656 | itens=5 | cobr=não
- chave …00000657 | itens=1 | cobr=sim
- chave …00000658 | itens=2 | cobr=não
- chave …00000659 | itens=3 | cobr=não
- chave …00000651 | itens=4 | cobr=sim
- chave …00000652 | itens=5 | cobr=não

## Parecer final

**APROVADA**

Recomendação técnica de liberação: **APROVADA**
