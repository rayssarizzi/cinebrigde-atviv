require('reflect-metadata');
const { randomUUID } = require('node:crypto');
const Fastify = require('fastify');
const { Pool } = require('pg');
const { abrirMensageria, filas } = require('./mensageria.cjs');
const { Profissional } = require('../dist/entities/Profissional');
const { ServicoRecomendacao } = require('../dist/servicos/ServicoRecomendacao');
const { BarramentoEventosRecomendacao } = require('../dist/domain/notificacoes/BarramentoEventosRecomendacao');
const { CircuitBreaker } = require('../dist/infra/resiliencia/CircuitBreaker');
const { registrarRotasRecomendacao } = require('../dist/http/rotas/recomendacao.routes');

globalThis.crypto ??= require('node:crypto').webcrypto;

const uuid = { type: 'string', format: 'uuid' };
const objeto = { type: 'object', additionalProperties: true };
const ids = { type: 'object', required: ['id'], properties: { id: uuid } };
const esquemaProfissional = {
  type: 'object',
  required: ['nome', 'especialidades', 'precoMinimo', 'precoMaximo', 'localizacao'],
  additionalProperties: false,
  properties: {
    nome: { type: 'string', minLength: 1 },
    especialidades: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    precoMinimo: { type: 'number', minimum: 0 },
    precoMaximo: { type: 'number', minimum: 0 },
    localizacao: { type: 'string', minLength: 1 },
    ativo: { type: 'boolean' },
    projetosConcluidos: { type: 'integer', minimum: 0 },
    vetorCompetencias: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } },
    avaliacoes: { type: 'array', items: {
      type: 'object', required: ['nota'], properties: { nota: { type: 'number', minimum: 0, maximum: 5 } },
    } },
    bloqueiosAgenda: { type: 'array', items: {
      type: 'object', required: ['inicio', 'fim'],
      properties: { inicio: { type: 'string', format: 'date' }, fim: { type: 'string', format: 'date' } },
    } },
  },
};

const esquemaProjeto = {
  type: 'object',
  required: ['genero', 'duracaoEstimadaMinutos', 'orcamentoTotal', 'dataEntrega', 'tipoCaptacao', 'localizacao', 'papeis'],
  properties: {
    genero: { type: 'string', minLength: 1 },
    duracaoEstimadaMinutos: { type: 'integer', minimum: 1 },
    orcamentoTotal: { type: 'number', minimum: 0 },
    dataEntrega: { type: 'string', format: 'date' },
    tipoCaptacao: { enum: ['documentario', 'ficcao', 'animacao'] },
    localizacao: { type: 'string', minLength: 1 },
    estrategiaPreferida: { enum: ['auto', 'similaridade_cosseno', 'filtragem_colaborativa', 'regras_orcamento'] },
    papeis: { type: 'array', minItems: 1, items: {
      type: 'object', required: ['papel', 'peso'],
      properties: {
        papel: { type: 'string', minLength: 1 },
        peso: { type: 'number', minimum: 0 },
        requisitosCompetencia: { type: 'object', additionalProperties: { type: 'number', minimum: 0 } },
      },
    } },
  },
};

async function registrarProfissionais(app, db, mq) {
  await db.query('CREATE TABLE IF NOT EXISTS profissionais (id uuid PRIMARY KEY, dados jsonb NOT NULL, ativo boolean NOT NULL)');

  async function consultar(id) {
    const { rows } = id
      ? await db.query('SELECT dados FROM profissionais WHERE id = $1', [id])
      : await db.query('SELECT dados FROM profissionais WHERE ativo ORDER BY id');
    return rows.map(({ dados }) => dados);
  }

  await mq.consumir(filas.profissionais, async ({ id }) => {
    const profissionais = await consultar(id);
    return id ? profissionais[0] ?? null : profissionais;
  });

  async function salvar(req, reply, criar) {
    const dados = {
      ativo: true, projetosConcluidos: 0, vetorCompetencias: {}, avaliacoes: [], bloqueiosAgenda: [],
      ...req.body, id: criar ? randomUUID() : req.params.id,
    };
    if (dados.precoMinimo > dados.precoMaximo || dados.bloqueiosAgenda.some(({ inicio, fim }) => inicio > fim)) {
      return reply.code(400).send({ erro: 'Faixa de preço ou disponibilidade inválida' });
    }
    const { rowCount } = criar
      ? await db.query('INSERT INTO profissionais (id, dados, ativo) VALUES ($1, $2, $3)', [dados.id, dados, dados.ativo])
      : await db.query('UPDATE profissionais SET dados = $2, ativo = $3 WHERE id = $1', [dados.id, dados, dados.ativo]);
    return rowCount ? reply.code(criar ? 201 : 200).send(dados) : reply.code(404).send();
  }

  app.get('/profissionais', () => consultar());
  app.get('/profissionais/:id', { schema: { params: ids } }, async (req, reply) => {
    const [profissional] = await consultar(req.params.id);
    return profissional ?? reply.code(404).send();
  });
  app.post('/profissionais', { schema: { body: esquemaProfissional } }, (req, reply) => salvar(req, reply, true));
  app.put('/profissionais/:id', { schema: { params: ids, body: esquemaProfissional } }, (req, reply) => salvar(req, reply, false));
}

