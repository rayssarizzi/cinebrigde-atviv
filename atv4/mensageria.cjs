const { randomUUID } = require('node:crypto');

const filas = {
  profissionais: 'consulta-profissionais',
  projetos: 'comandos-projetos',
  eventosProjetos: 'eventos-projetos',
  eventosRecomendacao: 'eventos-recomendacao',
};

async function abrirMensageria(amqp, url) {
  const conexao = await amqp.connect(url, { timeout: 5000 });
  const canal = await conexao.createConfirmChannel();
  const pendentes = new Map();
  let ativa = true;
  for (const recurso of [conexao, canal]) {
    recurso.on('error', console.error);
    recurso.on('close', () => {
      ativa = false;
      for (const { rejeitar } of pendentes.values()) rejeitar(new Error('Conexão AMQP encerrada'));
    });
  }

  for (const fila of Object.values(filas)) await canal.assertQueue(fila, { durable: true });
  await canal.prefetch(8);

  const { queue: filaRetorno } = await canal.assertQueue('', { exclusive: true, autoDelete: true });
  await canal.consume(filaRetorno, (mensagem) => {
    if (!mensagem) return;
    const pedido = pendentes.get(mensagem.properties.correlationId);
    if (!pedido) return;
    try {
      pedido.resolver(JSON.parse(mensagem.content));
    } catch (erro) {
      pedido.rejeitar(erro);
    }
  }, { noAck: true });

  function publicar(fila, dados, propriedades = {}) {
    return new Promise((resolve, reject) => {
      canal.sendToQueue(fila, Buffer.from(JSON.stringify(dados)), {
        persistent: true, contentType: 'application/json', ...propriedades,
      }, (erro) => erro ? reject(erro) : resolve());
    });
  }

  async function solicitar(fila, dados) {
    const correlationId = randomUUID();
    let temporizador;
    const retorno = new Promise((resolver, rejeitar) => {
      pendentes.set(correlationId, { resolver, rejeitar });
      temporizador = setTimeout(() => rejeitar(new Error(`Tempo limite na fila ${fila}`)), 5000);
    });
    try {
      const [, resposta] = await Promise.all([
        publicar(fila, dados, { replyTo: filaRetorno, correlationId, expiration: '5000' }),
        retorno,
      ]);
      if (resposta.erro) throw new Error(resposta.erro);
      return resposta.valor;
    } finally {
      clearTimeout(temporizador);
      pendentes.delete(correlationId);
    }
  }

  async function consumir(fila, tratar) {
    await canal.consume(fila, async (mensagem) => {
      if (!mensagem) return;
      let dados;
      try {
        dados = JSON.parse(mensagem.content);
      } catch (erro) {
        console.error(erro);
        if (ativa) canal.nack(mensagem, false, false);
        return;
      }
      const { replyTo, correlationId } = mensagem.properties;
      try {
        const valor = await tratar(dados);
        if (replyTo) await publicar(replyTo, { valor }, { correlationId, persistent: false });
        if (ativa) canal.ack(mensagem);
      } catch (erro) {
        console.error(erro);
        if (replyTo) {
          try {
            await publicar(replyTo, { erro: 'Falha ao processar a solicitação interna' }, { correlationId, persistent: false });
            if (ativa) canal.ack(mensagem);
          } catch {
            if (ativa) canal.nack(mensagem, false, true);
          }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (ativa) canal.nack(mensagem, false, true);
      }
    });
  }

  return { publicar, solicitar, consumir, ativa: () => ativa, fechar: () => conexao.close() };
}

module.exports = { abrirMensageria, filas };
