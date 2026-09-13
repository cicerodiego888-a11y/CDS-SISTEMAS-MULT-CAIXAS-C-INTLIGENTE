# Inventário @deprecated — RC5 Hardening

**Data:** 2026-07-10  
**Escopo:** Confirmar / documentar / manter — sem remoção estrutural de contratos públicos.

| Artefato | Decisão RC5 | Explicação |
|---|---|---|
| `CentralConfigService` | **Mantido (adapter interno)** | Provider oficial = `CentralConfiguracaoService`. Adapter só para chaves de sync. |
| `backend/rotas/dfe.js` | **Mantido** | HTTP 410 — redireciona para Central |
| Upload XML em `compras.js` | **Mantido** | HTTP 410 — Upload Enterprise na Central |
| `distribuicaoDFe.sincronizarNotasRecebidas` (legado) | **Mantido** | `@deprecated` — usar Central sync |
| `MiipSinonimosRepository` | **Mantido** | `@deprecated RC1` — Synonyms usa JSON; reservado MIIP V2 |
| `MiipEstatisticasRepository` | **Mantido** | `@deprecated RC1` — agregados via decisões; reservado MIIP V2 |
| `equipamentos/dto/*` | **Mantido** | Re-export → `contracts/` (compat) |
| `MotorAssociacaoFornecedor` (raiz engines) | **Mantido** | Re-export → `engines/fornecedor/` |
| `BaseDriver` métodos antigos | **Mantido** | Aliases → `sincronizar*` |
| Tabelas `notas_recebidas*` | **Mantido** | Legado DB; migração futura documentada |
| `exportarContabilidadeService` leitura legada | **Mantido** | Documentado; migração futura |

Nenhum `@deprecated` sem explicação após RC5.

---

# Inventário TODO / FIXME — RC5 Hardening

| Local | Classificação | Ação RC5 |
|---|---|---|
| Equipamentos transport BT/USB/Serial | **Hardware V2** | Mantido — preparação |
| Equipamentos Discovery/Monitor | **Hardware V2** | Mantido — preparação |
| TEF PayGo/SiTef adapters SDK | **SDK V2** | Mantido — preparação |
| `equipamentos/utils` extrair PDV | **Planejado V2** | Mantido |
| Comentários `TODOS` em enums (status) | **Não é TODO** | Ignorado (constante) |

**FIXME / XXX / HACK / TEMP:** nenhum encontrado no backend dos pilares V1.

Comentários obsoletos de “exceção Diagnóstico→soapClient” atualizados na documentação Fiscal/Central.
