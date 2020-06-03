import * as path from "path";
import {SqliteEngine} from 'ddrp-indexer/dist/dao/Engine';
import logger from "../../util/logger";
import * as fs from "fs";
import {Express, Request, Response} from "express";
import bodyParser from "body-parser";
import {makeResponse} from "../../util/rest";
import config from "../../../config.json";
const jsonParser = bodyParser.json();
const appDataPath = './build';
const namedbPath = path.join(appDataPath, 'names.db');
import {createRefhash} from 'ddrp-js/dist/social/refhash';
import {PostBody} from "../../constants";
import {Writer} from "../writer";
import {hashPostBody, mapBodyToEnvelope} from "../../util/envelope";
// @ts-ignore
import secp256k1 from 'secp256k1';

export type SubdomainDBRow = {
  name: string;
  public_key: string;
  tld: string;
  email: string;
}

export class SubdomainManager {
  nameDB: SqliteEngine;
  namedbPath: string;
  resourcePath: string;
  writer?: Writer;

  constructor(opts?: { dbPath?: string; namedbPath?: string; resourcePath?: string; pendingDbPath?: string }) {
    this.nameDB = new SqliteEngine(opts?.namedbPath || namedbPath);
    this.namedbPath = opts?.namedbPath || namedbPath;
    this.resourcePath = opts?.resourcePath || 'resources';
  }

  async start () {
    const exists = await this.dbExists();

    if (!exists) {
      logger.info('[subdomains manager] Copying database');
      await this.copyDB();
      logger.info('[subdomains manager] Copied database');
    }

    await this.nameDB.open();
  }

  private async dbExists () {
    try {
      await fs.promises.access(this.namedbPath, fs.constants.F_OK);
    } catch (e) {
      logger.error(new Error(`${this.namedbPath} does not exist`));
      return false;
    }

    logger.info(`[indexer manager] ${this.namedbPath} exists`);
    return true;
  }

  private async copyDB () {
    const nameSrc = path.join(this.resourcePath, 'names.db');
    await fs.promises.copyFile(nameSrc, this.namedbPath);
  }

  async addSubdomainPost(subdomain: string, tld: string, post: PostBody, date?: Date) {
    const subs = await this.getSubdomainByTLD(tld);
    const nameIndex = subs.map(({ name }) => name).indexOf(subdomain) + 1;

    const env = await mapBodyToEnvelope(tld, {
      post,
      nameIndex,
    });

    if (!env) throw new Error('invalid post');

    return this.writer?.appendEnvelope(tld, env, date);
  }

  async getNameIndex(subdomain: string | null, tld: string): Promise<number> {
    if (!subdomain) return 0;
    const subs = await this.getSubdomainByTLD(tld);
    const nameIndex = subs.map(({ name }) => name).indexOf(subdomain) + 1;
    console.log(nameIndex, subdomain, tld)
    return nameIndex;
  }

  async getSubdomainByTLD(tld: string): Promise<SubdomainDBRow[]> {
    const rows: SubdomainDBRow[] = [];

    this.nameDB!.each(`
      SELECT * FROM names
      WHERE tld = @tld
      ORDER BY name
    `, {
      tld,
    }, (row) => {
      rows.push(row as SubdomainDBRow);
    });

    return rows;
  }

  getSubdomain(tld: string, subdomain: string): SubdomainDBRow | null {
    let sub: SubdomainDBRow | null = null;

    this.nameDB!.each(`
      SELECT * FROM names
      WHERE tld = @tld AND name = @subdomain
    `, { tld, subdomain }, row => {
      sub = row as SubdomainDBRow;
    });

    return sub;
  }

  async addSubdomain(tld: string, subdomain: string, email: string, publicKey: string): Promise<void> {
    // @ts-ignore
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    this.nameDB!.exec(`
        INSERT INTO names (name, public_key, tld, email)
        VALUES (@subdomain, @publicKey, @tld, @email)
    `, {
      tld,
      subdomain,
      publicKey,
      email,
    });
  }

  handleSubdomainPost = async (req: Request, res: Response) => {
    const {
      tags = [],
      title,
      body,
      topic,
      reference,
      sig,
    } = req.body;

    const { tld, subdomain, signature } = sig || {};
    const post = {
      tags,
      title,
      body,
      topic,
      reference,
    };

    const { public_key = '' } = this.getSubdomain(tld, subdomain) || {};
    const hash = hashPostBody(post);

    const verfied = secp256k1.verify(
      hash,
      Buffer.from(signature, 'hex'),
      Buffer.from(public_key, 'hex')
    );

    if (!verfied) {
      return res.status(403).send(makeResponse('not authorized'));
    }

    await this.addSubdomainPost(subdomain, tld, post);
    return res.send('ok');
  };

  setRoutes(app: Express) {
    app.post('/posts', jsonParser, this.handleSubdomainPost);

    app.post('/users', jsonParser, async (req, res) => {
      const {
        username,
        tld,
        email,
        publicKey,
      } = req.body;

      if (!username || typeof username !== 'string') {
        return res.status(400).send(makeResponse('invalid username'));
      }

      if (!tld || typeof tld !== 'string') {
        return res.status(400).send(makeResponse('invalid tld'));
      }

      if (!email || typeof email !== 'string') {
        return res.status(400).send(makeResponse('invalid email'));
      }

      if (!publicKey || typeof publicKey !== 'string' || Buffer.from(publicKey, 'hex').length !== 33) {
        return res.status(400).send(makeResponse('invalid public key'));
      }

      try {
        await this.addSubdomain(tld, username, email, publicKey);
        res.send('ok');
      } catch (e) {
        res.status(500).send(makeResponse(e.message));
      }
    });
  }
}
