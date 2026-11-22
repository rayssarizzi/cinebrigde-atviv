import { Papel, type Profissional } from './domain/contratos';
import { ServicoAtomico, PacoteServico } from './domain/servicos/ServicoProjeto';
import { FabricaDocumentario } from './domain/fabricas/FabricaDocumentario';
import { RecomendadorDocumentario } from './domain/estrategias/RecomendadorDocumentario';
import { decorar } from './domain/decoradores';
import { SistemaRecomendacao } from './servicos/SistemaRecomendacao';
import { AdaptadorS3, AdaptadorStripe, AdaptadorInterno, CadastroInternoSimulado } from './infra/adaptadores';
async function main() {
 const profissionais: Profissional[] = [{ id: '1', nome: 'Ana', habilidades: ['documentario', 'edicao'], papeis: [Papel.EDITOR], custo: 800, nota: 9, disponivel: true }];
 const pacote = new PacoteServico('Pós-produção').adicionar(new PacoteServico('Imagem').adicionar(new ServicoAtomico('Edição', 800, 5, Papel.EDITOR)));
 const sistema = new SistemaRecomendacao([new FabricaDocumentario()], undefined, { armazenamento: new AdaptadorS3(), pagamento: new AdaptadorStripe(), profissionais: new AdaptadorInterno(new CadastroInternoSimulado(profissionais)) });
 sistema.configurarEstrategia(decorar(new RecomendadorDocumentario(), ['cache', 'auditoria', 'compressao'], r => console.log('Auditoria:', r), b => console.log('Transporte gzip:', b.length, 'bytes')));
 const resultado = await sistema.recomendarExterno({ genero: 'documentario', dados: { tema: 'Cinema independente', entrevistados: ['Produtora'], orcamento: 10000, servicoPrincipal: pacote } });
 console.log('Custo dos serviços:', resultado.projeto.calcularCustoTotal());
 console.log('Prazo em dias (serviços paralelos):', pacote.obterPrazo());
 console.log('Equipe:', [...resultado.equipe.titulares()]);
 console.log('Mídia:', await sistema.salvarMidia('roteiro.txt', Buffer.from('Roteiro de demonstração')));
 console.log('Pagamento simulado:', await sistema.pagar(800, 'ana'));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
