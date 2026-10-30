-- MRT-03 — Migration PROPOSTA (NÃO aplicar ao banco oficial nesta sprint)
-- Objetivo: persistir Terminal TEF lógico e Dispositivo físico separados do PDV (terminais.id).
-- Hostname/MAC permanecem em `terminais.hostname` (estação), nunca como pdvId.

-- Terminal lógico TEF (provedor + código lógico + ambiente)
CREATE TABLE IF NOT EXISTS tef_terminais_logicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pdv_id INTEGER NOT NULL,                 -- FK lógica → terminais.id (PDV CDS)
  empresa_codigo TEXT,                     -- opcional (código provedor / CDS)
  loja_codigo TEXT,                        -- opcional
  provedor TEXT NOT NULL,                  -- destaxa|sitef|paygo|...
  ambiente TEXT NOT NULL DEFAULT 'simulacao',
  codigo_logico_provedor TEXT,             -- ex.: terminal_codigo Destaxa (≠ PinPad)
  estado TEXT NOT NULL DEFAULT 'NAO_PROVISIONADO',
    -- ATIVO | INATIVO | INDISPONIVEL | NAO_PROVISIONADO
  tef_configuracao_id INTEGER,             -- opcional vínculo com config legada
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pdv_id) REFERENCES terminais(id),
  FOREIGN KEY (tef_configuracao_id) REFERENCES tef_configuracao(id)
);

CREATE INDEX IF NOT EXISTS idx_tef_terminais_logicos_pdv
  ON tef_terminais_logicos(pdv_id);

CREATE INDEX IF NOT EXISTS idx_tef_terminais_logicos_estado
  ON tef_terminais_logicos(estado);

-- Dispositivo físico (PinPad COM/IP) — distinto do terminal lógico
CREATE TABLE IF NOT EXISTS tef_dispositivos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  terminal_tef_id INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'pinpad',     -- pinpad|pinpad_ip|virtual
  porta_com TEXT,
  ip TEXT,
  porta INTEGER,
  serial TEXT,
  fabricante TEXT,
  modelo TEXT,
  ativo INTEGER DEFAULT 1,
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (terminal_tef_id) REFERENCES tef_terminais_logicos(id)
);

CREATE INDEX IF NOT EXISTS idx_tef_dispositivos_terminal
  ON tef_dispositivos(terminal_tef_id);

-- NOTAS DE APLICAÇÃO FUTURA (MRT-04+):
-- 1) Não remover tef_configuracao singleton até cutover.
-- 2) Seed opcional: 1 TerminalTEF ATIVO por instalação a partir do LIMIT 1 atual.
-- 3) Não presumir N terminais Destaxa concorrentes no mesmo V$Pague Client.
-- 4) NÃO executar este script no banco oficial sem sprint dedicada de persistência.
