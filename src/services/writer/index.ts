import FootnoteClient from "fn-client/lib/fnd/FootnoteClient";
import SECP256k1Signer from 'fn-client/lib/crypto/signer'
import {encodeEnvelope, Envelope} from "fn-client/lib/wire/Envelope";
import BlobWriter from "fn-client/lib/fnd/BlobWriter";
import {sealHash} from "fn-client/lib/crypto/hash";
import {sealAndSign} from "fn-client/lib/crypto/signatures";
import {encodeSubdomain, Subdomain, SUBDOMAIN_MAGIC} from "fn-client/lib/wire/Subdomain";
import {IndexerManager} from "../indexer";
import {Express, Request, Response} from "express";
import bodyParser from "body-parser";
import {makeResponse} from "../../util/rest";
import {createRefhash} from 'fn-client/lib/wire/refhash';
import logger from "../../util/logger";
import {trackAttempt} from "../../util/mixpanel";
import {SubdomainDBRow, SubdomainManager} from "../subdomains";
import {createEnvelope, mapBodyToEnvelope} from "../../util/envelope";
import {BufferedReader} from "fn-client/lib/io/BufferedReader";
import {BlobReader} from "fn-client/lib/fnd/BlobReader";
import {Envelope as DomainEnvelope} from 'fn-client/lib/application/Envelope';
import {getConfig} from "../../util/config";

const jsonParser = bodyParser.json();
const SERVICE_KEY = process.env.SERVICE_KEY;

export class Writer {
  client: FootnoteClient;
  indexer: IndexerManager;

  constructor(opts: {indexer: IndexerManager}) {
    this.client = new FootnoteClient('127.0.0.1:9098');
    this.indexer = opts.indexer;
  }

