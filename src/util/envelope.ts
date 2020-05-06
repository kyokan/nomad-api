import {Envelope as WireEnvelope} from "ddrp-js/dist/social/Envelope";
import {Post as WirePost} from "ddrp-js/dist/social/Post";
import {Connection as WireConnection} from "ddrp-js/dist/social/Connection";
import {Moderation as WireModeration} from "ddrp-js/dist/social/Moderation";
import {createRefhash} from "ddrp-js/dist/social/refhash";

import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {Connection as DomainConnection} from 'ddrp-indexer/dist/domain/Connection';
import {Moderation as DomainModeration} from 'ddrp-indexer/dist/domain/Moderation';

export const mapWireToEnvelope = async (tld: string, subdomain: string, wire: WireEnvelope): Promise<DomainEnvelope<DomainPost|DomainConnection|DomainModeration>> => {
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
    default:
      return Promise.reject(new Error(`cannot find message type ${msgType}`));
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
