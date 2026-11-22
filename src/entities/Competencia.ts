import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PerfilCompetencia } from './PerfilCompetencia';

@Entity('competencias')
export class Competencia {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  nome!: string;

  @Column({ type: 'varchar', nullable: true })
  categoria?: string;

  @OneToMany(() => PerfilCompetencia, (perfil) => perfil.competencia)
  perfis!: PerfilCompetencia[];
}
