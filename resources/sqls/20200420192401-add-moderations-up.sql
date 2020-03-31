CREATE TABLE moderations (
    id              SERIAL PRIMARY KEY,
    envelope_id     INTEGER NOT NULL REFERENCES envelopes(id),
    reference       VARCHAR NOT NULL,
    moderation_type VARCHAR NOT NULL
);
