import DDRPDClient from "ddrp-js/dist/ddrp/DDRPDClient";
import {Envelope, encodeEnvelope} from "ddrp-js/dist/social/Envelope";
import BlobWriter from "ddrp-js/dist/ddrp/BlobWriter";
import {sealHash} from "ddrp-js/dist/crypto/hash";
import {IndexerManager} from "../indexer";
import {Express} from "express";
import bodyParser from "body-parser";
import {makeResponse} from "../../util/rest";
const jsonParser = bodyParser.json();

import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {
  Connection as DomainConnection,
  Follow as DomainFollow,
  Block as DomainBlock,
} from 'ddrp-indexer/dist/domain/Connection';
import {Moderation as DomainModeration} from 'ddrp-indexer/dist/domain/Moderation';
import {Media as DomainMedia} from 'ddrp-indexer/dist/domain/Media';
import crypto from "crypto";
import {createRefhash} from 'ddrp-js/dist/social/refhash'
import logger from "../../util/logger";
import {trackAttempt} from "../../util/matomo";

export class Writer {
  client: DDRPDClient;
  indexer: IndexerManager;

  constructor(opts: {indexer: IndexerManager}) {
    this.client = new DDRPDClient('127.0.0.1:9098');
    this.indexer = opts.indexer;
  }

  async preCommit(tld: string, envelope: Envelope, offset: number = 0, date?: Date): Promise<{sealedHash: Buffer; txId: number}> {
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);

    logger.info(`precommiting`, { tld, txId });

    (async function() {
      return new Promise((resolve, reject) => encodeEnvelope(writer, envelope, (err, _) => {
        if (err) {
          logger.error(`error encoding envelope`, { tld, err });
          return reject(err);
        }
        resolve();
      }));
    })();

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

    (async function() {
      return new Promise((resolve, reject) => encodeEnvelope(writer, envelope, (err, _) => {
        if (err) {
          logger.error(`error encoding envelope`, { tld, err });
          return reject(err);
        }
        resolve();
      }));
    })();

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
      trackAttempt('Get Blob Info', req);
      const blobName = req.params.blobName;

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

type WriterEnvelopeParams = {
  post?: any;
  connection?: any;
  moderation?: any;
  media?: any;
  refhash?: string;
  networkId?: string;
  createAt?: Date;
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

  if (post) {
    envelope = new DomainEnvelope(
      0,
      tld,
      null,
      networkId,
      Buffer.from(refhash, 'hex'),
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
      Buffer.from(refhash, 'hex'),
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
      Buffer.from(refhash, 'hex'),
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
      Buffer.from(refhash, 'hex'),
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

