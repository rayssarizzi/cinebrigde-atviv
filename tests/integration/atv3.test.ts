import { describe, it, expect, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { Papel, type Profissional } from '../../src/domain/contratos';
import { ProjetoDocumentario } from '../../src/domain/projetos/ProjetoDocumentario';
import { FabricaDocumentario } from '../../src/domain/fabricas/FabricaDocumentario';
import { RecomendadorDocumentario } from '../../src/domain/estrategias/RecomendadorDocumentario';
import { SistemaRecomendacao } from '../../src/servicos/SistemaRecomendacao';
import { ServicoAtomico, PacoteServico } from '../../src/domain/servicos/ServicoProjeto';
import { decorar, CacheDecorator, AuditoriaDecorator } from '../../src/domain/decoradores';
import * as A from '../../src/infra/adaptadores';
const profissional: Profissional = { id: '1', nome: 'Ana', habilidades: ['edicao'], papeis: [Papel.EDITOR], custo: 100, nota: 9, disponivel: true };
const projeto = () => new ProjetoDocumentario({ id: 'teste', orcamento: 1000, papeisNecessarios: [Papel.EDITOR] }, 'Cinema', ['Ana']);
describe('ATVIII - integração estrutural', () => {
 it.each([0, 1])('troca os três provedores pelo construtor (%i)', async indice => {
  const armazenamento = [new A.AdaptadorS3(), new A.AdaptadorGoogleCloud()][indice];
  const pagamento = [new A.AdaptadorStripe(), new A.AdaptadorPagSeguro()][indice];
  const profissionais = [new A.AdaptadorInterno(new A.CadastroInternoSimulado([profissional])), new A.AdaptadorLinkedIn(new A.LinkedInSimulado([{ memberId: '1', displayName: 'Ana', profile: profissional }]))][indice];
  const sistema = new SistemaRecomendacao([new FabricaDocumentario()], undefined, { armazenamento, pagamento, profissionais });
  const r = await sistema.recomendarExterno({ genero: 'documentario', dados: { tema: 'Cinema', entrevistados: ['Ana'], orcamento: 1000, papeisNecessarios: [Papel.EDITOR] } });
  expect(r.equipe.titulares().get(Papel.EDITOR)?.nome).toBe('Ana');
  await sistema.salvarMidia('roteiro', Buffer.from('teste'));
  expect((await armazenamento.ler('roteiro')).toString()).toBe('teste');
  expect(await sistema.pagar(100, 'Ana')).toMatch(/stripe|pagseguro/);
  await expect(sistema.pagar(-1, 'Ana')).rejects.toThrow();
  await expect(armazenamento.ler('inexistente')).rejects.toThrow();
 });
 it('calcula hierarquias, disponibilidade, prazo e rejeita ciclos', () => {
  const folha = new ServicoAtomico('Edição', 100, 5, Papel.EDITOR);
  const sub = new PacoteServico('Imagem').adicionar(folha);
  const raiz = new PacoteServico('Pós', 10).adicionar(sub).adicionar(new ServicoAtomico('Direção', 200, 8, Papel.DIRETOR));
  const p = projeto(); p.servicoPrincipal = raiz;
  expect(p.calcularCustoTotal()).toBe(300); expect(raiz.obterPrazo()).toBe(8); expect(raiz.validar()).toBe(true);
  expect(() => sub.adicionar(raiz)).toThrow('Ciclo');
  expect(new PacoteServico('Curto', 1).adicionar(folha).validar()).toBe(false);
  expect(new PacoteServico('Vazio').validar()).toBe(false);
  expect(new ServicoAtomico('Ocupado', 1, 1, Papel.EDITOR, false).validar()).toBe(false);
  const copia = p.clonar(); raiz.adicionar(folha); expect(copia.calcularCustoTotal()).toBe(300);
 });
 it.each([['cache', 'auditoria', 'compressao'], ['compressao', 'cache', 'auditoria']] as const)('combina decoradores: %s %s %s', (...ordem) => {
  const base = new RecomendadorDocumentario(); const executar = vi.spyOn(base, 'recomendar');
  const auditoria = vi.fn(); const transmitir = vi.fn();
  const pilha = decorar(base, [...ordem], auditoria, transmitir); const p = projeto();
  const pool = Array.from({ length: 10 }, (_, i) => ({ ...profissional, id: String(i), habilidades: ['edicao'.repeat(100)] }));
  const r = pilha.recomendar(p, pool); r.clear(); const repetida = pilha.recomendar(p, pool);
  expect(repetida.size).toBe(1); expect(executar).toHaveBeenCalledTimes(1); expect(auditoria).toHaveBeenCalledTimes(2);
  const bytes = transmitir.mock.calls[0][0] as Buffer; const bruto = gunzipSync(bytes);
  expect(bytes.length).toBeLessThan(bruto.length); expect(JSON.parse(bruto.toString())).toEqual([...repetida]);
 });
 it('cache expira, invalida alterações e evita repetir trabalho custoso', () => {
  const base = { recomendar: vi.fn((p: ProjetoDocumentario) => { for (let i = 0; i < 100000; i++) Math.sqrt(i); return new Map([[Papel.EDITOR, [profissional]]]); }) };
  const cache = new CacheDecorator(base, 10); const p = projeto();
  vi.spyOn(Date, 'now').mockReturnValue(100);
  cache.recomendar(p, []); cache.recomendar(p, []); expect(base.recomendar).toHaveBeenCalledTimes(1);
  vi.mocked(Date.now).mockReturnValue(111); cache.recomendar(p, []); expect(base.recomendar).toHaveBeenCalledTimes(2);
  p.ajustar({ orcamento: 2000 }); cache.recomendar(p, []); expect(base.recomendar).toHaveBeenCalledTimes(3); vi.restoreAllMocks();
 });
 it('cache reduz o tempo em requisições repetidas', () => {
  const base = { recomendar: vi.fn(() => {
   const ate = performance.now() + 25;
   while (performance.now() < ate) { /* simula cálculo custoso */ }
   return new Map([[Papel.EDITOR, [profissional]]]);
  }) };
  const cache = new CacheDecorator(base); const p = projeto();
  let inicio = performance.now(); cache.recomendar(p, []); const primeiro = performance.now() - inicio;
  inicio = performance.now(); cache.recomendar(p, []); const segundo = performance.now() - inicio;
  expect(segundo).toBeLessThan(primeiro); expect(base.recomendar).toHaveBeenCalledTimes(1);
 });
 it('audita falhas', () => {
  const registrar = vi.fn(); const d = new AuditoriaDecorator({ recomendar() { throw new Error('falha'); } }, registrar);
  expect(() => d.recomendar(projeto(), [])).toThrow('falha'); expect(registrar.mock.calls[0][0].sucesso).toBe(false);
 });
});
