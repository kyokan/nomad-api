import DDRPDClient from "ddrp-js/dist/ddrp/DDRPDClient";
import SECP256k1Signer from 'ddrp-js/dist/crypto/signer'
import {encodeEnvelope, Envelope} from "ddrp-js/dist/social/Envelope";
import BlobWriter from "ddrp-js/dist/ddrp/BlobWriter";
import {sealHash} from "ddrp-js/dist/crypto/hash";
import {sealAndSign} from "ddrp-js/dist/crypto/signatures";
import {encodeSubdomain, Subdomain, SUBDOMAIN_MAGIC} from "ddrp-js/dist/social/Subdomain";
import {IndexerManager} from "../indexer";
import {Express, Request, Response} from "express";
import bodyParser from "body-parser";
import {makeResponse} from "../../util/rest";
import {createRefhash} from 'ddrp-js/dist/social/refhash';
import logger from "../../util/logger";
import {trackAttempt} from "../../util/matomo";
import config from "../../../config.json";
import {SubdomainDBRow, SubdomainManager} from "../subdomains";
import {createEnvelope, mapBodyToEnvelope} from "../../util/envelope";

const jsonParser = bodyParser.json();
const SERVICE_KEY = process.env.SERVICE_KEY;

export class Writer {
  client: DDRPDClient;
  indexer: IndexerManager;
  subdomains: SubdomainManager;

  constructor(opts: {indexer: IndexerManager; subdomains: SubdomainManager}) {
    this.client = new DDRPDClient('127.0.0.1:9098');
    this.indexer = opts.indexer;
    this.subdomains = opts.subdomains;
  }

  async reconstructBlob(tld: string, envelope?: Envelope, date?: Date, broadcast?: boolean): Promise<void> {
    // @ts-ignore
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const envs = await this.indexer.getUserEnvelopes(tld);
    const subs = await this.subdomains.getSubdomainByTLD(tld);

    const createdAt = date || new Date();

    await this.truncateBlob(tld, createdAt);

    await this.writeAt(tld, 0, Buffer.from(SUBDOMAIN_MAGIC, 'utf-8'));

    for (let j = 0; j < subs.length; j++) {
      await this.commitSubdomain(tld, subs[j], j + 1, createdAt);
    }

    let offset = 64 * 1024;

    for (let i = 0; i < envs.length; i++) {
      const shouldBroadcast = broadcast && !envelope && i === envs.length - 1;
      const endOffset = await this.appendEnvelope(
        tld,
        envs[i].toWire(await this.subdomains.getNameIndex(envs[i]?.subdomain, tld)),
        envs[i].createdAt,
        shouldBroadcast,
        offset,
      );
      offset = endOffset;
    }

    if (envelope && date) {
      await this.appendEnvelope(tld, envelope, date, broadcast, offset);
    }
  }

