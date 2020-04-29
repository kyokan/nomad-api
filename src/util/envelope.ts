import {Envelope as WireEnvelope} from "ddrp-js/dist/social/Envelope";
import {Post as WirePost} from "ddrp-js/dist/social/Post";
import {Connection as WireConnection} from "ddrp-js/dist/social/Connection";
import {Moderation as WireModeration} from "ddrp-js/dist/social/Moderation";

import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {Connection as DomainConnection} from 'ddrp-indexer/dist/domain/Connection';
import {Moderation as DomainModeration} from 'ddrp-indexer/dist/domain/Moderation';

export const mapWireToEnvelope = async (tld: string, wire: WireEnvelope): Promise<DomainEnvelope<DomainPost|DomainConnection|DomainModeration>> => {
  const {
    nameIndex,
    // timestamp,
    guid,
    message,
    // signature,
    // additionalData,
  } = wire;

  if (nameIndex) {
    return Promise.reject(new Error('subdomain not supported'));
  }

  switch (message.type) {
    case WirePost.TYPE:
      return await DomainEnvelope.createWithMessage<DomainPost>(
        0,
        tld,
        '',
        guid,
        mapWirePostToDomainPost(message as WirePost),
      );
    case WireConnection.TYPE:
      return await DomainEnvelope.createWithMessage<DomainConnection>(
        0,
        tld,
        '',
        guid,
        mapWireConnectionToDomainConnection(message as WireConnection),
      );
    case WireModeration.TYPE:
      return await DomainEnvelope.createWithMessage<DomainModeration>(
        0,
        tld,
        '',
        guid,
        mapWireModerationToDomainModeration(message as WireModeration),
      );
    default:
      return Promise.reject(new Error('subdomain not supported'));
  }
};

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
    wireConnection.subtype.equals(WireConnection.FOLLOW_SUBTYPE)
      ? 'FOLLOW'
      : 'BLOCK'
  );
}

function mapWireModerationToDomainModeration(wireModeration: WireModeration): DomainModeration {
  return new DomainModeration(
    0,
    wireModeration.reference.toString('hex'),
    wireModeration.subtype.equals(WireModeration.LIKE_SUBTYPE)
      ? 'LIKE'
      : 'PIN',
  );
}
