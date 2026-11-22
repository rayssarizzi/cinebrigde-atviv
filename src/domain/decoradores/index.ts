import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import type { Profissional, RecomendacaoStrategy, Recomendacoes } from '../contratos';
import type { Projeto } from '../projetos/Projeto';
abstract class Decorador implements RecomendacaoStrategy {
 constructor(protected interno: RecomendacaoStrategy) {}
 abstract recomendar(projeto: Projeto, profissionais: Profissional[]): Recomendacoes;
}
export class CacheDecorator extends Decorador {
 private cache = new Map<string, { ate: number; valor: Recomendacoes }>();
 constructor(interno: RecomendacaoStrategy, private ttlMs = 60000, private limite = 100) { super(interno); if (ttlMs <= 0 || limite < 1) throw new Error('Política de cache inválida'); }
 recomendar(projeto: Projeto, profissionais: Profissional[]) {
   const estado = Object.fromEntries(Object.entries(projeto).filter(([k]) => !['id', 'observadores', 'equipe'].includes(k)));
   const chave = JSON.stringify([estado, projeto.getGenero(), projeto.getDuracao(), projeto.getOrcamento(), projeto.getPrazo(), projeto.getRestricoes(), projeto.servicoPrincipal, profissionais]);
   const hit = this.cache.get(chave);
   if (hit && hit.ate > Date.now()) return structuredClone(hit.valor);
   const valor = this.interno.recomendar(projeto, profissionais);
   if (this.cache.size >= this.limite) this.cache.delete(this.cache.keys().next().value!);
   this.cache.set(chave, { ate: Date.now() + this.ttlMs, valor: structuredClone(valor) });
   return valor;
 }
}
export interface RegistroAuditoria { projetoId: string; duracaoMs: number; sucesso: boolean; }
export class AuditoriaDecorator extends Decorador {
 constructor(interno: RecomendacaoStrategy, private registrar: (registro: RegistroAuditoria) => void) { super(interno); }
 recomendar(projeto: Projeto, profissionais: Profissional[]) {
   const inicio = performance.now(); let sucesso = false;
   try { const r = this.interno.recomendar(projeto, profissionais); sucesso = true; return r; }
   finally { this.registrar({ projetoId: projeto.getId(), duracaoMs: performance.now() - inicio, sucesso }); }
 }
}
export class CompressaoDecorator extends Decorador {
 constructor(interno: RecomendacaoStrategy, private transmitir: (dados: Buffer) => void) { super(interno); }
 recomendar(projeto: Projeto, profissionais: Profissional[]) {
   const r = this.interno.recomendar(projeto, profissionais);
   this.transmitir(gzipSync(Buffer.from(JSON.stringify([...r]))));
   return r; // Preserva o contrato Map; o transporte recebe os bytes gzip.
 }
}
export type PoliticaDecorador = 'cache' | 'auditoria' | 'compressao';
export function decorar(base: RecomendacaoStrategy, politicas: PoliticaDecorador[], registrar: (r: RegistroAuditoria) => void = () => {}, transmitir: (b: Buffer) => void = () => {}): RecomendacaoStrategy {
 return politicas.reduce((interno, p) => {
   switch (p) {
     case 'cache': return new CacheDecorator(interno);
     case 'auditoria': return new AuditoriaDecorator(interno, registrar);
     case 'compressao': return new CompressaoDecorator(interno, transmitir);
     default: throw new Error('Decorador desconhecido');
   }
 }, base);
}
