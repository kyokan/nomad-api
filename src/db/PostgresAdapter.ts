import {Pool, Client, PoolClient} from 'pg';
import {Envelope as DomainEnvelope} from 'ddrp-indexer/dist/domain/Envelope';
import {Post as DomainPost} from 'ddrp-indexer/dist/domain/Post';
import {
  Connection as DomainConnection,
  Follow as DomainFollow,
  Block as DomainBlock,
} from 'ddrp-indexer/dist/domain/Connection';
import {Moderation as DomainModeration} from 'ddrp-indexer/dist/domain/Moderation';
import {Media as DomainMedia} from 'ddrp-indexer/dist/domain/Media';
import {Pageable} from 'ddrp-indexer/dist/dao/Pageable';
import logger from "../util/logger";

type PostgresAdapterOpts = {
  user: string;
  password?: string;
  host: string;
  database: string;
  port: number;
}

export default class PostgresAdapter {
  pool: Pool;

  constructor(opts: PostgresAdapterOpts) {
    const pool = new Pool(opts);
    pool.on("error", (err, client) => {
      logger.error(err);
    });
    this.pool = pool;
  }

  async insertEnvelope(env: DomainEnvelope<any>, _client?: PoolClient): Promise<number> {
    const client = _client || await this.pool.connect();

    try {
      await client.query('BEGIN');
      const sql = `
        INSERT INTO envelopes (tld, subdomain, network_id, refhash, created_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `;
      const {
        rows: [{id: envId}]
      } = await client.query(sql, [
        env.tld,
        env.subdomain,
        env.networkId,
        env.refhash,
        env.createdAt.toISOString(),
      ]);
      await client.query('COMMIT');
      return envId;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e
    } finally {
      // if (!_client) {
      //   client.release();
      // }
    }
  }