  async commitSubdomain(tld: string, sub: SubdomainDBRow, nameIndex = 0, date: Date): Promise<void> {
    // @ts-ignore
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);

    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, 3);
    await encodeSubdomainAsync(writer, {
      name: sub.name,
      index: nameIndex,
      publicKey: Buffer.from(sub.public_key, 'hex'),
    });
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, date, merkleRoot);
    await this.client.commit(txId, date, sig, false);
  }

  async truncateBlob(tld: string, date?: Date, broadcast?: boolean): Promise<void> {
    // @ts-ignore
    const tldData = config.signers[tld];

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const createdAt = date || new Date();

    const txId = await this.client.checkout(tld);
    await this.client.truncate(txId);
    const merkleRoot = await this.client.preCommit(txId);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, broadcast);
  }

  async appendEnvelope(tld: string, envelope: Envelope, date?: Date, broadcast?: boolean, _offset?: number): Promise<number> {
    // @ts-ignore
    const tldData = config.signers[tld];
    const createdAt = date || new Date();

    if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

    const offset = _offset || await this.indexer.findNextOffset(tld);
    const signer = SECP256k1Signer.fromHexPrivateKey(tldData.privateKey);
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);
    const numOfBytes = await encodeEnvelopeAsync(writer, envelope);
    const merkleRoot = await this.client.preCommit(txId);
    const sig = sealAndSign(signer, tld, createdAt, merkleRoot);
    await this.client.commit(txId, createdAt, sig, broadcast);
    logger.info(`append envelope`, { tld, offset, networkId: envelope.id });
    return offset + numOfBytes;
  }

  async writeAt (tld: string, offset: number = 0, buf: Buffer): Promise<void> {
    // @ts-ignore
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

  async writeEnvelopeAt(tld: string, envelope: Envelope, offset: number = 0, date?: Date, broadcast?: boolean): Promise<void> {
    // @ts-ignore
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

  async preCommit(tld: string, envelope: Envelope, offset: number = 0, date?: Date): Promise<{sealedHash: Buffer; txId: number}> {
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);

    logger.info(`precommiting`, { tld, txId });

    await encodeEnvelopeAsync(writer, envelope);

    const merkleRoot = await this.client.preCommit(txId);

    return {
      sealedHash: sealHash(tld, date || new Date(), merkleRoot),
      txId,
    };
  }

  async commit(tld: string, envelope: Envelope, offset: number = 0, date: Date, hash: string, sig: string): Promise<void> {
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);

    logger.info(`commiting`, { tld, txId });

    await encodeEnvelopeAsync(writer, envelope);

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

    return this.client.commit(txId, date, Buffer.from(sig, 'hex'), true);
  }

  handleAppendBlob = async (req: Request, res: Response) => {
    const blobName = req.params.blobName;

    if (!SERVICE_KEY || req.headers['service-key'] !== SERVICE_KEY) {
      res.status(401).send(makeResponse('unauthorized', true));
      return;
    }

    trackAttempt('append to blob', req, blobName);

    const {
      post,
      connection,
      media,
      moderation,
      broadcast,
      date,
      refhash,
      networkId,
    } = req.body;

    if (!blobName || typeof blobName !== 'string') {
      return res.status(400)
        .send(makeResponse('invalid tld', true));
    }

    const createdAt = date ? new Date(date) : new Date();

    let envelope: Envelope | undefined;

    try {
      envelope = await mapBodyToEnvelope(blobName, {
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

      await this.appendEnvelope(blobName, envelope, createdAt, broadcast);

      return res.send(makeResponse(envelope));
    } catch (e) {
      return res.status(500)
        .send(makeResponse(e.message, true));
    }
  };

  setRoutes(app: Express) {
    app.post('/blob/:blobName/format', jsonParser, async (req, res) => {
      const blobName = req.params.blobName;

      const {
        broadcast,
      } = req.body;

      if (!SERVICE_KEY || req.headers['service-key'] !== SERVICE_KEY) {
        res.status(401).send(makeResponse('unauthorized', true));
        return;
      }

      if (!blobName) {
        return res.status(400)
          .send(makeResponse('invalid tld', true));
      }

      trackAttempt('reformat blob', req, blobName);

      try {
        await this.reconstructBlob(blobName, broadcast);
        return res.send(makeResponse('ok'));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });

    app.post(`/blob/:blobName/append`, jsonParser, this.handleAppendBlob);

    app.post(`/relayer/precommit`, jsonParser, async (req, res) => {
      trackAttempt('Precommit Blob', req);
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

        const {sealedHash, txId} = await this.preCommit(tld, envelope, offset, createdAt);

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
    });

    app.get('/blob/:blobName/info', async (req, res) => {
      const blobName = req.params.blobName;

      trackAttempt('Get Blob Info', req, blobName);

      try {
        const info = await this.client.getBlobInfo(blobName);
        const nextOffset = await this.indexer.findNextOffset(blobName);
        res.send(makeResponse({ ...info, nextOffset }));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });

    app.post(`/relayer/commit`, jsonParser, async (req, res) => {
      trackAttempt('Commit Blob', req);
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

      if (!networkId || typeof networkId !== 'string') {
        return res.status(400).send(makeResponse('invalid networkId', true));
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

        if (!envelope) {
          return res.status(400).send(makeResponse('invalid envelope', true));
        }

        await this.commit(
          tld,
          envelope,
          offset,
          new Date(date),
          sealedHash,
          sig,
        );

        res.send(makeResponse('ok'));
      } catch (e) {
        return res.status(500).send(makeResponse(e.message, true));
      }
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
