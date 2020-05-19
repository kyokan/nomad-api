import bodyParser from 'body-parser';
import {RestServer} from "./services/rest-server";
import {DDRPManager} from "./services/ddrp";
import {IndexerManager} from "./services/indexer";
import {makeResponse} from "./util/rest";
import Timeout = NodeJS.Timeout;
import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {SqliteEngine, Row} from 'ddrp-indexer/dist/dao/Engine';
import {Connection as DomainConnection} from 'ddrp-indexer/dist/domain/Connection';
import {Moderation as DomainModeration} from 'ddrp-indexer/dist/domain/Moderation';
import {dotName} from "./util/user";
import logger from "./util/logger";
import * as path from "path";
const SERVICE_KEY = process.env.SERVICE_KEY;

const jsonParser = bodyParser.json();

const appDataPath = './build';
const dbPath = path.join(appDataPath, 'pending.db');

let watchInterval: Timeout;

(async () => {
  const server = new RestServer();
  const ddrp = new DDRPManager();
  const indexer = new IndexerManager();
  const engine = new SqliteEngine(dbPath);

  await ddrp.start();
  await indexer.start();

  // Ingest on every blob sync
  ddrp.onNameSynced(indexer.maybeStreamBlob);

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
    if (SERVICE_KEY && req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }
    await indexer.streamAllBlobs();
    res.send(makeResponse('ok'));
  });

  app.post('/services/upsertPost', jsonParser, async function upsertPostHandler(req, res) {
    if (SERVICE_KEY && req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }

    const {
      body = '',
      id = 0,
      network_id = '',
      refhash = '',
      tags = [],
      timestamp = 0,
      tld = '',
      username = '',
      reference = '',
      topic = '',
    } = req.body;

    const env = new DomainEnvelope(
      id,
      tld,
      username,
      network_id,
      refhash,
      new Date(timestamp),
      new DomainPost(
        0,
        body,
        '',
        reference,
        topic,
        tags,
        0,
        0,
        0,
      ),
      null,
    );

    const resp = await indexer.insertPendingPost(dotName(tld), env);
    res.send(makeResponse(resp));
  });

  app.post('/services/upsertModeration', jsonParser, async function upsertReactionHandler(req, res) {
    if (SERVICE_KEY && req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }

    const {
      network_id = '',
      refhash = '',
      username = '',
      timestamp = 0,
      tld = '',
      reference = '',
      type = '',
    } = req.body;

    const env = new DomainEnvelope(
      0,
      tld,
      username,
      network_id,
      refhash,
      new Date(timestamp),
      new DomainModeration(
        0,
        reference,
        type,
      ),
      null,
    );

    const resp = await indexer.insertPendingModeration(dotName(tld), env);
    res.send(makeResponse(resp));
  });

  app.post('/services/upsertConnection', jsonParser, async function upsertBlockHandler(req, res) {
    if (SERVICE_KEY && req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }

    const {
      network_id = '',
      refhash = '',
      username = '',
      timestamp = 0,
      tld = '',
      connectee_tld = '',
      connectee_subdomain = '',
      type = '',
    } = req.body;

    const env = new DomainEnvelope(
      0,
      tld,
      username,
      network_id,
      refhash,
      new Date(timestamp),
      new DomainConnection(
        0,
        connectee_tld,
        connectee_subdomain,
        type,
      ),
      null,
    );
    const resp = await indexer.insertPendingConnection(dotName(tld), env);
    res.send(makeResponse(resp));
  });

  await server.start();

  process.on('SIGTERM', async () => {
    await ddrp.stopDaemon();
  });
})();


