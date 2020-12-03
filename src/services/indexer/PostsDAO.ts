import {Post, PostType} from 'fn-client/lib/application/Post';
import {Engine, Row} from './Engine';
import {Envelope} from 'fn-client/lib/application/Envelope';
import {Pageable} from './Pageable';
import {BlobInfo} from "fn-client/lib/fnd/BlobInfo";

export type SQLOrder = 'ASC' | 'DESC';

export interface PostsDAO {
  getPostByRefhash (refhash: string): Envelope<Post> | null

  getPostsBySubdomain (tld: string, subdomain: string, start?: number): Pageable<Envelope<Post>, number>

  getPostsByTopic (topic: string, order: SQLOrder, start?: number): Pageable<Envelope<Post>, number>

  insertPost (post: Envelope<Post>): void
}

export class PostsDAOImpl implements PostsDAO {
  public static readonly MAX_REPLY_DEPTH = 4;

  private readonly engine: Engine;

  constructor (engine: Engine) {
    this.engine = engine;
  }

  public getPostByRefhash (refhash: string): Envelope<Post> | null {
    return this.getPostByRefhashTags(refhash, true);
  }

  public getPostsBySubdomain (tld: string, subdomain: string, start: number = 0): Pageable<Envelope<Post>, number> {
    const envelopes: Envelope<Post>[] = [];
    this.engine.each(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE e.tld = @tld AND e.subdomain = @subdomain AND p.id > @start
        ORDER BY p.id DESC
        LIMIT 20
    `, {
      tld,
      subdomain,
      start,
    }, (row) => {
      envelopes.push(this.mapPost(row, true));
    });
    if (!envelopes.length) {
      return new Pageable<Envelope<Post>, number>([], -1);
    }
    return new Pageable<Envelope<Post>, number>(envelopes, envelopes[envelopes.length - 1].message.id);
  }

  public getPostsByTopic (topicBuf: string, order: SQLOrder, start: number = 0): Pageable<Envelope<Post>, number> {
    const envelopes: Envelope<Post>[] = [];
    const topic = Buffer.from(topicBuf, 'utf-8').toString('utf-8');

    this.engine.each(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE p.topic = @topic AND p.id > @start
        ORDER BY p.id DESC ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT 20
    `, {
      topic,
      start,
    }, (row) => {
      envelopes.push(this.mapPost(row, true));
    });

    if (!envelopes.length) {
      return new Pageable<Envelope<Post>, number>([], -1);
    }

    return new Pageable<Envelope<Post>, number>(envelopes, envelopes[envelopes.length - 1].message.id);
  }

  public getRecords = async (limit = 20, offset = 0): Promise<Pageable<BlobInfo[], number>> => {
    if (limit <= 0) {
      return new Pageable<any, number>([], -1);
    }

    const rows: BlobInfo[] = [];

    this.engine.each(`
      SELECT tld, public_key, import_height FROM records
      ORDER BY tld ASC
      LIMIT @limit OFFSET @offset
    `, {
      limit,
      offset,
    }, (row) => {
      rows.push({
        ...row,
        // @ts-ignore
        import_height: Number(row.import_height),
      });
    });

    if (!rows.length) {
      return new Pageable<any, number>([], -1);
    }

    return new Pageable<any, number>(
      rows,
      rows.length + Number(offset),
    );
  };

  public insertRecord (blobInfo: BlobInfo): void {
    this.engine.withTx(() => {
      const exists = this.engine.first(`
      SELECT EXISTS(SELECT 1 FROM records WHERE tld = @tld) AS result
      `, {
        tld: blobInfo.name,
      });
      if (exists?.result) {
        return;
      }

      this.engine.exec(`
          INSERT INTO records (tld, subdomain, public_key, import_height)
          VALUES (@tld, @subdomain, @public_key, @import_height)
      `, {
        tld: blobInfo.name,
        subdomain: '',
        public_key: blobInfo.publicKey,
        import_height: blobInfo.importHeight,
      });
    });
  }