  handlers = {
    '/blob/:blobName/info': async (req: Request, res: Response) => {
      const blobName = req.params.blobName;

      try {
        const info = await this.client.getBlobInfo(blobName);
        let offset = 0;

        await this.client.scanBlob(blobName, async (type, subtype, env) => {
          const bytes = await env.toBytes();
          offset = offset + bytes.length;
          return true;
        }, 8*1024).catch(() => null);

        res.send(makeResponse({
          ...info,
          offset,
        }));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    },

    '/relayer/precommit': async (req: Request, res: Response) => {
      const {
        tld,
        post,
        connection,
        media,
        moderation,
        offset,
        date,
        refhash,
        networkId,
        truncate,
      } = req.body;

      if (!tld || typeof tld !== 'string') {
        return res.status(400)
          .send(makeResponse('invalid tld', true));
      }

      let envelope: Envelope | undefined;

      const createdAt = date ? new Date(date) : new Date();

      try {
        envelope = await mapBodyToEnvelope(tld, {
          post,
          connection,
          moderation,
          media,
          createAt: createdAt,
          refhash,
          networkId,
        });

        if (!envelope) {
          return res.status(400)
            .send(makeResponse('invalid envelope', true));
        }

        const rh = await createRefhash(envelope, '', tld);
        const rhHex = rh.toString('hex');


        if (!envelope) {
          return res.status(400)
            .send(makeResponse('invalid envelope', true));
        }

        const {sealedHash, txId} = await this.preCommit(tld, envelope, offset, createdAt, truncate);

        trackAttempt('Precommit Blob', req, { name: tld });

        res.send(makeResponse({
          sealedHash: sealedHash.toString('hex'),
          envelope,
          txId,
          refhash: refhash || rhHex,
        }));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    },

    '/relayer/commit': async (req: Request, res: Response) => {
      const {
        tld,
        post,
        connection,
        media,
        moderation,
        offset,
        date,
        networkId,
        sealedHash,
        sig,
        refhash,
        truncate,
      } = req.body;

      if (!tld || typeof tld !== 'string') {
        return res.status(400).send(makeResponse('invalid tld', true));
      }

      if (!sealedHash || typeof sealedHash !== 'string') {
        return res.status(400).send(makeResponse('invalid hash', true));
      }

      if (!sig || typeof sig !== 'string') {
        return res.status(400).send(makeResponse('invalid sig', true));
      }

      if (!date) {
        return res.status(400).send(makeResponse('invalid date', true));
      }

      let envelope: Envelope | undefined;
      const createdAt = date ? new Date(date) : new Date();

      try {
        envelope = await createEnvelope(tld, {
          post,
          connection,
          moderation,
          media,
          networkId,
          createAt: createdAt,
          refhash,
        });

        if (!envelope && !truncate) {
          return res.status(400).send(makeResponse('invalid envelope', true));
        }

        await this.commit(
          tld,
          envelope,
          offset,
          new Date(date),
          sealedHash,
          sig,
          truncate,
        );

        trackAttempt('Commit Blob', req, { name: tld });

        if (envelope && !truncate) {
          await this.indexer.insertPost(tld, envelope);
        }

        res.send(makeResponse('ok'));
      } catch (e) {
        return res.status(500).send(makeResponse(e.message, true));
      }
    },
  };

  async reconstructBlob(tld: string, date?: Date, broadcast?: boolean, source?: 'sqlite' | 'postgres'): Promise<void> {
    // await Promise.all(users.map(async (user) => {
    //   await this.subdomains.addSubdomain(`${user.tld}`, user.subdomain, user.email, null, user.hashed_password);
    // }));
    // return;
    const config = await getConfig();
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const envs = await this.indexer.getUserEnvelopes(tld, source);

    const createdAt = date || new Date();

    const br = new BlobReader(tld, this.client);
    const r = new BufferedReader(br, 4 * 1024 * 1024 - 5);

    await this.truncateBlob(tld, createdAt);

    let offset = 0;

    for (let i = 0; i < envs.length; i++) {
      const env: DomainEnvelope<any> = envs[i];
      const shouldBroadcast = broadcast && i === envs.length - 1;

      const endOffset = await this.appendEnvelope(
        tld,
        env.toWire(0),
        createdAt,
        shouldBroadcast,
        offset,
      );
      offset = endOffset;
    }
  }

  // @ts-ignore
  async commitSubdomain(tld: string, sub?: SubdomainDBRow, nameIndex = 0, date: Date, offset = 3, broadcast?: boolean): Promise<number> {
    const config = await getConfig();
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);

    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);
    const num = await encodeSubdomainAsync(writer, {
      name: sub?.name || '',
      index: nameIndex,
      publicKey: sub?.public_key ? Buffer.from(sub.public_key || '', 'hex') : Buffer.alloc(33),
    });
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, date, merkleRoot);
    await this.client.commit(txId, date, sig, broadcast);
    logger.info(`append subdomain`, { tld, offset, subdomain: sub?.name });
    return num + offset;
  }

  async truncateBlob(tld: string, date?: Date, broadcast?: boolean, _signer?: SECP256k1Signer): Promise<void> {
    const config = await getConfig();
    const tldData = config.signers[tld];
    let signer: SECP256k1Signer;

    if (!_signer) {
      if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);
      signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    } else {
      signer = _signer;
    }

    const createdAt = date || new Date();
    const txId = await this.client.checkout(tld);
    await this.client.truncate(txId);
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, broadcast);
  }

  async appendEnvelope(
    tld: string,
    envelope: Envelope,
    date?: Date,
    broadcast?: boolean,
    offset = 0,
    _signer?: SECP256k1Signer,
  ): Promise<number> {
    const config = await getConfig();
    const tldData = config.signers[tld];
    const createdAt = date || new Date();

    let signer: SECP256k1Signer;

    if (!_signer) {
      if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);
      signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    } else {
      signer = _signer;
    }

    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);
    const numOfBytes = await encodeEnvelopeAsync(writer, envelope);
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, broadcast);
    logger.info(`append envelope`, { tld, nameIndex: envelope.nameIndex, offset });
    return offset + numOfBytes;
  }

  async writeAt (tld: string, offset = 0, buf: Buffer): Promise<void> {
    const config = await getConfig();
    const tldData = config.signers[tld];
    const createdAt = new Date();

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    const txId = await this.client.checkout(tld);
    await this.client.writeAt(txId, offset, buf);
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, false);
  }

  async writeEnvelopeAt(tld: string, envelope: Envelope, offset = 0, date?: Date, broadcast?: boolean): Promise<void> {
    const config = await getConfig();
    const tldData = config.signers[tld];
    const createdAt = date || new Date();

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);
    await encodeEnvelopeAsync(writer, envelope);
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, broadcast);
  }

  async preCommit(tld: string, envelope: Envelope, offset = 0, date?: Date, truncate = false): Promise<{sealedHash: Buffer; txId: number}> {
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);

    logger.info(`precommiting`, { tld, txId });

    if (truncate) {
      await this.client.truncate(txId);
    } else if (envelope) {
      await encodeEnvelopeAsync(writer, envelope);
    }

    const merkleRoot = await this.client.preCommit(txId);

    return {
      sealedHash: sealHash(tld, date || new Date(), merkleRoot),
      txId,
    };
  }

  // @ts-ignore
  async commit(tld: string, envelope?: Envelope, offset = 0, date: Date, hash: string, sig: string, truncate = false): Promise<void> {
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);

    logger.info(`commiting`, { tld, txId });

    if (truncate) {
      await this.client.truncate(txId);
    } else if (envelope) {
      await encodeEnvelopeAsync(writer, envelope);
    }

    const merkleRoot = await this.client.preCommit(txId);
    const sealedHash = sealHash(tld, date || new Date(), merkleRoot);
    const sealedHashHex = sealedHash.toString('hex');

    if (sealedHashHex !== hash) {
      logger.error(`does not match precommit hash`, {
        precommit: sealedHashHex,
        commit: hash,
      });
      throw new Error(`hash should be ${sealedHashHex}`);
    }

    const res = await this.client.commit(txId, date, Buffer.from(sig, 'hex'), true);
    return res;
  }

  setRoutes(app: Express) {
    app.post('/blob/:blobName/format', jsonParser, async (req, res) => {
      const blobName = req.params.blobName;

      const {
        broadcast,
        source,
      } = req.body;

      if (!SERVICE_KEY || req.headers['service-key'] !== SERVICE_KEY) {
        res.status(401).send(makeResponse('unauthorized', true));
        return;
      }

      if (!blobName) {
        return res.status(400)
          .send(makeResponse('invalid tld', true));
      }

      trackAttempt('reformat blob', req, { name: blobName });
      try {
        await this.reconstructBlob(blobName, undefined, broadcast, source);
        return res.send(makeResponse('ok'));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });

    app.post(`/relayer/precommit`, jsonParser, async (req, res) => {
      return this.handlers['/relayer/precommit'](req, res);
    });

    app.get('/blob/:blobName/info', async (req, res) => {
      const blobName = req.params.blobName;

      trackAttempt('Get Blob Info', req, {
        name: blobName,
      });

      try {
        const info = await this.client.getBlobInfo(blobName);
        let offset = 0;

        await this.client.scanBlob(blobName, async (type, subtype, env) => {
          const bytes = await env.toBytes();
          offset = offset + bytes.length;
          return true;
        }, 8*1024).catch(() => null);

        res.send(makeResponse({
          ...info,
          offset,
        }));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });

    app.post(`/relayer/commit`, jsonParser, async (req, res) => {
      return this.handlers['/relayer/commit'](req, res);
    });
  }
}


async function encodeEnvelopeAsync(writer: BlobWriter, envelope: Envelope): Promise<number> {
  return new Promise((resolve, reject) => encodeEnvelope(writer, envelope, (err, numOfBytes) => {
    if (err) {
      return reject(err);
    }
    resolve(numOfBytes);
  }));
}

async function encodeSubdomainAsync(writer: BlobWriter, sub: Subdomain): Promise<number> {
  return new Promise((resolve, reject) => encodeSubdomain(writer, sub, (err, numOfBytes) => {
    if (err) {
      return reject(err);
    }
    resolve(numOfBytes);
  }));
}
