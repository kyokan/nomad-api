CREATE TABLE posts (
    id          SERIAL PRIMARY KEY,
    envelope_id INTEGER NOT NULL REFERENCES envelopes(id),
    body        TEXT    NOT NULL,
    title       VARCHAR,
    reference   VARCHAR,
    topic       VARCHAR,
    reply_count INTEGER NOT NULL DEFAULT 0,
    like_count  INTEGER NOT NULL DEFAULT 0,
    pin_count   INTEGER NOT NULL DEFAULT 0
)
