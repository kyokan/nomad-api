import bodyParser from 'body-parser';
import Envelope, {ENVELOPE_VERSION} from 'ddrp-indexer/dist/social/Envelope';
import {WirePost} from 'ddrp-indexer/dist/social/WirePost';
import {WireReaction} from 'ddrp-indexer/dist/social/WireReaction';
import {WireFollow} from 'ddrp-indexer/dist/social/WireFollow';
import {WireBlock} from 'ddrp-indexer/dist/social/WireBlock';
import {RestServer} from "./services/rest-server";
import {DDRPManager} from "./services/ddrp";
import {IndexerManager} from "./services/indexer";
import {makeResponse} from "./util/rest";
import Timeout = NodeJS.Timeout;
import {dotName} from "./util/user";
const SERVICE_KEY = process.env.SERVICE_KEY;

const jsonParser = bodyParser.json();

let watchInterval: Timeout;

(async () => {
  const server = new RestServer();
  const ddrp = new DDRPManager();
  const indexer = new IndexerManager();

  await ddrp.start();
  await indexer.start();

  // Ingest on every blob sync
  ddrp.onNameSynced(indexer.streamBlob);

  const app = server.app;

  indexer.setRoutes(app);

  app.post('/services/startWatch', async function startWatchHandler(req, res) {
    if (req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }

    if (watchInterval) {
      clearInterval(watchInterval);
    }

    watchInterval = setInterval(() => {
      indexer.streamAllBlobs();
    }, 10 * 60 * 1000);

    res.send('ok');
  });

  app.post('/services/stopWatch', async function startWatchHandler(req, res) {
    if (req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }

    if (watchInterval) {
      clearInterval(watchInterval);
    }

    res.send('ok');
  });

  app.post('/services/ingest', async function ingestHandler(req, res) {
    if (req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }
    await indexer.streamAllBlobs();
    res.send(makeResponse('ok'));
  });

  app.post('/services/upsertPost', jsonParser, async function upsertPostHandler(req, res) {
    if (req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
    }

    const {
      content = '',
      guid = '',
      parent = '',
      context = '',
      subdomain = '',
      topic = '',
      tags = [],
      timestamp = 0,
      tld = '',
    } = req.body;

    const post = new WirePost(
      parent ? Buffer.from(parent, 'hex') : null,
      context ? Buffer.from(context, 'hex') : null,
      content,
      topic,
      tags,
    );
    const env = new Envelope(
      ENVELOPE_VERSION,
      WirePost.TYPE,
      new Date(timestamp),
      Buffer.from(guid.replace(/-/gi, ''), 'hex'),
      post,
    );

    const resp = await indexer.upsertPost(dotName(tld), subdomain, env);
    res.send(makeResponse(resp));
  });

  app.post('/services/upsertReaction', jsonParser, async function upsertReactionHandler(req, res) {
    if (!SERVICE_KEY || req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
    }

    const {
      guid = '',
      parent = '',
      subdomain = '',
      timestamp = 0,
      tld = '',
    } = req.body;
    const post = new WireReaction(
      parent ? Buffer.from(parent, 'hex') : Buffer.alloc(32),
      0,
    );
    const env = new Envelope(
      ENVELOPE_VERSION,
      WireReaction.TYPE,
      new Date(timestamp),
      Buffer.from(guid.replace(/-/gi, ''), 'hex'),
      post,
    );
    const resp = await indexer.upsertPost(dotName(tld), subdomain, env);
    res.send(makeResponse(resp));
  });

  app.post('/services/upsertFollow', jsonParser, async function upsertFollowHandler(req, res) {
    if (req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
    }

    const {
      guid = '',
      // eslint-disable-next-line @typescript-eslint/camelcase
      followee_subdomain = '',
      timestamp = 0,
      // eslint-disable-next-line @typescript-eslint/camelcase
      followee_tld = '',
      tld = '',
      subdomain = '',
    } = req.body;
    const follow = new WireFollow(followee_tld, followee_subdomain);
    const env = new Envelope(
      ENVELOPE_VERSION,
      WireFollow.TYPE,
      new Date(timestamp),
      Buffer.from(guid.replace(/-/gi, ''), 'hex'),
      follow,
    );
    const resp = await indexer.upsertPost(dotName(tld), subdomain, env);
    res.send(makeResponse(resp));
  });

  app.post('/services/upsertBlock', jsonParser, async function upsertBlockHandler(req, res) {
    if (req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
    }

    const {
      guid = '',
      // eslint-disable-next-line @typescript-eslint/camelcase
      blockee_subdomain = '',
      timestamp = 0,
      // eslint-disable-next-line @typescript-eslint/camelcase
      blockee_tld = '',
      tld = '',
      subdomain = '',
    } = req.body;
    const block = new WireBlock(blockee_tld, blockee_subdomain);
    const env = new Envelope(
      ENVELOPE_VERSION,
      WireBlock.TYPE,
      new Date(timestamp),
      Buffer.from(guid.replace(/-/gi, ''), 'hex'),
      block,
    );
    const resp = await indexer.upsertPost(dotName(tld), subdomain, env);
    res.send(makeResponse(resp));
  });

  await server.start();

  process.on('SIGTERM', async () => {
    await ddrp.stopDaemon();
  });
})();


