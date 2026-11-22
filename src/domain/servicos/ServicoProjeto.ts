import { Papel } from '../contratos';
export interface ServicoProjeto {
 calcularCusto(): number;
 listarSubservicos(): readonly ServicoProjeto[];
 obterPrazo(): number;
 validar(): boolean;
 obterPapeis(): Papel[];
}
export class ServicoAtomico implements ServicoProjeto {
 constructor(readonly nome: string, readonly custo: number, readonly prazoDias: number, readonly papel: Papel, readonly disponivel = true) {}
 calcularCusto() { return this.custo; }
 listarSubservicos(): readonly ServicoProjeto[] { return []; }
 obterPrazo() { return this.prazoDias; }
 obterPapeis() { return [this.papel]; }
 validar() { return !!this.nome.trim() && Number.isFinite(this.custo) && this.custo >= 0 && Number.isInteger(this.prazoDias) && this.prazoDias > 0 && Object.values(Papel).includes(this.papel) && this.disponivel; }
}
export class PacoteServico implements ServicoProjeto {
 private readonly filhos: ServicoProjeto[] = [];
 constructor(readonly nome: string, readonly prazoLimiteDias = Infinity) {}
 adicionar(servico: ServicoProjeto): this {
   const contem = (no: ServicoProjeto): boolean => no === this || no.listarSubservicos().some(contem);
   if (contem(servico)) throw new Error('Ciclo na hierarquia de serviços');
   this.filhos.push(servico); return this;
 }
 calcularCusto(): number { return Math.round(this.filhos.reduce((s, f) => s + f.calcularCusto(), 0) * 100) / 100; }
 listarSubservicos(): readonly ServicoProjeto[] { return [...this.filhos]; }
 // Componentes executados em paralelo: o maior prazo determina a entrega.
 obterPrazo(): number { return Math.max(0, ...this.filhos.map(f => f.obterPrazo())); }
 obterPapeis(): Papel[] { return [...new Set(this.filhos.flatMap(f => f.obterPapeis()))]; }
 validar(): boolean { return !!this.nome.trim() && this.filhos.length > 0 && this.prazoLimiteDias > 0 && this.obterPrazo() <= this.prazoLimiteDias && this.filhos.every(f => f.validar()); }
}
