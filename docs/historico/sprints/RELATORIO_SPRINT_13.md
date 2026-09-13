# Relatório Sprint 13 — Engenharia Reversa do Protocolo Toledo Prix 4 Uno

**Projeto:** CDS Sistemas — Motor Universal de Equipamentos  
**Data:** 01/07/2026  
**Escopo:** Preparar captura e análise de comunicação real MGV7 ↔ balança (sem implementar protocolo oficial).

---

## Resumo executivo

A Sprint 13 entrega um **ambiente completo de engenharia reversa** desacoplado da arquitetura do motor. O CDS pode registrar toda comunicação TCP via `PacketLogger`, analisar frames heuristicamente, documentar descobertas em `PROTOCOLO_TOLEDO.md`, exportar em múltiplos formatos e comparar capturas byte a byte por categoria operacional.

**Restrições respeitadas:** arquitetura, DriverRegistry, DriverLoader, BaseDriver, Queue, banco, DTOs e APIs existentes **não foram alteradas** — apenas módulos e rotas novas.

---

## Arquivos criados

### Módulo `engenharia-reversa/`

| Arquivo | Responsabilidade |
|---------|------------------|
| `ProtocolCaptureService.js` | Captura TX/RX integrada ao PacketLogger |
| `FrameAnalyzer.js` | Detecção heurística STX, ETX, ACK, NAK, ASCII, CRC, checksum, campos, payload |
| `ProtocolDocumentation.js` | Documentação automática por categoria + observações |
| `CaptureSession.js` | Modelo de sessão (data, driver, IP, pacotes, observações) |
| `CaptureExporter.js` | Export JSON, TXT, HEX, BIN, CSV, Wireshark |
| `CaptureImporter.js` | Import JSON, HEX, TXT, BIN |
| `WiresharkFormat.js` | Exportação compatível para análise manual |
| `EngenhariaReversaService.js` | Fachada orquestradora |
| `paths.js` | Diretórios de persistência |
| `index.js` | Exports públicos |

### API REST (nova)

| Arquivo | Rota base |
|---------|-----------|
| `backend/controllers/engenhariaReversaController.js` | `/api/engenharia-reversa` |
| `backend/rotas/engenhariaReversa.js` | |

### Documentação e testes

| Arquivo | Descrição |
|---------|-----------|
| `PROTOCOLO_TOLEDO.md` | Documento vivo (atualizado por capturas) |
| `tests/motor-equipamentos/engenharia-reversa-sprint13.test.js` | Suite automatizada |
| `RELATORIO_SPRINT_13.md` | Este relatório |

---

## Arquivos alterados (extensões aditivas)

| Arquivo | Alteração |
|---------|-----------|
| `backend/server.js` | Mount `/api/engenharia-reversa` |
| `backend/motores/equipamentos/laboratorio/PacketComparator.js` | Comparação por categoria (handshake, produto, promoção, departamento) |
| `backend/motores/equipamentos/laboratorio/LaboratorioEquipamentos.js` | `abrirCapturaMultiFormato()` para JSON/HEX/TXT/BIN |
| `package.json` | Script `test:equipamentos-engenharia-reversa` |

---

## Funcionalidades por etapa

| Etapa | Entrega |
|-------|---------|
| 1 — Captura | `ProtocolCaptureService` com TX/RX, timestamp, IP, porta, socket, driver via PacketLogger |
| 2 — Frame Analyzer | `FrameAnalyzer` — apenas marca padrões, nunca assume protocolo |
| 3 — Documentador | `ProtocolDocumentation` — categorias handshake…nak + observações |
| 4 — Sessões | `CaptureSession` com metadados completos |
| 5 — Exportação | JSON, TXT, HEX, BIN, CSV + Wireshark |
| 6 — Importação | JSON, HEX, TXT, BIN + integração laboratório |
| 7 — Comparador | `PacketComparator` melhorado por categoria |
| 8 — Wireshark | `WiresharkFormat` — timestamp, IPs, portas, delta, HEX, ASCII, TX/RX |
| 9 — Documentação | `PROTOCOLO_TOLEDO.md` atualizado via API |

---

## API REST

Base: `/api/engenharia-reversa` (token obrigatório)

