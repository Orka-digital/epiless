-- Never assume that a legacy PUBLIC snapshot passed the public-origin policy.
-- The owner can explicitly reconfirm publication after server-side validation.
ALTER TABLE publications ADD COLUMN public_origin_allowed INTEGER NOT NULL DEFAULT 0 CHECK(public_origin_allowed IN (0,1));
CREATE INDEX public_allowed_index_idx ON publications(visibility,state,public_origin_allowed,published_at DESC,id DESC);
CREATE INDEX public_allowed_origin_idx ON publications(visibility,state,public_origin_allowed,origin,published_at DESC);
