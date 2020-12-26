import express from "express";
import cors, {CorsOptions} from 'cors';
import {makeResponse} from "../../util/rest";
import logger from "../../util/logger";
import fs from "fs";
import HSDService from "../hsd";
const requestIp = require('request-ip');
import {getLinkPreview} from 'link-preview-js';
const port = process.env.PORT || 8082;

let docsHTML: string;

const whitelist: {[origin: string]: boolean} = {};
const corsOptions: CorsOptions = {
  origin: function (origin= '', callback) {
    callback(null, true);
  }
};

export class RestServer {
  app: ReturnType<typeof express>;
  hsdClient: HSDService;

  constructor(opts: {
    hsdClient: HSDService;
  }) {
    fs.promises.readFile('./build-doc/index.html')
      .then(buf => {
        docsHTML = buf.toString('utf-8');
      });

    this.hsdClient = opts.hsdClient;
    this.app = express();
    this.app.use(cors(corsOptions));
    this.app.use(requestIp.mw());
    this.app.use('/', express.static('./build-doc'));
    this.app.use('/docs', express.static('./build-doc'));
    this.app.use(async (req, res, next) => {
      if (req.path.slice(0, 5) === '/docs') {
        res.send(docsHTML);
      }

      try {
        next();
      } catch (err) {
        res.status(500).send(makeResponse(err.message, true));
      }
    });
  }

  setRoutes() {
    if (process.env.NODE_ENV === 'development') {
      this.app.get('/dev', (req, res) => {
        res.send(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Nomad Explorer</title>
            </head>
            <body>
              <input type="file" id="fileupload" value="Select File" />
              <script src="http://localhost:${port}/harness.js"></script>
            </body>
          </html>
        `);
      });
    }

    this.app.get('/hsd', async (req, res) => {
      const json = await this.hsdClient.fetchHSDInfo();
      res.send(makeResponse({
        ...json,
        pool: undefined,
      }));
    });

    this.app.get('/preview', async (req, res) => {
      const preview = await getLinkPreview(req.query.url);
      res.send(preview);
    });

    this.app.get('/health', (req, res) => {
      res.send(makeResponse('ok'));
    });


  }

  start() {
    this.setRoutes();
    this.app.listen(port, () => {
      logger.info(`Rest API listening at ${port}...`);
    });
  }
}
