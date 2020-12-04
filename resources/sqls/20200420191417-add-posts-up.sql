CREATE TABLE posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    envelope_id INTEGER NOT NULL REFERENCES envelopes(id),
    body        TEXT    NOT NULL,
    title       VARCHAR,
    reference   VARCHAR,
    topic       VARCHAR,
    reply_count INTEGER NOT NULL DEFAULT 0,
    like_count  INTEGER NOT NULL DEFAULT 0,
    pin_count   INTEGER NOT NULL DEFAULT 0
)

CREATE INDEX posts_reference
ON posts(reference);

CREATE INDEX posts_topic
ON posts(topic);
