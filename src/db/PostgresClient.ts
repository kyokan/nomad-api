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

type PostgresClientOpts = {
  user: string;
  password?: string;
  host: string;
  database: string;
  port: number;
}

export default class PostgresClient {
  pool: Pool;

  constructor(opts: PostgresClientOpts) {
    this.pool = new Pool(opts);
  }

  async insertEnvelope(env: DomainEnvelope<DomainPost>, _client?: PoolClient): Promise<number> {
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
        env.createdAt,
      ]);
      await client.query('COMMIT');
      return envId;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e
    } finally {
      if (!_client) {
        client.release();
      }
    }
  }

  async insertPost(env: DomainEnvelope<DomainPost>, _client?: PoolClient) {
    const client = _client || await this.pool.connect();

    try {
      await client.query('BEGIN');
      const {
        rows: [{exists}],
      } = await client.query(
        'SELECT EXISTS(SELECT 1 FROM envelopes WHERE refhash = $1)',
        [env.refhash]
      );

      if (exists) {
        throw new Error(`${env.refhash} already exist`);
      }
      const envelopeId: number = await this.insertEnvelope(env, client);
      const {
        rows: [{id: postId}]
      } = await client.query(`
          INSERT INTO posts (envelope_id, body, title, reference, topic)
          VALUES ($1, $2, $3, $4, $5)
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
      }

      await this.handleReplies(env, 0, client);
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

  private async handleReplies (env: DomainEnvelope<DomainPost>, depth = 0, _client?: PoolClient): Promise<void> {
    const client = _client || await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (!env.message.reference) {
        return;
      }
      const ref = await this.getPostByRefhashTags(env.message.reference, false);

      if (!ref) {
        return;
      }
      console.log(env.message.id);
      await client.query('UPDATE posts SET (reply_count) = (reply_count + 1) WHERE id = $1', [
        env.message.id,
      ]);

      await this.handleReplies(ref, depth + 1, client);

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

  private async getPostByRefhashTags (refhash: string, includeTags: boolean, _client?: PoolClient): Promise<DomainEnvelope<DomainPost> | null> {
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
    console.log(rows);
    return await this.mapPost(rows[0], includeTags, client);
  }

  async mapPost(row: { [k: string]: any }, includeTags: boolean,  _client?: PoolClient): Promise<DomainEnvelope<DomainPost> | null> {
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
      console.log(res);
    }

    const env = new DomainEnvelope<DomainPost>(
      row.envelope_id,
      row.tld,
      row.subdomain,
      row.network_id,
      row.refhash,
      new Date(row.created_at * 1000),
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
}
