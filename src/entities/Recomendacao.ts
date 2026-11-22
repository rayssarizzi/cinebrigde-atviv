import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Projeto } from './Projeto';
import { Profissional } from './Profissional';
import type { NomeEstrategia, Papel, StatusRecomendacao } from '../domain/tipos';

@Entity('recomendacoes')
export class Recomendacao {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Projeto, (projeto) => projeto.recomendacoes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projeto_id' })
  projeto!: Projeto;

  @Column('varchar')
  papel!: Papel;

  @ManyToOne(() => Profissional, { eager: true })
  @JoinColumn({ name: 'profissional_id' })
  profissional!: Profissional;

  @Column('decimal', { precision: 6, scale: 5 })
  pontuacao!: number;

  @Column('varchar')
  estrategiaUsada!: NomeEstrategia;

  @Column({ type: 'varchar', default: 'sugerida' })
  status!: StatusRecomendacao;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm!: Date;
}