  public insertPost (post: Envelope<Post>): void {
    this.engine.withTx(() => {
      const exists = this.engine.first('SELECT EXISTS(SELECT 1 FROM envelopes WHERE refhash = @refhash) AS result', {
        refhash: post.refhash,
      });
      if (exists?.result) {
        return;
      }
      const envelopeId: number = insertEnvelope(this.engine, post);
      this.engine.exec(`
          INSERT INTO posts (envelope_id, body, title, reference, topic)
          VALUES (@envelopeId, @body, @title, @reference, @topic)
      `, {
        envelopeId,
        body: post.message.body,
        title: post.message.title,
        reference: post.message.reference,
        topic: post.message.topic,
      });
      const postIdRow = this.engine.first('SELECT id FROM posts WHERE envelope_id = @envelopeId', {
        envelopeId,
      });
      const seenTags: { [k: string]: boolean } = {};
      for (const tag of post.message.tags) {
        if (seenTags[tag]) {
          continue;
        }
        seenTags[tag] = true;
        this.engine.exec(`
            INSERT INTO tags (name)
            VALUES (@tag)
            ON CONFLICT DO NOTHING
        `, {
          tag,
        });
        this.engine.exec(`
            INSERT INTO tags_posts (tag_id, post_id)
            VALUES ((SELECT id FROM tags WHERE name = @tag), @postId)
        `, {
          tag,
          postId: postIdRow!.id,
        });
      }
      this.handleReplies(post);
    });
  }

  private handleReplies (post: Envelope<Post>, depth = 0): void {
    if (depth === PostsDAOImpl.MAX_REPLY_DEPTH) {
      return;
    }
    if (!post.message.reference) {
      return;
    }
    const ref = this.getPostByRefhashTags(post.message.reference, false);
    if (!ref) {
      return;
    }
    this.engine.exec('UPDATE posts SET (reply_count) = (reply_count + 1) WHERE id = @id', {
      id: ref.message.id,
    });
    this.handleReplies(ref, depth + 1);
  }

  private getPostByRefhashTags (refhash: string, includeTags: boolean): Envelope<Post> | null {
    const row = this.engine.first(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
        FROM posts p
                 JOIN envelopes e ON p.envelope_id = e.id
        WHERE e.refhash = @refhash
    `, {
      refhash,
    });
    if (!row) {
      return null;
    }

    return this.mapPost(row, includeTags);
  }

  private mapPost (row: Row, includeTags: boolean): Envelope<Post> {
    const tags: string[] = [];
    if (includeTags) {
      this.engine.each(`
          SELECT name as tag 
          FROM tags t JOIN tags_posts tp ON t.id = tp.tag_id
          WHERE tp.post_id = @postID
        `, {
          postID: row.post_id,
        },
        (row) => {
          tags.push(row.tag);
        },
      );
    }

    let subtype: PostType = '';

    if (row.message_subtype === 'L') {
      subtype = 'LINK';
    }

    return new Envelope<Post>(
      row.envelope_id,
      row.tld,
      row.subdomain,
      row.network_id,
      row.refhash,
      new Date(row.created_at * 1000),
      new Post(
        row.post_id,
        row.body,
        row.title,
        row.reference,
        row.topic,
        tags,
        row.reply_count,
        row.like_count,
        row.pin_count,
        subtype,
      ),
      null
    );
  }
}

export function insertEnvelope (engine: Engine, envelope: Envelope<any>): number {
  const wireEnv = envelope.toWire(0);
  const type = wireEnv.message.type.toString('utf-8');
  const subtype = wireEnv.message.subtype.toString('utf-8')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "");

  engine.exec(`
      INSERT INTO envelopes (tld, subdomain, network_id, refhash, created_at, type, subtype)
      VALUES (@tld, @subdomain, @networkId, @refhash, @createdAt, @type, @subtype)
  `, {
    tld: envelope.tld,
    subdomain: envelope.subdomain,
    networkId: envelope.networkId,
    refhash: envelope.refhash,
    createdAt: envelope.createdAt.getTime() / 1000,
    type,
    subtype,
  });
  const row = engine.first('SELECT last_insert_rowid() AS id', {});
  return row!.id;
}
