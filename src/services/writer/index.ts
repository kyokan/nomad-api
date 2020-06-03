import DDRPDClient from "ddrp-js/dist/ddrp/DDRPDClient";
import SECP256k1Signer from 'ddrp-js/dist/crypto/signer'
import {Envelope, encodeEnvelope} from "ddrp-js/dist/social/Envelope";
import BlobWriter from "ddrp-js/dist/ddrp/BlobWriter";
import {sealHash} from "ddrp-js/dist/crypto/hash";
import {sealAndSign} from "ddrp-js/dist/crypto/signatures";
import {IndexerManager} from "../indexer";
import {Express} from "express";
import bodyParser from "body-parser";
import {makeResponse} from "../../util/rest";
const jsonParser = bodyParser.json();
const SERVICE_KEY = process.env.SERVICE_KEY;

import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {
  Connection as DomainConnection, ConnectionType,
  Follow as DomainFollow,
  Block as DomainBlock,
} from 'ddrp-indexer/dist/domain/Connection';
import {Moderation as DomainModeration, ModerationType} from 'ddrp-indexer/dist/domain/Moderation';
import {Media as DomainMedia} from 'ddrp-indexer/dist/domain/Media';
import crypto from "crypto";
import {createRefhash} from 'ddrp-js/dist/social/refhash'
import logger from "../../util/logger";
import {trackAttempt} from "../../util/matomo";
import config from "../../../config.json";

export class Writer {
  client: DDRPDClient;
  indexer: IndexerManager;

  constructor(opts: {indexer: IndexerManager}) {
    this.client = new DDRPDClient('127.0.0.1:9098');
    this.indexer = opts.indexer;
  }

  async writeEnvelopeAt(tld: string, envelope: Envelope, offset: number = 0, date?: Date): Promise<void> {
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
    await this.client.commit(txId, createdAt, sig, true);
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


  setRoutes(app: Express) {
    app.post(`/blob/:blobName/append`, jsonParser, async (req, res) => {
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
        // offset,
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

        const offset = await this.indexer.findNextOffset(blobName);

        await this.writeEnvelopeAt(blobName, envelope, offset, createdAt);

        return res.send(makeResponse(envelope));
      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });

    app.post(`/writer/precommit`, jsonParser, async (req, res) => {
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

    app.get('/blob/:blobName', async (req, res) => {
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

    app.post(`/writer/commit`, jsonParser, async (req, res) => {
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

export type WriterEnvelopeParams = {
  post?: PostBody;
  connection?: ConnectionBody;
  moderation?: ModerationBody;
  media?: MediaBody;
  refhash?: string;
  networkId?: string;
  createAt?: Date;
}

export type PostBody = {
  body: string;
  title: string | null;
  reference: string | null;
  topic: string | null;
  tags: string[];
}

export type ConnectionBody = {
  tld: string;
  subdomain: string | null;
  type: ConnectionType;
}

export type MediaBody = {
  filename: string;
  mimeType: string;
  content: string;
}

export type ModerationBody = {
  reference: string;
  type: ModerationType;
}

async function mapBodyToEnvelope(tld: string, params: WriterEnvelopeParams): Promise<Envelope|undefined> {
  const {
    post,
    connection,
    moderation,
    media,
    refhash,
    networkId,
    createAt,
  } = params;

  if (refhash && networkId && createAt) {
    return createEnvelope(tld, params);
  }

  let envelope: DomainEnvelope<any> | undefined;

  if (post) {
    envelope = await DomainEnvelope.createWithMessage(
      0,
      tld,
      null,
      networkId || crypto.randomBytes(8).toString('hex'),
      new DomainPost(
        0,
        post.body,
        post.title,
        post.reference,
        post.topic,
        post.tags,
        0,
        0,
        0,
      )
    );
  }

  if (connection) {
    envelope = await DomainEnvelope.createWithMessage(
      0,
      tld,
      null,
      networkId || crypto.randomBytes(8).toString('hex'),
      new DomainConnection(
        0,
        connection.tld,
        connection.subdomain,
        connection.type,
      ),
    );
  }

  if (moderation) {
    envelope = await DomainEnvelope.createWithMessage(
      0,
      tld,
      null,
      networkId || crypto.randomBytes(8).toString('hex'),
      new DomainModeration(
        0,
        moderation.reference,
        moderation.type,
      ),
    )
  }

  if (media) {
    envelope = await DomainEnvelope.createWithMessage(
      0,
      tld,
      null,
      networkId || crypto.randomBytes(8).toString('hex'),
      new DomainMedia(
        0,
        media.filename,
        media.mimeType,
        Buffer.from(media.content, 'hex'),
      ),
    )
  }

  return envelope!.toWire(0);
}

async function createEnvelope(tld: string, params: WriterEnvelopeParams): Promise<Envelope|undefined> {
  const {
    post,
    connection,
    moderation,
    media,
    networkId,
    refhash,
    createAt,
  } = params;

  let envelope: DomainEnvelope<any> | undefined;

  if (!networkId || !refhash || !createAt) return undefined;

  if (post) {
    envelope = new DomainEnvelope(
      0,
      tld,
      null,
      networkId,
      refhash,
      createAt,
      new DomainPost(
        0,
        post.body,
        post.title,
        post.reference,
        post.topic,
        post.tags,
        0,
        0,
        0,
      ),
      null,
    );
  }

  if (connection) {
    envelope = new DomainEnvelope(
      0,
      tld,
      null,
      networkId,
      refhash,
      createAt,
      new DomainConnection(
        0,
        connection.tld,
        connection.subdomain,
        connection.type,
      ),
      null,
    );
  }

  if (moderation) {
    envelope = new DomainEnvelope(
      0,
      tld,
      null,
      networkId,
      refhash,
      createAt,
      new DomainModeration(
        0,
        moderation.reference,
        moderation.type,
      ),
      null,
    )
  }

  if (media) {
    envelope = new DomainEnvelope(
      0,
      tld,
      null,
      networkId,
      refhash,
      createAt,
      new DomainMedia(
        0,
        media.filename,
        media.mimeType,
        Buffer.from(media.content, 'hex'),
      ),
      null
    )
  }

  return envelope!.toWire(0);
}


async function encodeEnvelopeAsync(writer: BlobWriter, envelope: Envelope) {
  return new Promise((resolve, reject) => encodeEnvelope(writer, envelope, (err, _) => {
    if (err) {
      return reject(err);
    }
    resolve();
  }));
};
