# RC6.4 — Homologação do Fluxo Completo da Central Inteligente

**Data:** 2026-07-11T01:52:47.284Z  
**Suite:** `npm run test:central-entradas-rc6.4`  
**Resultado dos testes:** 13 ok / 0 falha(s)  
**Parecer técnico:** **HOMOLOGADO COM RESSALVAS**

## Escopo

Validação ponta a ponta do pipeline oficial com fixtures reais.  
**Nenhuma regra de negócio foi alterada** nesta RC.

Não modificados: Parser Oficial, MIIP RC1, Plataforma Fiscal, UrlResolver, Registry, SOAP, Compras/`saveCompra()`, Central Revisão, Máquina de Estados.

## Fluxograma executado

```
SEFAZ (simulado via fixtures)
  ├─ C1 RES_NFE → AGUARDANDO_XML_COMPLETO → PROC_NFE (mesmo id)
  │              → SINCRONIZADA → Parser → MIIP → [Revisão?] → EM_COMPRA → GRAVADA
  ├─ C2 PROC_NFE direto → SINCRONIZADA → Pipeline (sem AGUARDANDO_XML_COMPLETO)
  ├─ C3 Duplicata → sem novo documento / sem nova compra
  ├─ C4 XML inválido → ERRO + statusDetalhe
  └─ C5/C6 RES_EVENTO / PROC_EVENTO_NFE → classificador OK (persistência: ver ressalvas)
```

## Evidências

| Métrica | Valor |
|---------|-------|
| Documentos criados (aprox.) | 3 |
| Compras vinculadas | 1 |
| Tempo médio C1/C2 | 118.0 ms |
| Duplicidade de chave | ausente (C1/C3) |
| Históricos órfãos (amostra) | 0 |

Eventos oficiais: DOCUMENTO_RECEBIDO, DOCUMENTO_ATUALIZADO, DOCUMENTO_PROCESSADO, COMPRA_GRAVADA, SYNC_CONCLUIDA.

## Pontos de atenção

- RES_EVENTO/PROC_EVENTO_NFE: classificador OK, mas persistência ainda trata como nota (SINCRONIZADA) quando há chNFe — risco de Parser/ERRO. Tratar em RC futura (não escopo RC6.4).

## Critérios de aceite

- Único documento por chave: OK
- Único pipeline NF-e: OK
- Única compra vinculada no C1: OK
- Ciclo de vida completo: OK
- Sem transições inválidas no C1: OK
- Eventos DF-e isolados do Parser: pendente (ressalva)

## Justificativa do parecer

Ciclo principal NF-e (C1–C4) homologado. Ressalva: RES_EVENTO/PROC_EVENTO_NFE são classificados, mas a persistência ainda pode tratá-los como nota (SINCRONIZADA) e encaminhar ao Parser — RC futura.
