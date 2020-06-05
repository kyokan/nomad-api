// @ts-ignore
import blake2b from 'blake2b';
import {Envelope as WireEnvelope} from "ddrp-js/dist/social/Envelope";
import {Post as WirePost} from "ddrp-js/dist/social/Post";
import {Connection as WireConnection} from "ddrp-js/dist/social/Connection";
import {Moderation as WireModeration} from "ddrp-js/dist/social/Moderation";
import {Media as WireMedia} from "ddrp-js/dist/social/Media";
import {createRefhash} from "ddrp-js/dist/social/refhash";

import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {
  Connection as DomainConnection,
  ConnectionType as DomainConnectionType,
} from 'ddrp-indexer/dist/domain/Connection';
import {
  Moderation as DomainModeration,
  ModerationType as DomainModerationType,
} from 'ddrp-indexer/dist/domain/Moderation';
import {Media as DomainMedia} from 'ddrp-indexer/dist/domain/Media';
import {ConnectionBody, MediaBody, ModerationBody, PostBody} from "../constants";
import crypto from "crypto";

export const mapWireToEnvelope = async (tld: string, subdomain: string, wire: WireEnvelope): Promise<DomainEnvelope<DomainPost|DomainConnection|DomainModeration|DomainMedia>> => {
  const {
    timestamp,
    id,
    message,
    // signature,
    additionalData,
  } = wire;

  const refhashBuf = await createRefhash(wire, '', tld);
  const refhash = refhashBuf.toString('hex');
  const msgType = message.type.toString('utf-8');

  switch (msgType) {
    case WirePost.TYPE.toString('utf-8'):
      return new DomainEnvelope(
        0,
        tld,
        subdomain,
        id,
        refhash,
        timestamp,
        mapWirePostToDomainPost(message as WirePost),
        additionalData,
      );
    case WireConnection.TYPE.toString('utf-8'):
      return new DomainEnvelope(
        0,
        tld,
        subdomain,
        id,
        refhash,
        timestamp,
        mapWireConnectionToDomainConnection(message as WireConnection),
        additionalData,
      );
    case WireModeration.TYPE.toString('utf-8'):
      return new DomainEnvelope(
        0,
        tld,
        subdomain,
        id,
        refhash,
        timestamp,
        mapWireModerationToDomainModeration(message as WireModeration),
        additionalData,
      );
    case WireMedia.TYPE.toString('utf-8'):
      return new DomainEnvelope(
        0,
        tld,
        subdomain,
        id,
        refhash,
        timestamp,
        mapWirePostToDomainMedia(message as WireMedia),
        additionalData,
      );
    default:
      return Promise.reject(new Error(`cannot find message type ${msgType}`));
  }
};

function mapWirePostToDomainMedia(wireMedia: WireMedia): DomainMedia {
  return new DomainMedia(
    0,
    wireMedia.filename,
    wireMedia.mimeType,
    wireMedia.content,
  );
}


function mapWirePostToDomainPost(wirePost: WirePost): DomainPost {
  return new DomainPost(
    0,
    wirePost.body,
    wirePost.title,
    wirePost.reference && wirePost.reference.toString('hex'),
    wirePost.topic,
    wirePost.tags,
    0,
    0,
    0,
  );
}


function mapWireConnectionToDomainConnection(wireConnection: WireConnection): DomainConnection {
  return new DomainConnection(
    0,
    wireConnection.tld,
    wireConnection.subdomain,
    wireConnection.connectionType() as DomainConnectionType,
  );
}

function mapWireModerationToDomainModeration(wireModeration: WireModeration): DomainModeration {
  return new DomainModeration(
    0,
    wireModeration.reference.toString('hex'),
    wireModeration.moderationType() as DomainModerationType,
  );
}

export type WriterEnvelopeParams = {
  post?: PostBody;
  connection?: ConnectionBody;
  moderation?: ModerationBody;
  media?: MediaBody;
  refhash?: string;
  networkId?: string;
  createAt?: Date;
  nameIndex?: number;
}

export async function mapBodyToEnvelope(tld: string, params: WriterEnvelopeParams): Promise<WireEnvelope | undefined> {
  const {
    post,
    connection,
    moderation,
    media,
    refhash,
    networkId,
    createAt,
    nameIndex = 0,
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
        post.title || null,
        post.reference || null,
        post.topic || null,
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
        connection.subdomain || null,
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

  return envelope!.toWire(nameIndex);
}

export async function createEnvelope(tld: string, params: WriterEnvelopeParams): Promise<WireEnvelope | undefined> {
  const {
    post,
    connection,
    moderation,
    media,
    networkId,
    refhash,
    createAt,
    nameIndex = 0,
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
        post.title || null,
        post.reference || null,
        post.topic || null,
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
        connection.subdomain || null,
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

  return envelope!.toWire(nameIndex);
}

export function hashPostBody(post: PostBody, date: Date): Buffer {
  const h = blake2b(32);
  h.update(Buffer.from(post.title || '', 'utf-8'));
  h.update(Buffer.from(post.body || '', 'utf-8'));
  h.update(Buffer.from(post.reference || '', 'utf-8'));
  h.update(Buffer.from(post.topic || '', 'utf-8'));
  h.update(Buffer.from(date.toISOString(), 'utf-8'));
  post.tags.forEach(tag => {
    h.update(Buffer.from(tag, 'utf-8'));
  });
  return Buffer.from(h.digest());
}

export function hashModerationBody(mod: ModerationBody, date: Date): Buffer {
  const h = blake2b(32);
  h.update(Buffer.from(mod.type, 'utf-8'));
  h.update(Buffer.from(mod.reference || '', 'utf-8'));
  h.update(Buffer.from(date.toISOString(), 'utf-8'));
  return Buffer.from(h.digest());
}

export function hashConnectionBody(conn: ConnectionBody, date: Date): Buffer {
  const h = blake2b(32);
  h.update(Buffer.from(conn.type, 'utf-8'));
  h.update(Buffer.from(conn.tld || '', 'utf-8'));
  h.update(Buffer.from(conn.subdomain || '', 'utf-8'));
  h.update(Buffer.from(date.toISOString(), 'utf-8'));
  return Buffer.from(h.digest());
}

