import type { AdaptadorArmazenamento, AdaptadorPagamento, AdaptadorProfissional } from '../infra/adaptadores';
import type { RecomendacaoStrategy } from '../domain/contratos';
import type { Profissional } from "../domain/contratos";
import type { Projeto } from "../domain/projetos/Projeto";
import type { FabricaProjeto } from "../domain/fabricas/FabricaProjeto";
import { NotificadorBase } from "../domain/notificacoes/NotificadorBase";
import type { Equipe } from "../domain/orquestracao/Equipe";
import type { OrquestradorEquipe } from "../domain/orquestracao/OrquestradorEquipe";
import { OrquestradorPadrao } from "../domain/orquestracao/OrquestradorPadrao";

export interface SolicitacaoRecomendacao {
  genero: string;
  dados: Record<string, unknown>;

  profissionais?: Profissional[];
}

export interface ResultadoRecomendacao {
  projeto: Projeto;
  equipe: Equipe;
  notificacoes: string[];
}

export class SistemaRecomendacao {
  private readonly fabricas = new Map<string, FabricaProjeto>();

  constructor(
    fabricas: FabricaProjeto[],
    private readonly criarOrquestrador: (f: FabricaProjeto, c: Profissional[]) => OrquestradorEquipe =
      (f, c) => new OrquestradorPadrao(f, c),
    private readonly integracoes?: { armazenamento: AdaptadorArmazenamento; pagamento: AdaptadorPagamento; profissionais: AdaptadorProfissional },
    private estrategia?: RecomendacaoStrategy,
  ) {
    fabricas.forEach((f) => this.registrarFabrica(f));
  }

  configurarEstrategia(estrategia: RecomendacaoStrategy): void { this.estrategia = estrategia; }
  async recomendarExterno(s: SolicitacaoRecomendacao): Promise<ResultadoRecomendacao> {
    if (!this.integracoes) throw new Error('Adaptadores não configurados');
    return this.recomendar({ ...s, profissionais: await this.integracoes.profissionais.listar() });
  }
  async salvarMidia(chave: string, dados: Buffer): Promise<string> {
    if (!this.integracoes) throw new Error('Adaptadores não configurados');
    return this.integracoes.armazenamento.salvar(chave, dados);
  }
  async pagar(valor: number, destinatario: string): Promise<string> {
    if (!this.integracoes) throw new Error('Adaptadores não configurados');
    return this.integracoes.pagamento.pagar(valor, destinatario);
  }
  registrarFabrica(fabrica: FabricaProjeto): void {
    this.fabricas.set(fabrica.genero, fabrica);
  }

  generosSuportados(): string[] {
    return [...this.fabricas.keys()];
  }

  recomendar(s: SolicitacaoRecomendacao): ResultadoRecomendacao {
    const fabrica = this.fabricas.get(s.genero);
    if (!fabrica) {
      throw new GeneroNaoSuportadoError(s.genero, this.generosSuportados());
    }
    const projeto = fabrica.criarProjeto(s.dados);
    if (!projeto.validarServicos()) throw new Error('Estrutura de serviços inválida');
    const equipe = this.criarOrquestrador(fabrica, s.profissionais ?? []).orquestrar(projeto, this.estrategia);
    const notificacoes = projeto
      .getObservadores()
      .flatMap((o) => (o instanceof NotificadorBase ? o.mensagens : []));
    return { projeto, equipe, notificacoes };
  }
}

export class GeneroNaoSuportadoError extends Error {
  constructor(readonly genero: string, readonly suportados: string[]) {
    super(`Gênero não suportado: "${genero}". Suportados: ${suportados.join(", ")}`);
    this.name = "GeneroNaoSuportadoError";
  }
}
