/**
 * IMotorIdentificacao — Contrato abstrato para engines de identificação.
 *
 * Todo engine em `engines/` DEVE estender esta classe e implementar todos os
 * métodos obrigatórios. Instanciar IMotorIdentificacao diretamente é proibido.
 *
 * Sprint 3.1 — REGRAS OFICIAIS DOS ENGINES:
 *
 * PROIBIDO para qualquer Engine:
 * - Executar SQL
 * - Acessar banco de dados diretamente
 * - Acessar outro Engine
 * - Acessar XML, Compras ou rotas do ERP
 * - Decidir ação final (associar, criar produto, solicitar confirmação)
 *
 * OBRIGATÓRIO:
 * - Receber `MiipContext` na execução
 * - Consultar produtos exclusivamente via `ProdutoRepository`
 * - Retornar `MiipCandidate[]` via `identificar()` — nunca `null`
 * - Produzir `MiipEvidence[]` em cada candidato
 * - Registrar métricas via `MiipMetricsCollector`
 *
 * Decisão final: exclusiva do `DecisionEngine` via `MiipDecisionBuilder` no Pipeline.
 *
 * @abstract
 * @class IMotorIdentificacao
 */

const METODOS_OBRIGATORIOS = Object.freeze([
  'getCodigo',
  'getDescricao',
  'getPeso',
  'identificar'
]);

class IMotorIdentificacao {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    if (new.target === IMotorIdentificacao) {
      throw new Error('IMotorIdentificacao é abstrata e não pode ser instanciada diretamente');
    }

    this.config = config || {};
  }

  /**
   * Código único do engine (ex: 'motor_gtin', 'motor_similaridade').
   *
   * @abstract
   * @returns {string}
   */
  getCodigo() {
    throw new Error(`${this.constructor.name} deve implementar getCodigo()`);
  }

  /**
   * Descrição legível da estratégia de identificação.
   *
   * @abstract
   * @returns {string}
   */
  getDescricao() {
    throw new Error(`${this.constructor.name} deve implementar getDescricao()`);
  }

  /**
   * Peso do engine na agregação de score (0.0 – 1.0).
   *
   * @abstract
   * @returns {number}
   */
  getPeso() {
    throw new Error(`${this.constructor.name} deve implementar getPeso()`);
  }

  /**
   * Executa a estratégia de identificação sobre o item.
   *
   * Retorna array vazio quando não há candidatos — nunca `null`.
   *
   * @abstract
   * @param {import('../contracts/ItemIdentificavelDTO')} _item
   * @param {import('./MiipContext')} [_contexto]
   * @returns {Promise<import('./MiipCandidate')[]>}
   */
  async identificar(_item, _contexto) {
    throw new Error(`${this.constructor.name} deve implementar identificar()`);
  }

  /**
   * Retorna metadados estruturais do engine.
   *
   * @returns {{ codigo: string, descricao: string, peso: number }}
   */
  getMetadados() {
    return {
      codigo: this.getCodigo(),
      descricao: this.getDescricao(),
      peso: this.getPeso()
    };
  }

  /**
   * Valida se uma classe estende IMotorIdentificacao corretamente.
   *
   * @param {Function} ClasseEngine
   * @returns {{ valido: boolean, erros: string[] }}
   */
  static validarHeranca(ClasseEngine) {
    const erros = [];

    if (!ClasseEngine || typeof ClasseEngine !== 'function') {
      return { valido: false, erros: ['Classe de engine inválida'] };
    }

    if (ClasseEngine === IMotorIdentificacao) {
      return { valido: false, erros: ['IMotorIdentificacao não pode ser registrada como engine'] };
    }

    let prototipo = ClasseEngine.prototype;
    let herdaBase = false;
    while (prototipo) {
      if (prototipo === IMotorIdentificacao.prototype) {
        herdaBase = true;
        break;
      }
      prototipo = Object.getPrototypeOf(prototipo);
    }

    if (!herdaBase) {
      erros.push('Engine deve estender IMotorIdentificacao');
    }

    let instancia;
    try {
      instancia = new ClasseEngine({});
    } catch (error) {
      erros.push(`Não foi possível instanciar engine: ${error.message}`);
      return { valido: false, erros };
    }

    METODOS_OBRIGATORIOS.forEach((metodo) => {
      if (typeof instancia[metodo] !== 'function') {
        erros.push(`Método obrigatório ausente: ${metodo}()`);
      }
    });

    return { valido: erros.length === 0, erros };
  }
}

IMotorIdentificacao.METODOS_OBRIGATORIOS = METODOS_OBRIGATORIOS;

module.exports = IMotorIdentificacao;
