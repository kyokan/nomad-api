import DDRPDClient from "ddrp-js/dist/ddrp/DDRPDClient";
import {Envelope, encodeEnvelope} from "ddrp-js/dist/social/Envelope";
import BlobWriter from "ddrp-js/dist/ddrp/BlobWriter";
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

export class Writer {
  client: DDRPDClient;
  indexer: IndexerManager;

  constructor(opts: {indexer: IndexerManager}) {
    this.client = new DDRPDClient('127.0.0.1:9098');
    this.indexer = opts.indexer;
  }

  async preCommit(tld: string, envelope: Envelope, offset: number): Promise<Buffer> {
    const txId = await this.client.checkout(tld);
    const writer = new BlobWriter(this.client, txId, offset);

    (async function() {
      return new Promise((resolve, reject) => encodeEnvelope(writer, envelope, (err, _) => {
        if (err) {
          return reject(err);
        }
        resolve();
      }));
    })()

    return await this.client.preCommit(txId);
  }

  setRoutes(app: Express) {
    app.post(`/writer/precommit`, jsonParser, async (req, res) => {
      const {
        tld,
        post,
        connection,
        media,
        moderation,
        offset,
      } = req.body;

      if (!tld || typeof tld !== 'string') {
        return res.status(400)
          .send(makeResponse('invalid tld', true));
      }

      let envelope: Envelope | undefined;

      try {
        if (post) {
          const domainEnv = await DomainEnvelope.createWithMessage(
            0,
            tld,
            null,
            post.networkId || crypto.randomBytes(8).toString('hex'),
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
          envelope = domainEnv.toWire(0);
        }

        if (!envelope) {
          return res.status(400)
            .send(makeResponse('invalid envelope', true));
        }

        const merkleRoot = await this.preCommit(tld, envelope, offset);

        res.send(makeResponse(merkleRoot.toString('hex')));

      } catch (e) {
        return res.status(500)
          .send(makeResponse(e.message, true));
      }
    });
  }
}

