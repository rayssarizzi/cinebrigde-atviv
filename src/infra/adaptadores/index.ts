import { randomUUID } from 'node:crypto';
import type { Profissional } from '../../domain/contratos';
export interface AdaptadorArmazenamento { salvar(chave: string, dados: Buffer): Promise<string>; ler(chave: string): Promise<Buffer>; }
export interface AdaptadorPagamento { pagar(valor: number, destinatario: string): Promise<string>; }
export interface AdaptadorProfissional { listar(): Promise<Profissional[]>; }
export class S3Simulado {
 private objetos = new Map<string, Buffer>();
 async putObject(req: { Key: string; Body: Buffer }) { this.objetos.set(req.Key, Buffer.from(req.Body)); return { Location: `s3://midias/${req.Key}` }; }
 async getObject(req: { Key: string }) { const b = this.objetos.get(req.Key); if (!b) throw new Error('Arquivo inexistente'); return { Body: Buffer.from(b) }; }
}
export class GoogleCloudSimulado {
 private arquivos = new Map<string, Buffer>();
 async upload(nome: string, conteudo: Buffer) { this.arquivos.set(nome, Buffer.from(conteudo)); return `gs://midias/${nome}`; }
 async download(nome: string) { const b = this.arquivos.get(nome); if (!b) throw new Error('Arquivo inexistente'); return Buffer.from(b); }
}
export class AdaptadorS3 implements AdaptadorArmazenamento {
 constructor(private api = new S3Simulado()) {}
 async salvar(chave: string, dados: Buffer) { return (await this.api.putObject({ Key: chave, Body: dados })).Location; }
 async ler(chave: string) { return (await this.api.getObject({ Key: chave })).Body; }
}
export class AdaptadorGoogleCloud implements AdaptadorArmazenamento {
 constructor(private api = new GoogleCloudSimulado()) {}
 salvar(chave: string, dados: Buffer) { return this.api.upload(chave, dados); }
 ler(chave: string) { return this.api.download(chave); }
}
export class StripeSimulado { async charge(req: { amount: number; currency: string; account: string }) { return { id: 'stripe-' + randomUUID(), ...req }; } }
export class PagSeguroSimulado { async transacionar(destino: string, total: string) { return { codigo: 'pagseguro-' + randomUUID(), destino, total }; } }
function validarPagamento(valor: number, destino: string) { if (!Number.isFinite(valor) || valor <= 0 || !destino.trim()) throw new Error('Pagamento inválido'); }
export class AdaptadorStripe implements AdaptadorPagamento {
 constructor(private api = new StripeSimulado()) {}
 async pagar(valor: number, destinatario: string) { validarPagamento(valor, destinatario); return (await this.api.charge({ amount: Math.round(valor * 100), currency: 'brl', account: destinatario })).id; }
}
export class AdaptadorPagSeguro implements AdaptadorPagamento {
 constructor(private api = new PagSeguroSimulado()) {}
 async pagar(valor: number, destinatario: string) { validarPagamento(valor, destinatario); return (await this.api.transacionar(destinatario, valor.toFixed(2))).codigo; }
}
export class LinkedInSimulado {
 constructor(private perfis: { memberId: string; displayName: string; profile: Omit<Profissional, 'id' | 'nome'> }[]) {}
 async searchPeople() { return structuredClone(this.perfis); }
}
export class CadastroInternoSimulado {
 constructor(private registros: Profissional[]) {}
 async consultarAtivos() { return structuredClone(this.registros.filter(p => p.disponivel)); }
}
export class AdaptadorLinkedIn implements AdaptadorProfissional {
 constructor(private api: LinkedInSimulado) {}
 async listar() { return (await this.api.searchPeople()).map(p => ({ ...p.profile, id: p.memberId, nome: p.displayName })).filter(p => p.disponivel); }
}
export class AdaptadorInterno implements AdaptadorProfissional {
 constructor(private api: CadastroInternoSimulado) {}
 listar() { return this.api.consultarAtivos(); }
}
