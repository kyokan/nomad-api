import HSDService from "./services/hsd";

require("isomorphic-fetch");

const bodyParser = require('body-parser');
import {RestServer} from "./services/rest-server";
import {FNDController} from "./services/fnd";
import {IndexerManager} from "./services/indexer";
import {SubdomainManager} from "./services/subdomains";
import {makeResponse} from "./util/rest";
import Timeout = NodeJS.Timeout;
import {Writer} from "./services/writer";
import PostgresAdapter from "./db/PostgresAdapter";
import {getConfig} from "./util/config";
const SERVICE_KEY = process.env.SERVICE_KEY;

const jsonParser = bodyParser.json();

let watchInterval: Timeout;

(async () => {
  let pgClient: PostgresAdapter | undefined;
  const config = await getConfig();

  if (config.postgres && config.postgres.host) {
    // @ts-ignore
    pgClient = new PostgresAdapter(config.postgres);
  }

  const hsdClient = new HSDService({
    host: config.handshakeRPCHost,
    apiKey: config.handshakeRPCKey,
    basePath: config.handshakeBasePath,
    port: config.handshakePort,
  });
  const server = new RestServer({
    hsdClient,
  });
  const fnd = new FNDController();
  const indexer = new IndexerManager({
    pgClient,
    hsdClient,
  });
  const subdomains = new SubdomainManager({
    indexer,
    pgClient,
  });
  const writer = new Writer({
    indexer,
    subdomains,
  });
  subdomains.writer = writer;

  await fnd.start();
  await indexer.start();
  await subdomains.start();

  // Ingest on every blob sync
  fnd.onNameSynced(async (tld) => {
    await indexer.streamBlobData(tld);
    await indexer.maybeStreamBlob(tld);
  });

  const app = server.app;

  indexer.setRoutes(app);
  writer.setRoutes(app);
  subdomains.setRoutes(app);

  app.post('/services/rescan', async function handleRescan(req, res) {
    if (SERVICE_KEY && req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }

    const ret = await indexer.scanMetadata();

    res.send(makeResponse(ret));
  }) ;

  app.post('/services/startWatch', async function startWatchHandler(req, res) {
    if (SERVICE_KEY && req.headers['service-key'] !== SERVICE_KEY) {
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
    if (SERVICE_KEY && req.headers['service-key'] !== SERVICE_KEY) {
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
    const ret = await indexer.scanMetadata();
    res.send(ret);
  });

  await server.start();

  process.on('SIGTERM', async () => {
    await fnd.stopDaemon();
  });
})();


