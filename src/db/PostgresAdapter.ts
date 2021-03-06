import {Pool, PoolClient} from 'pg';
import {Envelope as DomainEnvelope} from 'fn-client/lib/application/Envelope';
import {Post as DomainPost, PostType} from 'fn-client/lib/application/Post';
import {
  Connection as DomainConnection,
  Follow as DomainFollow,
} from 'fn-client/lib/application/Connection';
import {Moderation as DomainModeration} from 'fn-client/lib/application/Moderation';
import {Pageable} from '../services/indexer/Pageable';
import logger from "../util/logger";
import {extendFilter, Filter} from "../util/filter";
import {parseUsername} from "../util/user";
import {UserProfile} from "../constants";
import {SubdomainDBRow} from "../services/subdomains";
import {BlobInfo} from "fn-client/lib/fnd/BlobInfo";
import {getConfig} from "../util/config";
import {SELECT_POSTS} from "../util/db";
import {parseRefhash} from "fn-client/lib/wire/refhash";

export type PostgresAdapterOpts = {
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

  async insertRecord(blobInfo: BlobInfo) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows: [{exists}]} = await client.query(
        'SELECT EXISTS(SELECT 1 FROM records WHERE tld = $1)',
        [blobInfo.name]
      );

      if (!exists) {
        await client.query(`
          INSERT INTO records (tld, subdomain, public_key, import_height)
          VALUES ($1, $2, $3, $4)
        `, [
          blobInfo.name,
          '',
          blobInfo.publicKey,
          blobInfo.importHeight,
        ]);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
    } finally {
      logger.verbose('released pg client', { tld: blobInfo.name });
      client.release();
    }
  }

  async insertEnvelope(env: DomainEnvelope<any>, _client: PoolClient): Promise<number> {
    const client = _client;

    try {
      await client.query('BEGIN');
      const wireEnv = env.toWire(0);
      const sql = `
        INSERT INTO envelopes (tld, subdomain, network_id, refhash, created_at, type, subtype)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `;

      const type = wireEnv.message.type.toString('utf-8');
      const subtype = wireEnv.message.subtype.toString('utf-8')
        .replace(/[\x00-\x1F\x7F-\x9F]/g, "");

      const {
        rows: [{id: envId}]
      } = await client.query(sql, [
        env.tld,
        env.subdomain,
        env.networkId,
        env.refhash,
        env.createdAt.getTime(),
        type,
        subtype,
      ]);
      await client.query('COMMIT');
      return envId;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e
    }
  }

  async getFile(infoHash: string): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    infoHash: string;
    torrent: Buffer;
  } | null> {
    const {rows} = await this.pool.query(`
      SELECT * FROM files
      WHERE info_hash = $1
    `, [infoHash]);

    if (!rows.length) {
      return null;
    }

    return {
      buffer: rows[0].content,
      filename: rows[0].filename,
      mimeType: rows[0].mime_type,
      infoHash: rows[0].info_hash,
      torrent: rows[0].torrent,
    }
  }

  async insertFile(filename: string, mimeType: string, fileBuf: Buffer, infoHash: string, torrent: Buffer): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const {rows: [{exists}]} = await client.query(
        'SELECT EXISTS(SELECT 1 FROM files WHERE info_hash = $1)',
        [infoHash]
      );

      if (!exists) {
        const sql = `
          INSERT INTO files (filename, mime_type, content, info_hash, torrent)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
        `;
        await client.query(sql, [
          filename,
          mimeType,
          fileBuf,
          infoHash,
          torrent,
        ]);
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      logger.verbose('released pg client', { infoHash });
      client.release();
    }
  }

  async insertModeration(env: DomainEnvelope<DomainModeration>) {
    const client = await this.pool.connect();
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

  async insertConnection(env: DomainEnvelope<DomainConnection>) {
    const client = await this.pool.connect();
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

  async insertPost(env: DomainEnvelope<DomainPost>): Promise<void> {
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
          INSERT INTO posts (envelope_id, body, title, reference, topic, reply_count, like_count, pin_count, video_url, thumbnail_url)
          VALUES ($1, $2, $3, $4, $5, 0, 0, 0, $6, $7)
          RETURNING id
        `, [
          envelopeId,
          env.message.body,
          env.message.title,
          env.message.reference,
          env.message.topic,
          env.message.videoUrl || null,
          env.message.thumbnailUrl || null,
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
      }

      await client.query('COMMIT');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      logger.error('error inserting post to postgres', e);
      throw 2;
    }
  }

  private async handleReplies (env: DomainEnvelope<DomainPost>, depth = 0, _client: PoolClient): Promise<void> {
    const client = _client;
    try {
      await client.query('BEGIN');
      if (!env.message.reference) {
        return;
      }

      const ref = await this.getPostByRefhashTags(env.message.reference, false, client);

      if (!ref) {
        return;
      }

      await client.query(`
        UPDATE posts SET reply_count = reply_count + 1
        WHERE id = $1
      `, [
        ref.message.id,
      ]);

      await this.handleReplies(ref, depth + 1, client);

      await client.query('COMMIT');

    } catch (e) {
      await client.query('ROLLBACK');
      throw e
    }
  }

  async verifyUserSession (token: string): Promise<string>  {
    const client = await this.pool.connect();

    try {
      const {rows} = await client.query(`
        SELECT session_expiry, name, tld from users
        WHERE session_token = $1
      `, [token]);

      client.release();

      if (rows.length && Number(rows[0].session_expiry) > Date.now()) {
        return `${rows[0].name}.${rows[0].tld}`;
      }

      return '';
    } catch (e) {
      client.release();
      return '';
    }
  }

  async updateUserSession (token: string, expiry: number, tld: string, subdomain: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        UPDATE users SET session_token = $1 
        WHERE tld = $2 AND name = $3
      `, [token, tld, subdomain]);

      await client.query(`
        UPDATE users SET session_expiry = $1 
        WHERE tld = $2 AND name = $3
      `, [expiry, tld, subdomain]);

      await client.query('COMMIT');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      throw e
    }
  }

  async getPostByRefhashTags (refhash: string, includeTags: boolean, _client?: PoolClient): Promise<DomainEnvelope<DomainPost> | null> {
    const client = _client || await this.pool.connect();
    const { rows } = await client.query(`
      SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
          p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype,
          p.video_url, p.thumbnail_url
      FROM posts p
               JOIN envelopes e ON p.envelope_id = e.id
      WHERE e.refhash = $1
    `, [
      refhash,
    ]);

    if (!_client) client.release();

    return await this.mapPost(rows[0], includeTags, client);
  }

  async getModerationSettingByRefhash(refhash: string, _client?: PoolClient): Promise<'SETTINGS__FOLLOWS_ONLY'|'SETTINGS__NO_BLOCKS'|null> {
    const client = _client || await this.pool.connect();
    const { tld } = parseRefhash(refhash);
    const { rows } = await client.query(`
      SELECT 
        e.id as envelope_id,
        e.tld, 
        e.subdomain, 
        e.network_id, 
        e.refhash, 
        e.created_at,  
        e.type as message_type, 
        e.subtype as message_subtype,
        m.reference as reference,
        m.moderation_type as moderation_type
      FROM moderations m
      JOIN envelopes e ON m.envelope_id = e.id AND m.moderation_type IN ('SETTINGS__FOLLOWS_ONLY', 'SETTINGS__NO_BLOCKS')
      WHERE m.reference = $1 AND e.tld = $2
      ORDER BY e.created_at DESC
    `, [
      refhash,
      tld,
    ]);

    if (!_client) client.release();

    if (!rows.length) {
      return null;
    }

    const {moderation_type} = rows[0];

    if (moderation_type === 'SETTINGS__FOLLOWS_ONLY') {
      return 'SETTINGS__FOLLOWS_ONLY';
    }

    if (moderation_type === 'SETTINGS__NO_BLOCKS') {
      return 'SETTINGS__NO_BLOCKS';
    }

    return null;
  }

  // @ts-ignore
  async mapPost(row?: { [k: string]: any }, includeTags: boolean,  _client: PoolClient): Promise<DomainEnvelope<DomainPost> | null> {
    if (!row) return null;
    const client = _client;
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

    const timestamp = +row.created_at;
    const createdAt: Date = new Date(timestamp);

    let subtype: PostType = '';

    if (row.message_subtype === 'L') {
      subtype = 'LINK';
    } else if (row.message_subtype === 'VID') {
      subtype = 'VIDEO';
    }

    const originalRefhash = await this.getOriginalPosterHash(row.refhash, _client);
    const moderationType = await this.getModerationSettingByRefhash(originalRefhash, _client);

    const env = new DomainEnvelope<DomainPost>(
      row.envelope_id,
      row.tld,
      row.subdomain,
      row.network_id,
      row.refhash,
      createdAt,
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
        moderationType,
        subtype,
        row.video_url,
        row.thumbnail_url,
      ),
      null
    );

    return env;
  }

  getChannelPosts = async (order: 'ASC' | 'DESC' = 'DESC', limit= 20, defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    const client = await this.pool.connect();

    try {
      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const offset = defaultOffset || 0;

      const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE p.topic = 'channelpost'
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

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes.length + Number(offset),
      );
    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  getRecords = async (limit = 20, offset = 0): Promise<Pageable<any, number>> => {
    if (limit <= 0) {
      return new Pageable<any, number>([], -1);
    }

    const client = await this.pool.connect();
    const {rows} = await client.query(`
        SELECT tld, public_key, import_height FROM records
        ORDER BY tld ASC
        LIMIT $1 OFFSET $2
    `, [
      limit,
      offset,
    ]);

    client.release();

    if (!rows.length) {
      return new Pageable<any, number>([], -1);
    }

    return new Pageable<any, number>(
      rows.map(r => ({ ...r, import_height: Number(r.import_height)})),
      rows.length + Number(offset),
    );
  };

  getVideoPosts = async (
    order: 'ASC' | 'DESC' = 'DESC',
    limit= 20,
    defaultOffset?: number,
    extend: {follows?: string[]|null; blocks?: string[]|null} = {},
    override: {follows?: string[]|null; blocks?: string[]|null} = {},
    topic?: string,
    tld?: string,
  ): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    const client = await this.pool.connect();

    try {
      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const offset = defaultOffset || 0;

      const blocks = override.blocks === null
        ? []
        : override.blocks
          ? override.blocks
          : extend.blocks?.length
            ? extend.blocks.concat([])
            : [];

      const follows = override.follows === null
        ? []
        : override.follows
          ? override.follows
          : extend.follows?.length
            ? extend.follows.concat([])
            : [];

      let WHERE_STMT = '';
      const SELECT_BLOCK = `
            SELECT 1 FROM posts tp JOIN envelopes te ON e.id = te.id AND tp.envelope_id = te.id
            LEFT JOIN connections block ON block.tld = te.tld AND block.connection_type = 'BLOCK'
            INNER JOIN envelopes blockenv ON blockenv.id = block.envelope_id
            AND blockenv.tld IN (${blocks.map(tld => `'${tld}'`).join(', ')})
      `;
      const SELECT_FOLLOW = `
            SELECT 1 FROM posts sp JOIN envelopes se ON e.id = se.id AND sp.envelope_id = se.id 
            LEFT JOIN connections follow ON follow.tld = se.tld AND follow.connection_type = 'FOLLOW'
            INNER JOIN envelopes followenv ON followenv.id = follow.envelope_id
            AND followenv.tld IN (${follows.map(tld => `'${tld}'`).join(', ')})
      `;

      if (follows.length && blocks.length) {
        WHERE_STMT = `
          WHERE EXISTS (
            ${SELECT_FOLLOW}
          )
          AND NOT EXISTS (
            ${SELECT_BLOCK}
          )
        `;
      } else if (follows.length) {
        WHERE_STMT = `
          WHERE EXISTS (
            ${SELECT_FOLLOW}
          )
        `;
      } else if (blocks.length) {
        WHERE_STMT = `
          WHERE NOT EXISTS (
            ${SELECT_BLOCK}
          )
        `;
      } else {
        WHERE_STMT = 'WHERE true'
      }

      const values: any[] = [
        limit,
        offset,
      ];

      // if (topic) {
      //   values.push(topic);
      // }
      //
      // if (tld) {
      //   values.push(tld);
      // }

      const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, 
            e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, 
            p.pin_count, e.type as message_type, e.subtype as message_subtype,
            p.video_url, p.thumbnail_url
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        ${WHERE_STMT}
        AND (
          p.reference is NULL AND e.subtype = 'VID'
          AND (${topic ? `p.topic = '${topic}'` : `p.topic NOT LIKE '.%' OR p.topic is NULL`})
          AND (${tld ? `e.tld = '${tld}'` : `e.tld is NOT NULL`})
        )
        ORDER BY e.created_at ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT $1 OFFSET $2
      `, values);

      for (let i = 0; i < rows.length; i++) {
        const post = await this.mapPost(rows[i], true, client);
        if (post) {
          envelopes.push(post);
        }
      }

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes.length + Number(offset),
      );
    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  getTimeline = async (
    order: 'ASC' | 'DESC' = 'DESC',
    limit= 20,
    defaultOffset?: number,
    extend: {follows?: string[]|null; blocks?: string[]|null} = {},
    override: {follows?: string[]|null; blocks?: string[]|null} = {},
    topic?: string,
    tld?: string,
  ): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    const client = await this.pool.connect();

    try {
      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const offset = defaultOffset || 0;

      const blocks = override.blocks === null
        ? []
        : override.blocks
          ? override.blocks
          : extend.blocks?.length
            ? extend.blocks.concat([])
            : [];

      const follows = override.follows === null
        ? []
        : override.follows
          ? override.follows
          : extend.follows?.length
            ? extend.follows.concat([])
            : [];

      let WHERE_STMT = '';
      const SELECT_BLOCK = `
            SELECT 1 FROM posts tp JOIN envelopes te ON e.id = te.id AND tp.envelope_id = te.id
            LEFT JOIN connections block ON block.tld = te.tld AND block.connection_type = 'BLOCK'
            INNER JOIN envelopes blockenv ON blockenv.id = block.envelope_id
            AND blockenv.tld IN (${blocks.map(tld => `'${tld}'`).join(', ')})
      `;
      const SELECT_FOLLOW = `
            SELECT 1 FROM posts sp JOIN envelopes se ON e.id = se.id AND sp.envelope_id = se.id 
            LEFT JOIN connections follow ON follow.tld = se.tld AND follow.connection_type = 'FOLLOW'
            INNER JOIN envelopes followenv ON followenv.id = follow.envelope_id
            AND followenv.tld IN (${follows.map(tld => `'${tld}'`).join(', ')})
      `;

      if (follows.length && blocks.length) {
        WHERE_STMT = `
          WHERE EXISTS (
            ${SELECT_FOLLOW}
          )
          AND NOT EXISTS (
            ${SELECT_BLOCK}
          )
        `;
      } else if (follows.length) {
        WHERE_STMT = `
          WHERE EXISTS (
            ${SELECT_FOLLOW}
          )
        `;
      } else if (blocks.length) {
        WHERE_STMT = `
          WHERE NOT EXISTS (
            ${SELECT_BLOCK}
          )
        `;
      } else {
        WHERE_STMT = 'WHERE true'
      }

      const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype,
            p.video_url, p.thumbnail_url
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        ${WHERE_STMT}
        AND (
          p.reference is NULL
          AND (${topic ? `p.topic = '${topic}'` : `p.topic NOT LIKE '.%' OR p.topic is NULL`})
          AND (${tld ? `e.tld = '${tld}'` : `e.tld is NOT NULL`})
        )
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

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes.length + Number(offset),
      );
    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  getRegularPosts = async (
    order: 'ASC' | 'DESC' = 'DESC',
    limit= 20,
    defaultOffset?: number,
    extend: {follows?: string[]|null; blocks?: string[]|null} = {},
    override: {follows?: string[]|null; blocks?: string[]|null} = {},
    topic?: string,
    tld?: string,
  ): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    const client = await this.pool.connect();

    try {
      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const offset = defaultOffset || 0;

      const blocks = override.blocks === null
        ? []
        : override.blocks
          ? override.blocks
          : extend.blocks?.length
            ? extend.blocks.concat([])
            : [];

      const follows = override.follows === null
        ? []
        : override.follows
          ? override.follows
          : extend.follows?.length
            ? extend.follows.concat([])
            : [];

      let WHERE_STMT = '';
      const SELECT_BLOCK = `
            SELECT 1 FROM posts tp JOIN envelopes te ON e.id = te.id AND tp.envelope_id = te.id
            LEFT JOIN connections block ON block.tld = te.tld AND block.connection_type = 'BLOCK'
            INNER JOIN envelopes blockenv ON blockenv.id = block.envelope_id
            AND blockenv.tld IN (${blocks.map(tld => `'${tld}'`).join(', ')})
      `;
      const SELECT_FOLLOW = `
            SELECT 1 FROM posts sp JOIN envelopes se ON e.id = se.id AND sp.envelope_id = se.id 
            LEFT JOIN connections follow ON follow.tld = se.tld AND follow.connection_type = 'FOLLOW'
            INNER JOIN envelopes followenv ON followenv.id = follow.envelope_id
            AND followenv.tld IN (${follows.map(tld => `'${tld}'`).join(', ')})
      `;

      if (follows.length && blocks.length) {
        WHERE_STMT = `
          WHERE EXISTS (
            ${SELECT_FOLLOW}
          )
          AND NOT EXISTS (
            ${SELECT_BLOCK}
          )
        `;
      } else if (follows.length) {
        WHERE_STMT = `
          WHERE EXISTS (
            ${SELECT_FOLLOW}
          )
        `;
      } else if (blocks.length) {
        WHERE_STMT = `
          WHERE NOT EXISTS (
            ${SELECT_BLOCK}
          )
        `;
      } else {
        WHERE_STMT = 'WHERE true'
      }

      const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype,
            p.video_url, p.thumbnail_url
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        ${WHERE_STMT}
        AND (
          p.reference is NULL AND e.subtype != 'VID'
          AND (${topic ? `p.topic = '${topic}'` : `p.topic NOT LIKE '.%' OR p.topic is NULL`})
          AND (${tld ? `e.tld = '${tld}'` : `e.tld is NOT NULL`})
        )
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

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes.length + Number(offset),
      );
    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  getPosts = async (
    order: 'ASC' | 'DESC' = 'DESC',
    limit= 20,
    defaultOffset?: number,
    extend: {follows?: string[]|null; blocks?: string[]|null} = {},
    override: {follows?: string[]|null; blocks?: string[]|null} = {},
    topic?: string,
    tld?: string,
  ): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    const client = await this.pool.connect();

    try {
      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const offset = defaultOffset || 0;

      const blocks = override.blocks === null
        ? []
        : override.blocks
          ? override.blocks
          : extend.blocks?.length
            ? extend.blocks.concat([])
            : [];

      const follows = override.follows === null
        ? []
        : override.follows
          ? override.follows
          : extend.follows?.length
            ? extend.follows.concat([])
            : [];

      let WHERE_STMT = '';
      const SELECT_BLOCK = `
            SELECT 1 FROM posts tp JOIN envelopes te ON e.id = te.id AND tp.envelope_id = te.id
            LEFT JOIN connections block ON block.tld = te.tld AND block.connection_type = 'BLOCK'
            INNER JOIN envelopes blockenv ON blockenv.id = block.envelope_id
            AND blockenv.tld IN (${blocks.map(tld => `'${tld}'`).join(', ')})
      `;
      const SELECT_FOLLOW = `
            SELECT 1 FROM posts sp JOIN envelopes se ON e.id = se.id AND sp.envelope_id = se.id 
            LEFT JOIN connections follow ON follow.tld = se.tld AND follow.connection_type = 'FOLLOW'
            INNER JOIN envelopes followenv ON followenv.id = follow.envelope_id
            AND followenv.tld IN (${follows.map(tld => `'${tld}'`).join(', ')})
      `;

      if (follows.length && blocks.length) {
        WHERE_STMT = `
          WHERE EXISTS (
            ${SELECT_FOLLOW}
          )
          AND NOT EXISTS (
            ${SELECT_BLOCK}
          )
        `;
      } else if (follows.length) {
        WHERE_STMT = `
          WHERE EXISTS (
            ${SELECT_FOLLOW}
          )
        `;
      } else if (blocks.length) {
        WHERE_STMT = `
          WHERE NOT EXISTS (
            ${SELECT_BLOCK}
          )
        `;
      } else {
        WHERE_STMT = 'WHERE true'
      }

      const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype,
            p.video_url, p.thumbnail_url
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        ${WHERE_STMT}
        AND (
          p.reference is NULL
          AND (${topic ? `p.topic = '${topic}'` : `p.topic NOT LIKE '.%' OR p.topic is NULL`})
          AND (${tld ? `e.tld = '${tld}'` : `e.tld is NOT NULL`})
        )
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

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes.length + Number(offset),
      );
    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  getUserChannels = async (username: string, order: 'ASC' | 'DESC' = 'DESC', limit= 20, defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    const client = await this.pool.connect();
    const { tld, subdomain } = parseUsername(username);

    try {
      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const offset = defaultOffset || 0;

      const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE (p.reference is NULL AND p.topic = '.channel' AND e.tld = $3 AND e.subdomain = $4)
        ORDER BY e.created_at ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT $1 OFFSET $2
    `, [
        limit,
        offset,
        tld,
        subdomain,
      ]);

      for (let i = 0; i < rows.length; i++) {
        const post = await this.mapPost(rows[i], true, client);
        if (post) {
          envelopes.push(post);
        }
      }

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes.length + Number(offset),
      );
    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  getChannels = async (order: 'ASC' | 'DESC' = 'DESC', limit= 20, defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    const client = await this.pool.connect();

    try {
      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const offset = defaultOffset || 0;

      const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE (p.reference is NULL AND (p.topic = '.channel'))
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

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes.length + Number(offset),
      );
    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  getParentHash = async (reference: string | null, _client: PoolClient): Promise<string | null> =>  {
    if (!reference) return null;

    const client = _client;

    const {rows} = await client.query(`
        SELECT p.reference FROM posts p 
        JOIN envelopes e ON p.envelope_id = e.id AND e.refhash = $1
        AND (p.topic NOT LIKE '.%' OR p.topic is NULL)
    `, [
      reference,
    ]);

    if (!rows.length) return null;

    return rows[0].reference;
  };

  getOriginalPosterHash = async (reference: string, _client: PoolClient): Promise<string> => {
    const client = _client;
    const parent = await this.getParentHash(reference, client);
    if (!parent) return reference;
    return this.getOriginalPosterHash(parent, client);
  };

  getCommentsByHash = async (
    reference: string | null,
    order?: 'ASC' | 'DESC',
    limit = 20,
    defaultOffset?: number,
    extend: {follows?: string[]|null; blocks?: string[]|null} = {},
    override: {follows?: string[]|null; blocks?: string[]|null} = {},
  ): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0 || !reference) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }

    const client = await this.pool.connect();

    try {
      const originalRefhash = await this.getOriginalPosterHash(reference, client);
      const {tld: originalPosterTLD} = parseRefhash(originalRefhash);
      const moderationSetting = await this.getModerationSettingByRefhash(originalRefhash, client);

      const opBlocks = moderationSetting === 'SETTINGS__NO_BLOCKS'
        ? [originalPosterTLD]
        : [];
      const opFollows = moderationSetting === 'SETTINGS__FOLLOWS_ONLY'
        ? [originalPosterTLD]
        : [];


      const blocks = override.blocks === null
        ? []
        : override.blocks
          ? override.blocks
          : extend.blocks?.length
            ? extend.blocks.concat(opBlocks)
            : opBlocks;

      const follows = override.follows === null
        ? []
        : override.follows
          ? override.follows
          : extend.follows?.length
            ? extend.follows.concat(opFollows)
            : opFollows;

      let WHERE_STMT = '';
      const SELECT_FOLLOW = `
            SELECT 1 FROM posts sp JOIN envelopes se ON e.id = se.id AND sp.envelope_id = se.id 
            AND sp.reference = $3
            LEFT JOIN connections follow ON follow.tld = se.tld AND follow.connection_type = 'FOLLOW'
            INNER JOIN envelopes followenv ON followenv.id = follow.envelope_id
            AND followenv.tld IN (${follows.map(tld => `'${tld}'`).join(', ')})
      `;
      const SELECT_BLOCK = `
            SELECT 1 FROM posts tp JOIN envelopes te ON e.id = te.id AND tp.envelope_id = te.id 
            AND tp.reference = $3
            LEFT JOIN connections block ON block.tld = te.tld AND block.connection_type = 'BLOCK'
            INNER JOIN envelopes blockenv ON blockenv.id = block.envelope_id
            AND blockenv.tld IN (${blocks.map(tld => `'${tld}'`).join(', ')})
      `;

      if (follows.length && blocks.length) {
        WHERE_STMT = `
          WHERE (e.tld = $4 OR EXISTS (
            ${SELECT_FOLLOW}
          ))
          AND (e.tld = $4 OR NOT EXISTS (
            ${SELECT_BLOCK}
          ))
        `;
      } else if (follows.length) {
        WHERE_STMT = `
          WHERE (e.tld = $4 OR EXISTS (
            ${SELECT_FOLLOW}
          ))
        `;
      } else if (blocks.length) {
        WHERE_STMT = `
          WHERE (e.tld = $4 OR NOT EXISTS (
            ${SELECT_BLOCK}
          ))
        `;
      } else {
        WHERE_STMT = 'WHERE true'
      }

      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const offset = order === 'ASC' ? defaultOffset || 0 : defaultOffset || 9999999;

      const queryValues = [offset, limit, reference];

      if (follows.length || blocks.length) {
        queryValues.push(originalPosterTLD);
      }

      const {rows} = await client.query(`
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
            p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id AND p.reference = $3
        ${WHERE_STMT}
        AND (p.topic NOT LIKE '.%' OR p.topic is NULL) 
        AND p.id ${order === 'DESC' ? '<' : '>'} $1
        ORDER BY p.id ${order === 'ASC' ? 'ASC' : 'DESC'}
        LIMIT $2
    `, queryValues);

      for (let i = 0; i < rows.length; i++) {
        const post = await this.mapPost(rows[i], true, client);
        if (post) {
          envelopes.push(post);
        }
      }

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes[envelopes.length - 1].message.id,
      );
    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  scanCommentCounts = async (client: PoolClient): Promise<{[parent: string]: number}> => {
    const commentCounts: {[parent: string]: number} = {};

    try {
      const sql = `
        SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
        p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
      `;

      const {rows} = await client.query(sql);

      if (rows.length) {
        rows.forEach(row => {
          if (row.reference) {
            commentCounts[row.reference] = commentCounts[row.reference] || 0;
            commentCounts[row.reference]++;
          }
        });
      }
      return commentCounts;
    } catch (e) {
      logger.error('error scanning comments', e);
      return commentCounts;
    }
  };

  scanLikeCounts = async (client: PoolClient): Promise<{[parent: string]: number}> => {
    const likeCounts: {[parent: string]: number} = {};

    try {
      const sql = `
        SELECT * FROM moderations m
        LEFT JOIN envelopes e ON m.envelope_id = e.id
      `;

      const {rows} = await client.query(sql);

      if (rows.length) {
        rows.forEach(row => {
          if (row.reference && row.moderation_type === 'LIKE') {
            likeCounts[row.reference] = likeCounts[row.reference] || 0;
            likeCounts[row.reference]++;
          }
        });
      }
      return likeCounts;
    } catch (e) {
      logger.error('error scanning likes', e);
      return likeCounts;
    }
  };

  scanMetadata = async (): Promise<any> => {
    const client = await this.pool.connect();

    try {
      const commentCounts = await this.scanCommentCounts(client);
      const likeCounts = await this.scanLikeCounts(client);

      for (let parentHash in commentCounts) {
        const {rows} = await client.query(`
          SELECT p.envelope_id
          FROM posts p JOIN envelopes e ON p.envelope_id = e.id
          WHERE e.refhash = $1
        `, [parentHash]);

        if (rows[0]?.envelope_id) {
          await client.query(`
            UPDATE posts SET reply_count = $2
            WHERE envelope_id = $1
          `, [rows[0]?.envelope_id, commentCounts[parentHash]]);
        }
      }

      for (let refhash in likeCounts) {
        const {rows} = await client.query(`
          SELECT p.envelope_id
          FROM posts p JOIN envelopes e ON p.envelope_id = e.id
          WHERE e.refhash = $1
        `, [refhash]);

        if (rows[0]?.envelope_id) {
          await client.query(`
            UPDATE posts SET like_count = $2
            WHERE envelope_id = $1
          `, [rows[0]?.envelope_id, likeCounts[refhash]]);
        }
      }

      client.release();

      return {
        commentCounts,
        likeCounts,
      };
    } catch (e) {
      logger.error('error scanning metadata', e);
      client.release();
    }
  };

  getPostsByFilter = async (f: Filter, order: 'ASC' | 'DESC' = 'DESC', limit= 20, defaultOffset?: number): Promise<Pageable<DomainEnvelope<DomainPost>, number>> => {
    if (limit <= 0) {
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
    const client = await this.pool.connect();

    try {
      const envelopes: DomainEnvelope<DomainPost>[] = [];
      const {
        postedBy,
        repliedBy,
        likedBy,
        allowedTags,
      } = extendFilter(f);

      let postedByQueries = '';
      let repliedByQueries = '';
      let postedBySelect = '';
      let repliedBySelect = '';
      let allowedTagsJoin = '';
      let likedBySelect = '';
      let likedByQueries = '';

      const offset = order === 'ASC'
        ? defaultOffset || 0
        : defaultOffset || 999999999999999999999;

      // if (allowedTags.includes('*')) {
      //   allowedTagsJoin = `
      //     JOIN tags_posts tp ON p.id = tp.post_id AND (p.topic NOT LIKE ".%" OR p.topic is NULL)
      //   `
      // } else
      if (allowedTags.length && !allowedTags.includes('*')) {
        allowedTagsJoin = `
        JOIN (tags_posts tp JOIN tags t ON t.id = tp.tag_id)
            ON t.name IN (${allowedTags.map(t => `'${t}'`).join(',')}) AND p.id = tp.post_id AND (p.topic NOT LIKE '.%' OR p.topic is NULL)
      `
      }

      if (postedBy.length) {
        postedBySelect = `
        ${SELECT_POSTS}
        ${allowedTagsJoin}
      `;

        if (!postedBy.includes('*')) {
          postedByQueries = `(${postedBy
            .map(username => {
              const { tld, subdomain } = parseUsername(username);
              return `(e.tld = '${tld}' AND subdomain = '${subdomain}' AND p.reference is NULL AND (p.topic NOT LIKE '.%' OR p.topic is NULL))`;
            })
            .join(' OR ')} AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
        } else {
          postedByQueries = `(p.reference is NULL AND (p.topic NOT LIKE '.%' OR p.topic is NULL) AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
        }

        postedBySelect = postedBySelect + ' WHERE ' + postedByQueries
      }

      if (repliedBy.length) {
        repliedBySelect = `
        ${SELECT_POSTS}
        ${allowedTagsJoin}
      `;

        if (!repliedBy.includes('*')) {
          repliedByQueries = `(${repliedBy
            .map(username => {
              const { tld, subdomain } = parseUsername(username);
              return `(e.tld = '${tld}' AND subdomain = '${subdomain}' AND p.reference is not NULL AND (p.topic NOT LIKE '.%' OR p.topic is NULL))`;
            })
            .join(' OR ')} AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
        } else {
          repliedByQueries = `(p.reference is not NULL AND (p.topic NOT LIKE '.%' OR p.topic is NULL) AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
        }

        repliedBySelect = repliedBySelect + ' WHERE ' + repliedByQueries
      }

      if (likedBy.length) {
        likedBySelect = `
        ${SELECT_POSTS}
        ${allowedTagsJoin}
        JOIN (moderations mod JOIN envelopes env ON mod.envelope_id = env.id)
        ON mod.reference = e.refhash AND mod.moderation_type = 'LIKE'
      `;

        if (!likedBy.includes('*')) {
          likedByQueries = `(${likedBy
            .map(username => {
              const { tld, subdomain } = parseUsername(username);
              return `(env.tld = '${tld}' AND env.subdomain = '${subdomain}' AND p.reference is NULL AND (p.topic NOT LIKE '.%' OR p.topic is NULL))`;
            })
            .join(' OR ')} AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
        } else {
          likedByQueries = `(p.reference is NULL AND (p.topic NOT LIKE '.%' OR p.topic is NULL) AND p.id ${order === 'DESC' ? '<' : '>'} ${offset})`;
        }

        likedBySelect = likedBySelect + ' WHERE ' + likedByQueries
      }

      const {rows} = await client.query(`
          ${[postedBySelect, repliedBySelect, likedBySelect].filter(d => !!d).join('UNION')}
          ORDER BY p.id ${order === 'ASC' ? 'ASC' : 'DESC'}
          LIMIT $1
      `, [
        limit,
      ]);

      for (let i = 0; i < rows.length; i++) {
        const env = await this.mapPost(rows[i], true, client);
        if (env) {
          envelopes.push(env);
        }
      }

      client.release();

      if (!envelopes.length) {
        return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
      }

      return new Pageable<DomainEnvelope<DomainPost>, number>(
        envelopes,
        envelopes[envelopes.length - 1].message.id,
      );

    } catch (e) {
      logger.error('error getting filter', { f });
      client.release();
      return new Pageable<DomainEnvelope<DomainPost>, number>([], -1);
    }
  };

  getUserConnectees = async (username: string, type: 'FOLLOW' | 'BLOCK', order: 'ASC' | 'DESC' = 'ASC', limit = 20, start = 0): Promise<Pageable<DomainFollow, number>> => {
    const { tld, subdomain } = parseUsername(username);
    const client = await this.pool.connect();

    try {
      const follows: DomainFollow[] = [];

      let lastId = -1;

      const {rows} = await client.query(`
        SELECT c.id, c.tld, c.subdomain
        FROM connections c
           JOIN envelopes e ON c.envelope_id = e.id
        WHERE e.tld = $1 AND e.subdomain = $2 AND c.id > $3 AND c.connection_type = $5
        ORDER BY c.id ASC
        LIMIT $4
      `, [
        tld,
        subdomain,
        start,
        limit,
        type,
      ]);

      client.release();

      for (let i = 0; i < rows.length; i++ ) {
        const row = rows[i];
        follows.push({
          tld: row.tld,
          subdomain: row.subdomain,
        });
        lastId = row.id;
      }

      if (!follows.length) {
        return new Pageable<DomainFollow, number>([], -1);
      }

      return new Pageable<DomainFollow, number>(follows, lastId);
    } catch (e) {
      logger.error('error getting user connectees', { tld, subdomain });
      client.release();
      return new Pageable<DomainFollow, number>([], -1);
    }
  };

  getUserConnecters = async (username: string, type: 'FOLLOW' | 'BLOCK', order: 'ASC' | 'DESC' = 'ASC', limit = 20, start = 0): Promise<Pageable<DomainFollow, number>> => {
    const { tld, subdomain } = parseUsername(username);
    const client = await this.pool.connect();

    try {
      const follows: DomainFollow[] = [];

      let lastId = -1;

      const {rows} = await client.query(`
        SELECT c.id, e.tld, e.subdomain
        FROM connections c
           JOIN envelopes e ON c.envelope_id = e.id
        WHERE c.tld = $1 AND c.subdomain = $2 AND c.id > $3 AND c.connection_type = $5
        ORDER BY c.id ASC
        LIMIT $4
      `, [
        tld,
        subdomain,
        start,
        limit,
        type,
      ]);

      client.release();

      for (let i = 0; i < rows.length; i++ ) {
        const row = rows[i];
        follows.push({
          tld: row.tld,
          subdomain: row.subdomain,
        });
        lastId = row.id;
      }

      if (!follows.length) {
        return new Pageable<DomainFollow, number>([], -1);
      }

      return new Pageable<DomainFollow, number>(follows, lastId);
    } catch (e) {
      logger.error('error getting user connecters', { tld, subdomain });
      client.release();
      return new Pageable<DomainFollow, number>([], -1);
    }
  };

  getUserData = async (username: string, topic: string, client: PoolClient): Promise<string> => {
    const { tld, subdomain } = parseUsername(username);
    const {rows} = await client.query(`
        SELECT e.created_at, p.body FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE tld = $1 AND subdomain = $2 AND topic = $3 ORDER BY e.created_at DESC
      `, [
      tld,
      subdomain,
      topic,
    ]);

    return rows.length ? rows[0].body : '';
  };

  getUserConnecteesStats = async (username: string, client: PoolClient): Promise<any> => {
    const { tld, subdomain } = parseUsername(username);
    const {rows} = await client.query(`
        SELECT c.connection_type
        FROM connections c
           JOIN envelopes e ON c.envelope_id = e.id
        WHERE e.tld = $1 AND e.subdomain = $2
      `, [
      tld,
      subdomain,
    ]);

    return rows.reduce((acc, row) => {
      acc[row?.connection_type] = acc[row?.connection_type] || 0;
      acc[row?.connection_type]++;
      return acc;
    }, {});
  };

  getUserConnectersStats = async (username: string, client: PoolClient): Promise<any> => {
    const { tld, subdomain } = parseUsername(username);
    const {rows} = await client.query(`
        SELECT c.connection_type
        FROM connections c
           JOIN envelopes e ON c.envelope_id = e.id
        WHERE c.tld = $1 AND c.subdomain = $2
      `, [
      tld,
      subdomain,
    ]);

    return rows.reduce((acc, row) => {
      acc[row?.connection_type] = acc[row?.connection_type] || 0;
      acc[row?.connection_type]++;
      return acc;
    }, {});
  };

  getUserProfile = async (username: string): Promise<UserProfile> => {
    const client = await this.pool.connect();

    try {
      const displayName = await this.getUserData(username, '.display_name', client);
      const profilePicture = await this.getUserData(username, '.profile_picture_url', client);
      const coverImage = await this.getUserData(username, '.cover_image_url', client);
      const bio = await this.getUserData(username, '.user_bio', client);
      const avatarType = await this.getUserData(username, '.avatar_type', client);
      const {FOLLOW: followings, BLOCK: blockings} = await this.getUserConnecteesStats(username, client);
      const {FOLLOW: followers, BLOCK: blockers} = await this.getUserConnectersStats(username, client);

      client.release();

      return {
        profilePicture,
        coverImage,
        bio,
        avatarType,
        displayName,
        followings,
        followers,
        blockings,
        blockers,
        registered: false,
        confirmed: false,
      };

    } catch (e) {
      logger.error('error getting comments', e);
      client.release();
      return {
        profilePicture: '',
        coverImage: '',
        bio: '',
        avatarType: '',
        displayName: '',
        followings: 0,
        followers: 0,
        blockings: 0,
        blockers: 0,
        registered: false,
        confirmed: false,
      };
    }
  };

  getMediaByHash = async (refhash: string): Promise<any|undefined> => {
    const client = await this.pool.connect();

    try {
      const {rows} = await client.query(`
        SELECT e.created_at, m.filename, m.mime_type, m.content
        FROM media m JOIN envelopes e ON m.envelope_id = e.id
        WHERE e.refhash = $1
        ORDER BY e.created_at DESC
      `, [refhash]);
      client.release();
      return rows[0];
    } catch (e) {
      logger.error('error getting media', e);
      client.release();
    }
  };

  queryTrendingTags = async (limit = 20, offset = 0): Promise<Pageable<{name: string; count: number; posterCount: number}, number>> => {
    const ret: {name: string; count: number; posterCount: number}[] = [];
    const client = await this.pool.connect();

    try {
      const {rows} = await client.query(`
        SELECT t.name, COUNT(post_id) as count FROM tags_posts tp
        JOIN tags t ON t.id = tp.tag_id
        GROUP BY tag_id, t.name
        ORDER BY count DESC LIMIT $1 OFFSET $2
      `, [ limit, offset ]);

      for (let i = 0; i < rows.length; i++ ) {
        const row = rows[i];
        const postersOfTags = await this.getPostersOfTag(row.name, client);
        ret.push({
          ...row,
          posterCount: postersOfTags.length,
        });
      }

      client.release();

      if (!ret.length) {
        return {
          items: [],
          next: -1,
        };
      }

      return {
        items: ret,
        next: ret.length + Number(offset),
      };
    } catch (e) {
      logger.error('error getting trending tags', e);
      client.release();
      return {
        items: [],
        next: -1,
      };
    }
  };

  private getPostersOfTag = async (tagName: string, client: PoolClient): Promise<{tld: string; subdomain: string; count: number}[]> => {
    const sql = `
      SELECT e.tld, e.subdomain
      FROM posts p
      JOIN envelopes e ON p.envelope_id = e.id
      JOIN (tags_posts tp JOIN tags t ON t.id = tp.tag_id)
      ON t.name = $1 AND p.id = tp.post_id AND (p.topic NOT LIKE '.%' OR p.topic is NULL)
      GROUP BY e.tld, e.subdomain
    `;
    const params = [ tagName ];
    const ret: { tld: string; subdomain: string; count: number}[] = [];

    try {
      const {rows} = await client.query(sql, params);

      for (let i = 0; i < rows.length; i++) {
        ret.push(rows[i]);
      }

      return ret;
    } catch (e) {
      return ret;
    }
  };

  queryTrendingPosters = async (limit = 20, offset = 0): Promise<Pageable<{username: string; count: number}, number>> => {
    const ret: {username: string; count: number}[] = [];
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT COUNT(p.id) as count, e.tld, e.subdomain
        FROM posts p JOIN envelopes e ON p.envelope_id = e.id
        WHERE (p.reference is NULL AND (p.topic NOT LIKE '.%' OR p.topic is NULL))
        GROUP BY e.tld, e.subdomain
        ORDER BY count DESC LIMIT $1 OFFSET $2
      `, [limit, offset]);

      for (let i = 0; i < rows.length; i++) {
        ret.push(rows[i]);
      }

      client.release();

      if (!ret.length) {
        return {
          items: [],
          next: -1,
        };
      }

      return {
        items: ret,
        next: ret.length + Number(offset),
      };

    } catch (e) {
      logger.error('erorr querying trending posters', e);
      client.release();
      return {
        items: [],
        next: -1,
      };
    }
  };

  async getSubdomainByTLD(tld: string): Promise<SubdomainDBRow[]> {
    const client = await this.pool.connect();
    const ret: SubdomainDBRow[] = [];
    try {
      const {rows} = await client.query(`
        SELECT * FROM users
        WHERE tld = $1
        ORDER BY name
      `, [
        tld,
      ]);

      for (let i = 0; i < rows.length; i++) {
        ret.push(rows[i]);
      }

      client.release();

      return rows.reverse();
    } catch (e) {
      logger.error('erorr getting subdomains', e);
      client.release();
      return [];
    }
  }

  async addSubdomain(tld: string, subdomain: string, email: string, publicKey: string | null, password: string): Promise<void> {
    const client = await this.pool.connect();

    try {
      const config = await getConfig();
      const tldData = config.signers[tld];

      if (!tldData || !tldData.privateKey) throw new Error(`cannot find singer for ${tld}`);

      const {rows: [{exists}]} = await client.query(
        'SELECT EXISTS(SELECT 1 FROM users WHERE tld = $1 AND name = $2)',
        [tld, subdomain]
      );

      if (exists) {
        throw new Error(`${subdomain}.${tld} already exists`);
      }

      await client.query(`
        INSERT INTO users (name, public_key, tld, email, password)
        VALUES ($2, $3, $1, $4, $5)
        ON CONFLICT DO NOTHING
      `, [
        tld,
        subdomain,
        publicKey || '',
        email,
        password,
      ]);

      client.release();
    } catch (e) {
      logger.error('erorr adding subdomains', e);
      client.release();
      throw e;
    }
  }

  async getSubdomain(tld: string, subdomain: string): Promise<SubdomainDBRow | null> {
    const client = await this.pool.connect();
    let sub: SubdomainDBRow | null = null;

    try {
      const {rows} = await client.query(`
        SELECT * FROM users
        WHERE tld = $1 AND name = $2
      `, [ tld, subdomain ]);

      sub = rows[0] || null;

      client.release();
      return sub;
    } catch (e) {
      logger.error('erorr getting subdomain', e);
      client.release();
      return sub;
    }
  }

  async getSubdomainPassword(tld: string, subdomain: string): Promise<string> {
    const client = await this.pool.connect();

    try {
      const {rows} = await client.query(`
        SELECT password FROM users
        WHERE tld = $1 AND name = $2
      `, [ tld, subdomain ]);

      client.release();
      return rows[0]?.password || '';
    } catch (e) {
      logger.error('erorr getting subdomain', e);
      client.release();
      return '';
    }
  }

  private async getUserConnections (username: string, client: PoolClient): Promise<DomainEnvelope<DomainConnection>[]> {
    const { tld, subdomain } = parseUsername(username);

    const envelopes: DomainEnvelope<DomainConnection>[] = [];

    if (subdomain) return envelopes;

    const {rows} = await client.query(`
      SELECT e.id as envelope_id, c.id as connection_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at,
        c.tld as connection_tld, c.subdomain as connection_subdomain, c.connection_type
      FROM connections c JOIN envelopes e ON c.envelope_id = e.id
      WHERE e.tld = $1
    `, [ tld ]);

    if (rows.length) {
      rows.forEach((row: any) => {
        const timestamp = +row.created_at;
        const createdAt: Date = new Date(timestamp);

        envelopes.push(new DomainEnvelope<DomainConnection>(
          row.envelope_id,
          row.tld,
          row.subdomain,
          row.network_id,
          row.refhash,
          createdAt,
          new DomainConnection(
            row.connection_id,
            row.connection_tld,
            row.connection_subdomain,
            row.connection_type,
          ),
          null
        ));
      });
    }

    return envelopes;
  }

  private async getUserModerations (username: string, client: PoolClient): Promise<DomainEnvelope<DomainModeration>[]> {
    const { tld, subdomain } = parseUsername(username);

    const envelopes: DomainEnvelope<DomainModeration>[] = [];

    if (subdomain) return envelopes;

    const {rows} = await client.query(`
      SELECT e.id as envelope_id, m.id as moderation_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at,
        m.reference, m.moderation_type
      FROM moderations m JOIN envelopes e ON m.envelope_id = e.id
      WHERE e.tld = $1
    `, [ tld ]);

    if (rows.length) {
      rows.forEach((row: any) => {
        const timestamp = +row.created_at;
        const createdAt: Date = new Date(timestamp);

        envelopes.push(new DomainEnvelope<DomainModeration>(
          row.envelope_id,
          row.tld,
          row.subdomain,
          row.network_id,
          row.refhash,
          createdAt,
          new DomainModeration(
            row.moderation_id,
            row.reference,
            row.moderation_type,
          ),
          null
        ));
      });
    }

    return envelopes;
  }

  private async getUserPosts (username: string, client: PoolClient): Promise<DomainEnvelope<DomainPost>[]> {
    const { tld, subdomain } = parseUsername(username);

    const envelopes: DomainEnvelope<DomainPost>[] = [];

    if (subdomain) return envelopes;

    const {rows} = await client.query(`
      SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
              p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype
      FROM posts p JOIN envelopes e ON p.envelope_id = e.id AND e.subtype != 'VID'
      WHERE e.tld = $1
    `, [ tld ]);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const post = await this.mapPost(row, true, client);
      if (post){
        envelopes.push(post);
      }
    }

    return envelopes;
  }

  async getUserEnvelopes (username: string): Promise<DomainEnvelope<any>[]> {
    const client = await this.pool.connect();

    try {
      const posts = await this.getUserPosts(username, client);
      const mods = await this.getUserModerations(username, client);
      const conns = await this.getUserConnections(username, client);

      client.release();

      const envelopes: DomainEnvelope<any>[] = [
        ...mods,
        ...conns,
        ...posts,
      ].sort((a, b) => {
        if (a.createdAt > b.createdAt) return 1;
        if (a.createdAt < b.createdAt) return -1;
        return 0;
      });

      return envelopes;
    } catch (e) {
      client.release();
      throw e;
    }


  }
}
