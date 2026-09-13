/**
 * F12 POLICY RESOLVER - Frontend
 *
 * Fonte única: backend (controle + escopo).
 * O PDV consome o contexto pronto: ativo, podeAlterar, controle, escopo.
 */

window.F12PolicyResolver = {
  cache: {
    contexto: null,
    estadoGlobal: null,
    estadosCaixa: {},
    ultimaAtualizacao: 0
  },

  /**
   * Resolve o caixa de cadastro do terminal atual.
   * Fonte única: terminal → caixa_id. Nunca usa terminalId como caixaId.
   * @param {object} [contexto]
   * @returns {Promise<{ok: boolean, caixaId: number|null, erro: string|null}>}
   */
  async obterCaixaAtual(contexto) {
    const api = (typeof window !== 'undefined' && window.ObterCaixaAtual)
      || (typeof globalThis !== 'undefined' && globalThis.ObterCaixaAtual)
      || null;
    const resolver = api && typeof api.obterCaixaAtual === 'function'
      ? api.obterCaixaAtual.bind(api)
      : null;

    if (resolver) {
      return resolver(contexto);
    }

    console.warn('[F12] Não foi possível identificar o caixa atual.');
    return {
      ok: false,
      caixaId: null,
      erro: 'Não foi possível identificar o caixa atual.'
    };
  },

  /**
   * Contexto oficial do F12 para o caixa informado.
   * @param {number} caixaId
   * @returns {Promise<{ativo:boolean, podeAlterar:boolean, controle:string, escopo:string|null, caixaId:number}|null>}
   */
  async obterContexto(caixaId) {
    if (!caixaId) {
      console.warn('[F12] Não foi possível identificar o caixa atual.');
      return null;
    }

    try {
      const response = await fetch(`${API_URL}/f12/contexto/${caixaId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });

      if (!response.ok) {
        console.error('[F12] Failed to resolve contexto:', response.status);
        return null;
      }

      const data = await response.json();
      this.cache.contexto = data;
      this.cache.ultimaAtualizacao = Date.now();
      if (data.ativo !== undefined) {
        this.cache.estadosCaixa[caixaId] = data.ativo;
      }
      return data;
    } catch (error) {
      console.error('[F12] Error resolving contexto:', error);
      return null;
    }
  },

  /**
   * Resolve current F12 state for a cash register
   * @param {number} caixaId — caixas.id (nunca terminais.id)
   * @returns {Promise<boolean|null>}
   */
  async resolveF12Estado(caixaId) {
    const contexto = await this.obterContexto(caixaId);
    if (!contexto) {
      return this._fallbackParaLocalStorage();
    }
    return contexto.ativo === true;
  },

  /**
   * Compatibilidade: devolve a política legada derivada do modelo oficial.
   * O frontend novo deve usar obterInfo()/obterContexto().
   */
  async obterPolitica() {
    const info = await this.obterInfo();
    return info.politicaLegada || info.politica || 'POR_CAIXA';
  },

  /**
   * Toggle F12 state for current cash register (tecla F12).
   * A permissão é decidida no backend (podeAlterar).
   */
  async alternarF12(caixaId) {
    if (!caixaId) {
      console.error('[F12] Não foi possível identificar o caixa atual.');
      return { success: false, error: 'Não foi possível identificar o caixa atual.' };
    }

    try {
      const response = await fetch(`${API_URL}/f12/caixas/${caixaId}/alternar`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const error = await response.json();
        console.warn('[F12] Toggle not allowed:', error.error);
        return { 
          success: false, 
          error: error.error || 'Alteração não permitida'
        };
      }

      const data = await response.json();
      this.cache.estadosCaixa[caixaId] = data.novoEstado;
      this.cache.ultimaAtualizacao = 0; // Invalidate cache

      return { 
        success: true, 
        novoEstado: data.novoEstado 
      };
    } catch (error) {
      console.error('[F12] Error toggling F12:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  },

  /**
   * Set F12 state for a cash register (admin only)
   * @param {number} caixaId
   * @param {boolean} ativo
   * @returns {Promise<{success: boolean}>}
   */
  async definirEstadoCaixa(caixaId, ativo) {
    if (!caixaId) {
      console.error('[F12] caixaId required');
      return { success: false, error: 'caixaId required' };
    }

    try {
      const response = await fetch(`${API_URL}/f12/caixas/${caixaId}/estado`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ ativo })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[F12] Failed to set estado:', error.error);
        return { 
          success: false, 
          error: error.error || 'Operação não permitida'
        };
      }

      const data = await response.json();
      this.cache.estadosCaixa[caixaId] = data.ativo;
      this.cache.ultimaAtualizacao = 0; // Invalidate cache

      return { success: true };
    } catch (error) {
      console.error('[F12] Error setting estado:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  },

  /**
   * Set global F12 state (admin only, when policy = GLOBAL)
   * @param {boolean} ativo
   * @returns {Promise<{success: boolean}>}
   */
  async definirEstadoGlobal(ativo) {
    try {
      const response = await fetch(`${API_URL}/f12/estado-global`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ ativo })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[F12] Failed to set estado global:', error.error);
        return { 
          success: false, 
          error: error.error || 'Operação não permitida'
        };
      }

      const data = await response.json();
      this.cache.estadoGlobal = data.ativo;
      this.cache.ultimaAtualizacao = 0; // Invalidate cache

      return { success: true };
    } catch (error) {
      console.error('[F12] Error setting estado global:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  },

  /**
   * List all cash registers with F12 states
   * @returns {Promise<Array>}
   */
  async listarCaixas() {
    try {
      const response = await fetch(`${API_URL}/f12/caixas`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });

      if (!response.ok) {
        console.error('[F12] Failed to list caixas:', response.status);
        return [];
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      console.error('[F12] Error listing caixas:', error);
      return [];
    }
  },

  /**
   * Info administrativa (controle + escopo). Não interpreta regras no frontend.
   */
  async obterInfo() {
    try {
      const response = await fetch(`${API_URL}/f12/info`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        }
      });

      if (!response.ok) {
        console.error('[F12] Failed to get info:', response.status);
        return {
          controle: 'OPERADOR',
          escopo: null,
          podeAlterar: false,
          podeOperadorAlterar: false,
          isAdmin: false,
          estadoGlobal: true
        };
      }

      const data = await response.json();
      this.cache.contexto = data;
      this.cache.ultimaAtualizacao = Date.now();
      return data;
    } catch (error) {
      console.error('[F12] Error getting info:', error);
      return {
        controle: 'OPERADOR',
        escopo: null,
        podeAlterar: false,
        podeOperadorAlterar: false,
        isAdmin: false,
        estadoGlobal: true
      };
    }
  },

  async definirModelo(controle, escopo) {
    try {
      const response = await fetch(`${API_URL}/f12/controle`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ controle, escopo })
      });

      if (!response.ok) {
        const error = await response.json();
        return { success: false, error: error.error || 'Operação não permitida' };
      }

      this.limparCache();
      const data = await response.json();
      return { success: true, ...data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Fallback: read from localStorage
   * Only used when backend is unreachable.
   * IMPORTANT: localStorage is NOT a source of truth. Return null so callers
   * can decide how to proceed when the server cannot be reached.
   * @private
   */
  _fallbackParaLocalStorage() {
    try {
      const stored = localStorage.getItem('pdv_modo_fiscal_ativo');
      if (stored === null) return null;
      // Return null (unable to validate) rather than a boolean that could silently
      // override server state. Caller must handle null explicitly.
      console.warn('[F12] Backend unreachable — localStorage available as UI cache only.');
      return null;
    } catch (err) {
      console.warn('[F12] localStorage not available for fallback:', err);
      return null;
    }
  },


  /**
   * Clear cache (used when policy changes)
   */
  limparCache() {
    this.cache.contexto = null;
    this.cache.estadoGlobal = null;
    this.cache.estadosCaixa = {};
    this.cache.ultimaAtualizacao = 0;
  }
};

// Make globally available
if (typeof window !== 'undefined') {
  window.F12PolicyResolver = window.F12PolicyResolver;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.F12PolicyResolver;
}