| Método | Rota | Função |
|--------|------|--------|
| POST | `/captura/iniciar` | Inicia sessão |
| POST | `/captura/parar` | Finaliza sessão |
| GET | `/captura/status` | Status atual |
| POST | `/captura/exportar` | Exporta formatos |
| GET | `/capturas` | Lista capturas |
| GET | `/capturas/:id` | Abre captura |
| POST | `/captura/importar` | Importa arquivo/id |
| POST | `/analisar` | Analisa frame HEX |
| POST | `/observacao` | Adiciona observação |
| POST | `/documento/atualizar` | Regenera PROTOCOLO_TOLEDO.md |
| POST | `/comparar` | Compara capturas (opcional: categoria) |
| POST | `/wireshark` | Gera exportação estilo Wireshark |

**Persistência:** `ProgramData/CDS Sistemas/engenharia-reversa/capturas/`

---

## Cobertura dos testes

**Comando:** `npm run test:equipamentos-engenharia-reversa`  
**Resultado:** **10/10 OK**

| Módulo | Cenários |
|--------|----------|
| FrameAnalyzer | STX/ETX, ACK/NAK, campos, payload |
| CaptureSession | Metadados, observações, tempo |
| ProtocolDocumentation | Classificação, markdown |
| ProtocolCaptureService | Integração PacketLogger TX/RX |
| CaptureExporter | 6 formatos |
| CaptureImporter | JSON + HEX |
| WiresharkFormat | Delta entre pacotes |
| PacketComparator | Handshake idêntico, produto diferente |
| Integração TCP | Mock Toledo + atualização PROTOCOLO_TOLEDO.md |

---

## Itens identificados do protocolo (heurística)

> Hipóteses baseadas em frames temporários Sprint 11A e análise genérica. **Validar com capturas MGV7 reais.**

| Item | Observação |
|------|------------|
| STX | Byte `0x02` no início (padrão comum) |
| ETX | Byte `0x03` no final |
| Separador | Possível `0x1C` entre comando e payload |
| Comando | 2 caracteres ASCII maiúsculos após STX (ex.: PI, ST, HS) |
| ACK | Byte `0x06` |
| NAK | Byte `0x15` |
| Payload | Região entre separador e ETX — pode ser JSON UTF-8 (stub 11A) |
| CRC/Checksum | Não validado — aguardando captura MGV7 |

---

## Pendências

| Item | Prioridade |
|------|------------|
| Captura real com MGV7 em produção | Alta |
| Validação CRC/checksum 90AX | Alta |
| UI dedicada engenharia reversa no ERP | Média |
| Proxy TCP transparente (espelhar MGV7) | Média |
| Classificação automática confiável sem observação manual | Média |
| Download de capturas pelo browser | Baixa |

---

## Próximos passos — implementação oficial

1. **Capturar tráfego MGV7** com `ProtocolCaptureService` ativo durante operação real (cadastro produto, promoção, peso).
2. **Anotar observações** por pacote via `/api/engenharia-reversa/observacao`.
3. **Comparar sessões** MGV7 vs CDS stub (`comparar` por categoria).
4. **Validar CRC** nos frames reais e atualizar `FrameAnalyzer.identificarCRC`.
5. **Sprint 14 (proposta):** implementar `ToledoPrix4FrameBuilder` oficial substituindo frames temporários 11A.
6. **Sprint 14 (proposta):** integrar comandos reais no `ToledoPrix4Protocol` após documentação fechada.

---

## Fluxo recomendado MGV7

```
1. POST /api/engenharia-reversa/captura/iniciar
   { driver, equipamento_id, ip, porta, modelo, observacoes }

2. Operar balança via MGV7 (software oficial)

3. POST /api/engenharia-reversa/captura/parar

4. POST /api/engenharia-reversa/captura/exportar

5. POST /api/engenharia-reversa/documento/atualizar
   { captura_ids: ["..."] }

6. Revisar PROTOCOLO_TOLEDO.md
```

---

## Como executar

```bash
npm run test:equipamentos-engenharia-reversa
npm run test:equipamentos-laboratorio
```

---

*CDS Sistemas — Motor Universal de Equipamentos — Sprint 13 concluída.*
