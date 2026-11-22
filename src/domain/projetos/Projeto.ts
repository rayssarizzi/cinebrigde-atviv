import { PacoteServico, ServicoAtomico, type ServicoProjeto } from '../servicos/ServicoProjeto';
import { randomUUID } from "node:crypto";
import type {
  DadosProjeto,
  EventoRecomendacao,
  Observador,
  Papel,
  Profissional,
  Restricoes,
  TipoEvento,
  VisitanteProjeto,
} from "../contratos";

export abstract class Projeto {
  private id: string;
  private readonly genero: string;
  private duracao: number;
  private orcamento: number;
  private prazo: Date;
  servicoPrincipal: ServicoProjeto = new PacoteServico("Serviços do projeto");
  private restricoes: Restricoes;
  private equipe = new Map<Papel, Profissional>();
  private observadores: Observador[] = [];

  protected constructor(genero: string, dados: DadosProjeto = {}) {
    this.genero = genero;
    this.id = randomUUID();
    this.duracao = 0;
    this.orcamento = 0;
    this.prazo = new Date();

    this.restricoes = {};
    this.aplicarDadosBase(dados as Record<string, unknown>);
  }

  abstract clonar(): Projeto;

  protected copiarEstadoPara(destino: Projeto): void {
    destino.id = this.id;
    destino.duracao = this.duracao;
    destino.orcamento = this.orcamento;
    destino.prazo = new Date(this.prazo.getTime());
    destino.servicoPrincipal = this.clonarServico(this.servicoPrincipal);
    destino.restricoes = structuredClone(this.restricoes);
    destino.equipe = new Map(
      [...this.equipe].map(([papel, p]) => [papel, structuredClone(p)] as [Papel, Profissional]),
    );
    destino.observadores = [];
  }

  ajustar(dados: Record<string, unknown>): this {
    this.aplicarDadosBase(dados);
    return this;
  }

  private aplicarDadosBase(dados: Record<string, unknown>): void {
    if (typeof dados.id === "string") this.id = dados.id;
    if (typeof dados.duracao === "number") this.duracao = dados.duracao;
    if (typeof dados.orcamento === "number") this.orcamento = dados.orcamento;
    if (dados.prazo instanceof Date) this.prazo = new Date(dados.prazo.getTime());
    if (Array.isArray(dados.papeisNecessarios)) {
      const pacote = new PacoteServico('Serviços do projeto');
      for (const papel of dados.papeisNecessarios as Papel[]) pacote.adicionar(new ServicoAtomico(papel, 0, 1, papel));
      this.servicoPrincipal = pacote;
    }
    if (dados.servicoPrincipal) this.servicoPrincipal = dados.servicoPrincipal as ServicoProjeto;
    if (dados.restricoes && typeof dados.restricoes === "object") {
      this.restricoes = structuredClone(dados.restricoes as Restricoes);
    }
  }

  calcularCustoTotal(): number { return this.servicoPrincipal.calcularCusto(); }
  validarServicos(): boolean { return this.servicoPrincipal.validar(); }
  private clonarServico(s: ServicoProjeto): ServicoProjeto {
    if (s instanceof ServicoAtomico) return new ServicoAtomico(s.nome, s.custo, s.prazoDias, s.papel, s.disponivel);
    const p = new PacoteServico((s as PacoteServico).nome, (s as PacoteServico).prazoLimiteDias);
    s.listarSubservicos().forEach(f => p.adicionar(this.clonarServico(f))); return p;
  }
  getId(): string { return this.id; }
  getGenero(): string { return this.genero; }
  getDuracao(): number { return this.duracao; }
  getOrcamento(): number { return this.orcamento; }
  getPrazo(): Date { return new Date(this.prazo.getTime()); }
  getPapeisNecessarios(): Papel[] { return this.servicoPrincipal.obterPapeis(); }
  getRestricoes(): Restricoes { return structuredClone(this.restricoes); }
  getEquipe(): Map<Papel, Profissional> { return new Map(this.equipe); }
  getObservadores(): readonly Observador[] { return [...this.observadores]; }

  aceitarVisitante(visitante: VisitanteProjeto): boolean {
    return visitante.visitarProjeto(this);
  }

  adicionarObservador(observador: Observador): void {
    if (!this.observadores.includes(observador)) this.observadores.push(observador);
  }

  removerObservador(observador: Observador): void {
    this.observadores = this.observadores.filter((o) => o !== observador);
  }

  notificar(tipo: TipoEvento, papel?: Papel, profissional?: Profissional): void {
    const evento: EventoRecomendacao = {
      tipo,
      projetoId: this.id,
      genero: this.getGenero(),
      papel,
      profissional,
      quando: new Date(),
    };
    for (const o of [...this.observadores]) o.atualizar(evento);
  }

  aceitarRecomendacao(papel: Papel, profissional: Profissional): void {
    this.exigirPapel(papel);
    this.equipe.set(papel, profissional);
    this.notificar("RECOMENDACAO_ACEITA", papel, profissional);
  }

  substituirMembro(papel: Papel, profissional: Profissional): void {
    this.exigirPapel(papel);
    this.equipe.set(papel, profissional);
    this.notificar("MEMBRO_SUBSTITUIDO", papel, profissional);
  }

  solicitarReavaliacao(): void {
    this.notificar("REAVALIACAO_SOLICITADA");
  }

  private exigirPapel(papel: Papel): void {
    if (!this.getPapeisNecessarios().includes(papel)) {
      throw new Error(`O papel ${papel} não faz parte do projeto ${this.id} (${this.getGenero()})`);
    }
  }
}