  async insertModeration(env: DomainEnvelope<DomainModeration>, _client?: PoolClient) {
    const client = _client || await this.pool.connect();
    try {
      await client.query('BEGIN');

      const {rows: [{exists}]} = await client.query(
        'SELECT EXISTS(SELECT 1 FROM envelopes WHERE refhash = $1)',
        [env.refhash]
      );

      if (!exists) {
        const envelopeId: number = await this.insertEnvelope(env, client);
        await client.query(`
          INSERT INTO moderations (envelope_id, reference, moderation_type)
          VALUES ($1, $2, $3)
        `, [
          envelopeId,
          env.message.reference,
          env.message.type,
        ]);

        const {rows} = await client.query(`
          SELECT p.id FROM posts p JOIN  envelopes e ON p.envelope_id = e.id WHERE e.refhash = $1
        `, [
          env.message.reference,
        ]);

        if (rows.length) {
          await client.query(
            env.message.type === 'LIKE'
              ? `
                UPDATE posts
                SET like_count = like_count + 1
                WHERE id = $1
              `
              : `
                UPDATE posts
                SET pin_count = pin_count + 1
                WHERE id = $1
              `,
            [
                rows[0].id
              ]
          );
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      logger.verbose('released pg client', { tld: env.tld });
      client.release();
    }
  }

  async insertMedia(env: DomainEnvelope<DomainMedia>, _client?: PoolClient) {
    const client = _client || await this.pool.connect();
    try {
      await client.query('BEGIN');

      const {rows: [{exists}]} = await client.query(
        'SELECT EXISTS(SELECT 1 FROM envelopes WHERE refhash = $1)',
        [env.refhash]
      );

      if (!exists) {
        const envelopeId: number = await this.insertEnvelope(env, client);
        await client.query(`
          INSERT INTO media (envelope_id, filename, mime_type, content)
          VALUES ($1, $2, $3, $4)
        `, [
          envelopeId,
          env.message.filename,
          env.message.mimeType,
          env.message.content,
        ]);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      logger.verbose('released pg client', { tld: env.tld });
      client.release();
    }
  }

  async insertConnection(env: DomainEnvelope<DomainConnection>, _client?: PoolClient) {
    const client = _client || await this.pool.connect();
    try {
      await client.query('BEGIN');

      const {rows: [{exists}]} = await client.query(
        'SELECT EXISTS(SELECT 1 FROM envelopes WHERE refhash = $1)',
        [env.refhash]
      );

      if (!exists) {
        const envelopeId: number = await this.insertEnvelope(env, client);
        await client.query(`
          INSERT INTO connections (envelope_id, tld, subdomain, connection_type)
          VALUES ($1, $2, $3, $4)
        `, [
          envelopeId,
          env.message.tld,
          env.message.subdomain,
          env.message.type,
        ]);

      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      logger.verbose('released pg client', { tld: env.tld });
      client.release();
    }
  }

  async insertPost(env: DomainEnvelope<DomainPost>, _client?: PoolClient): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const {rows: [{exists}]} = await client.query(
        'SELECT EXISTS(SELECT 1 FROM envelopes WHERE refhash = $1)',
        [env.refhash]
      );

      if (!exists) {
        const envelopeId: number = await this.insertEnvelope(env, client);
        const {
          rows: [{id: postId}]
        } = await client.query(`
          INSERT INTO posts (envelope_id, body, title, reference, topic, reply_count, like_count, pin_count)
          VALUES ($1, $2, $3, $4, $5, 0, 0, 0)
          RETURNING id
    `, [
          envelopeId,
          env.message.body,
          env.message.title,
          env.message.reference,
          env.message.topic,
        ]);
        const seenTags: { [k: string]: boolean } = {};
        for (const tag of env.message.tags) {
          if (seenTags[tag]) {
            continue;
          }
          seenTags[tag] = true;

          await client.query(`
          INSERT INTO tags (name)
          VALUES ($1)
          ON CONFLICT DO NOTHING
          RETURNING id
        `, [
            tag,
          ]);

          const { rows } = await client.query('SELECT id FROM tags WHERE name = $1', [tag]);

          if (rows.length) {
            await client.query(`
              INSERT INTO tags_posts (tag_id, post_id)
              VALUES ($1, $2)
            `, [
              rows[0].id,
              postId,
            ]);
          }

          await this.handleReplies(env, 0, client);
        }

      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      logger.error('error inserting post to postgres', e);
    } finally {
      logger.verbose('released pg client', { tld: env.tld });
      client.release();
    }
  }

  private async handleReplies (env: DomainEnvelope<DomainPost>, depth = 0, _client?: PoolClient): Promise<void> {
    const client = _client || await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (!env.message.reference) {
        return;
      }
      const ref = await this.getPostByRefhashTags(env.message.reference, false, client);

      if (!ref) {
        return;
      }

      await client.query('UPDATE posts SET reply_count = reply_count + 1 WHERE id = $1', [
        env.message.id,
      ]);

      await this.handleReplies(ref, depth + 1, client);

      await client.query('COMMIT');

    } catch (e) {
      await client.query('ROLLBACK');
      throw e
    } finally {

    }
  }

  async getPostByRefhashTags (refhash: string, includeTags: boolean, _client?: PoolClient): Promise<DomainEnvelope<DomainPost> | null> {
    const client = _client || await this.pool.connect();
    const { rows } = await client.query(`
      SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
          p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count
      FROM posts p
               JOIN envelopes e ON p.envelope_id = e.id
      WHERE e.refhash = $1
    `, [
      refhash,
    ]);
    return await this.mapPost(rows[0], includeTags, client);
  }

  // @ts-ignore
  async mapPost(row?: { [k: string]: any }, includeTags: boolean,  _client?: PoolClient): Promise<DomainEnvelope<DomainPost> | null> {
    if (!row) return null;
    const client = _client || await this.pool.connect();
    const tags: string[] = [];

    if (includeTags) {
      const res = await client.query(`
        SELECT name as tag 
        FROM tags t JOIN tags_posts tp ON t.id = tp.tag_id
        WHERE tp.post_id = $1
      `, [
        row.post_id
      ]);
      res.rows.forEach(({ tag }) => tags.push(tag));
    }

    const env = new DomainEnvelope<DomainPost>(
      row.envelope_id,
      row.tld,
      row.subdomain,
      row.network_id,
      row.refhash,
      row.created_at,
      new DomainPost(
        row.post_id,
        row.body,
        row.title,
        row.reference,
        row.topic,
        tags,
        row.reply_count,
        row.like_count,
        row.pin_count,
      ),
      null
    );

    return env;
  }

  async test(env: DomainEnvelope<DomainPost>, _client?: PoolClient) {
    const client = _client || await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e
    } finally {
      if (!_client) {
        client.release();
      }
    }
  }

  getPosts = async (order: 'ASC' | 'DESC' = 'DESC', limit= 20, defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    const client = await this.pool.connect();
    const envelopes: DomainEnvelope<DomainPost>[] = [];
    const offset = defaultOffset || 0;

    const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE (p.reference is NULL AND (p.topic NOT LIKE '.%' OR p.topic is NULL))
        ORDER BY e.created_at ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT $1 OFFSET $2
    `, [
      limit,
      offset,
    ]);

    for (let i = 0; i < rows.length; i++) {
      const post = await this.mapPost(rows[i], true, client);
      if (post) {
        envelopes.push(post);
      }
    }

    if (!envelopes.length) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    return new Pageable<DomainEnvelope<DomainPost>, number>(
      envelopes,
      envelopes.length + Number(offset),
    );
  }
}
