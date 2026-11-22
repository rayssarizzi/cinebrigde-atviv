import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PapelRequisito } from './PapelRequisito';
import { Recomendacao } from './Recomendacao';
import type { NomeEstrategia, TipoCaptacao } from '../domain/tipos';

@Entity('projetos')
export class Projeto {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('varchar')
  genero!: string;

  @Column('int')
  duracaoEstimadaMinutos!: number;

  @Column('decimal', { precision: 12, scale: 2 })
  orcamentoTotal!: number;

  @Column({ type: 'date' })
  dataEntrega!: string;

  @Column('varchar')
  tipoCaptacao!: TipoCaptacao;

  @Column('varchar')
  localizacao!: string;

  @Column({ type: 'varchar', default: 'auto' })
  estrategiaPreferida!: NomeEstrategia;

  @Column({ type: 'varchar', default: 'aberto' })
  status!: 'aberto' | 'em_composicao' | 'equipe_formada' | 'cancelado';

  @OneToMany(() => PapelRequisito, (papel) => papel.projeto, { cascade: true, eager: true })
  papeisRequisito!: PapelRequisito[];

  @OneToMany(() => Recomendacao, (recomendacao) => recomendacao.projeto)
  recomendacoes!: Recomendacao[];

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm!: Date;

  static LIMIAR_ORCAMENTO_REDUZIDO = 50_000;

  ehOrcamentoReduzido(): boolean {
    return Number(this.orcamentoTotal) < Projeto.LIMIAR_ORCAMENTO_REDUZIDO;
  }
}