async function prepararSaida(db, mq) {
  await db.query(`CREATE TABLE IF NOT EXISTS eventos_pendentes (
    id uuid PRIMARY KEY, fila text NOT NULL, evento jsonb NOT NULL, criado_em timestamptz NOT NULL DEFAULT now()
  )`);
  let ativo = true;
  let temporizador;
  let execucao;

  async function enviar() {
    const cliente = await db.connect();
    try {
      await cliente.query('BEGIN');
      const { rows } = await cliente.query('SELECT * FROM eventos_pendentes ORDER BY criado_em LIMIT 20 FOR UPDATE SKIP LOCKED');
      for (const { id, fila, evento } of rows) {
        await mq.publicar(fila, evento, { messageId: id });
        await cliente.query('DELETE FROM eventos_pendentes WHERE id = $1', [id]);
      }
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  }

  function agendar() {
    if (!ativo) return;
    temporizador = setTimeout(() => {
      execucao = enviar().catch(console.error).finally(agendar);
    }, 500);
  }

  agendar();
  return async () => {
    ativo = false;
    clearTimeout(temporizador);
    await execucao;
  };
}

async function gravarEvento(db, fila, tipo, dados) {
  const evento = { id: randomUUID(), tipo, dados };
  await db.query('INSERT INTO eventos_pendentes (id, fila, evento) VALUES ($1, $2, $3)', [evento.id, fila, evento]);
}

async function registrarProjetos(app, db, mq) {
  await db.query(`CREATE TABLE IF NOT EXISTS projetos (
    id uuid PRIMARY KEY, dados jsonb NOT NULL, status text NOT NULL DEFAULT 'em_andamento',
    resultado jsonb, atualizado_em timestamptz NOT NULL DEFAULT now()
  )`);
  const pararSaida = await prepararSaida(db, mq);
  app.addHook('onClose', pararSaida);

  async function persistir(tipo, id, dados, resultado = null) {
    const cliente = await db.connect();
    try {
      await cliente.query('BEGIN');
      let consulta;
      if (tipo === 'projeto_criado') {
        consulta = await cliente.query(
          'INSERT INTO projetos (id, dados, resultado) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING *',
          [id, dados, resultado],
        );
      } else if (tipo === 'projeto_atualizado') {
        consulta = await cliente.query(
          "UPDATE projetos SET dados = $2, atualizado_em = now() WHERE id = $1 AND status = 'em_andamento' RETURNING *",
          [id, dados],
        );
      } else {
        consulta = await cliente.query(
          "UPDATE projetos SET resultado = $2, status = 'finalizado', atualizado_em = now() WHERE id = $1 AND status = 'em_andamento' RETURNING *",
          [id, resultado],
        );
      }
      const [projeto] = consulta.rows;
      if (projeto) await gravarEvento(cliente, filas.eventosProjetos, tipo, projeto);
      await cliente.query('COMMIT');
      return projeto ?? null;
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  }

  await mq.consumir(filas.projetos, ({ id, dados, resultado }) => persistir('projeto_criado', id, dados, resultado));
  app.post('/projetos', { schema: { body: esquemaProjeto } }, async (req, reply) =>
    reply.code(201).send(await persistir('projeto_criado', randomUUID(), req.body)));
  app.get('/projetos/:id', { schema: { params: ids } }, async (req, reply) => {
    const { rows: [projeto] } = await db.query('SELECT * FROM projetos WHERE id = $1', [req.params.id]);
    return projeto ?? reply.code(404).send();
  });
  app.put('/projetos/:id', { schema: { params: ids, body: esquemaProjeto } }, async (req, reply) => {
    return await persistir('projeto_atualizado', req.params.id, req.body) ?? reply.code(404).send();
  });
  app.post('/projetos/:id/finalizar', { schema: { params: ids, body: objeto } }, async (req, reply) => {
    return await persistir('projeto_finalizado', req.params.id, null, req.body) ?? reply.code(404).send();
  });
}

async function registrarApi(app, db, mq) {
  await db.query('CREATE TABLE IF NOT EXISTS recomendacoes (projeto_id uuid PRIMARY KEY, resultado jsonb NOT NULL)');
  await db.query(`CREATE TABLE IF NOT EXISTS convites (
    id uuid PRIMARY KEY, projeto_id uuid NOT NULL REFERENCES recomendacoes (projeto_id),
    profissional_id uuid NOT NULL, papel text NOT NULL, aceito boolean
  )`);
  const pararSaida = await prepararSaida(db, mq);
  app.addHook('onClose', pararSaida);

  const hidratar = (dados) => dados && Object.assign(new Profissional(), dados);
  const repositorio = {
    buscarAtivos: async () => (await mq.solicitar(filas.profissionais, {})).map(hidratar),
    buscarPorId: async (id) => hidratar(await mq.solicitar(filas.profissionais, { id })),
  };
  const circuito = new CircuitBreaker({ nome: 'profissionais-amqp', maxFalhasConsecutivas: 3, tempoResetMs: 15000 });
  const barramento = new BarramentoEventosRecomendacao();
  const servico = new ServicoRecomendacao(repositorio, circuito, barramento);
  await app.register(async (rotas) => {
    rotas.addHook('onRoute', (rota) => {
      rota.schema = { ...rota.schema, body: esquemaProjeto };
    });
    rotas.addHook('preSerialization', async (req, reply, resultado) => {
      if (reply.statusCode >= 300) return resultado;
      const id = resultado.composicao.projetoId;
      resultado.convites = resultado.composicao.papeis.filter(({ titular }) => titular).map(({ papel, titular }) => ({
        id: randomUUID(), papel, profissionalId: titular.profissionalId,
      }));
      await mq.solicitar(filas.projetos, { id, dados: req.body, resultado });
      const cliente = await db.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query('INSERT INTO recomendacoes (projeto_id, resultado) VALUES ($1, $2)', [id, resultado]);
        for (const convite of resultado.convites) {
          await cliente.query('INSERT INTO convites (id, projeto_id, profissional_id, papel) VALUES ($1, $2, $3, $4)',
            [convite.id, id, convite.profissionalId, convite.papel]);
        }
        await gravarEvento(cliente, filas.eventosRecomendacao, 'equipe_recomendada',
          { projetoId: id, composicao: resultado.composicao, convites: resultado.convites });
        await cliente.query('COMMIT');
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw erro;
      } finally {
        cliente.release();
      }
      return resultado;
    });
    registrarRotasRecomendacao(rotas, servico);
  });

  app.get('/recomendacoes/:id', { schema: { params: ids } }, async (req, reply) => {
    const { rows: [registro] } = await db.query('SELECT resultado FROM recomendacoes WHERE projeto_id = $1', [req.params.id]);
    return registro?.resultado ?? reply.code(404).send();
  });
  app.post('/convites/:id/resposta', {
    schema: { params: ids, body: { type: 'object', required: ['aceito'], properties: { aceito: { type: 'boolean' } } } },
  }, async (req, reply) => {
    const { id } = req.params;
    const { aceito } = req.body;
    const cliente = await db.connect();
    try {
      await cliente.query('BEGIN');
      const { rows: [convite] } = await cliente.query(
        'UPDATE convites SET aceito = $2 WHERE id = $1 AND aceito IS NULL RETURNING projeto_id, profissional_id', [id, aceito]);
      if (convite) await gravarEvento(cliente, filas.eventosRecomendacao, 'convite_respondido',
        { conviteId: id, projetoId: convite.projeto_id, profissionalId: convite.profissional_id, aceito });
      const existente = convite || (await cliente.query('SELECT id FROM convites WHERE id = $1', [id])).rowCount > 0;
      await cliente.query('COMMIT');
      return reply.code(convite ? 202 : existente ? 409 : 404).send({ conviteId: id });
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  });
}

async function registrarNotificacoes(app, db, mq) {
  await db.query(`CREATE TABLE IF NOT EXISTS notificacoes (
    id uuid PRIMARY KEY, tipo text NOT NULL, dados jsonb NOT NULL, criado_em timestamptz NOT NULL DEFAULT now()
  )`);
  const { SMTP_URL, EMAIL_REMETENTE, EMAIL_DESTINO } = process.env;
  if (SMTP_URL && (!EMAIL_REMETENTE || !EMAIL_DESTINO)) {
    throw new Error('SMTP exige EMAIL_REMETENTE e EMAIL_DESTINO');
  }
  const email = SMTP_URL ? require('nodemailer').createTransport(SMTP_URL) : null;
  const observadores = new Map([
    ['equipe_recomendada', (dados) => ({ mensagem: 'Equipe recomendada', ...dados })],
    ['convite_respondido', (dados) => ({ mensagem: dados.aceito ? 'Convite aceito' : 'Convite recusado', ...dados })],
    ['projeto_criado', (dados) => ({ mensagem: 'Projeto criado', projetoId: dados.id })],
    ['projeto_atualizado', (dados) => ({ mensagem: 'Projeto atualizado', projetoId: dados.id })],
    ['projeto_finalizado', (dados) => ({ mensagem: 'Projeto finalizado', projetoId: dados.id })],
  ]);
  async function notificar({ id, tipo, dados }) {
    const observar = observadores.get(tipo);
    if (!observar) return;
    const alerta = observar(dados);
    const cliente = await db.connect();
    try {
      await cliente.query('BEGIN');
      const { rowCount } = await cliente.query('INSERT INTO notificacoes (id, tipo, dados) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, tipo, alerta]);
      if (rowCount && email) {
        await email.sendMail({ from: EMAIL_REMETENTE, to: EMAIL_DESTINO, subject: alerta.mensagem, text: JSON.stringify(alerta, null, 2) });
      }
      await cliente.query('COMMIT');
      if (rowCount) app.log.info({ evento: tipo, id }, 'Notificação publicada no feed interno');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  }
  await mq.consumir(filas.eventosProjetos, notificar);
  await mq.consumir(filas.eventosRecomendacao, notificar);
  app.get('/notificacoes', async () =>
    (await db.query('SELECT * FROM notificacoes ORDER BY criado_em DESC LIMIT 100')).rows);
}

const servicos = {
  api: registrarApi,
  profissionais: registrarProfissionais,
  projetos: registrarProjetos,
  notificacoes: registrarNotificacoes,
};

async function construirAplicacao(servico, db, mq) {
  const app = Fastify({ logger: true });
  await servicos[servico](app, db, mq);
  app.get('/health', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      if (mq.ativa()) return { status: 'ok' };
    } catch (erro) {
      app.log.warn(erro);
    }
    return reply.code(503).send({ status: 'indisponivel' });
  });
  return app;
}

async function principal() {
  const [servico] = process.argv.slice(2);
  if (!Object.hasOwn(servicos, servico)) throw new Error('Informe um serviço da ATV IV');
  const db = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000, query_timeout: 5000 });
  db.on('error', console.error);
  const mq = await abrirMensageria(require('amqplib'), process.env.AMQP_URL);
  const app = await construirAplicacao(servico, db, mq);
  for (const sinal of ['SIGINT', 'SIGTERM']) {
    process.once(sinal, async () => {
      await app.close();
      await mq.fechar().catch(console.error);
      await db.end();
    });
  }
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
  setInterval(() => {
    if (!mq.ativa()) process.exit(1);
  }, 2000).unref();
}

if (require.main === module) principal().catch((erro) => {
  console.error(erro);
  process.exit(1);
});

module.exports = { construirAplicacao };
