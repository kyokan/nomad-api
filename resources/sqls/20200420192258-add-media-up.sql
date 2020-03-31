CREATE TABLE media (
    id          INTEGER PRIMARY KEY,
    envelope_id INTEGER NOT NULL REFERENCES envelopes(id),
    filename    VARCHAR NOT NULL,
    mime_type   VARCHAR NOT NULL,
    content     BLOB    NOT NULL
);
