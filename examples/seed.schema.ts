/**
 * Worked example 1 — the seed schema for `main`.
 *
 * Five tables: `users`, `posts`, `comments`, `tags`, `post_tags`. Between them
 * they exercise the schema types once each: single and composite primary keys,
 * unique constraints, indexes, foreign keys with `cascade` and `restrict`,
 * nullable and not-null columns, literal and function defaults, and every
 * `ColumnType` kind.
 *
 * Provisional content: ticket 0005 owns the final seed. This document's jobs are
 * to pressure-test the shapes in `engine/schema.ts` and to serve as the `base`
 * for the branched example (ticket 0002).
 *
 * IDs use the Postgres-style prefixed scheme. Suffixes here are hand-picked and
 * stable (production ids carry a random suffix); deterministic ids keep the
 * fixture diffable.
 */

import type { SchemaDocument } from "../engine/schema.js";

// --- id constants ------------------------------------------------------------
// Grouped per table so foreign-key and index references below read clearly.

const users = {
  table: "tbl_users_9f31",
  id: "col_users_id_9f31",
  email: "col_users_email_9f31",
  displayName: "col_users_display_name_9f31",
  createdAt: "col_users_created_at_9f31",
  pk: "pk_users_9f31",
  emailUnique: "uq_users_9f31",
} as const;

const posts = {
  table: "tbl_posts_4c88",
  id: "col_posts_id_4c88",
  authorId: "col_posts_author_id_4c88",
  title: "col_posts_title_4c88",
  body: "col_posts_body_4c88",
  published: "col_posts_published_4c88",
  viewCount: "col_posts_view_count_4c88",
  rating: "col_posts_rating_4c88",
  metadata: "col_posts_metadata_4c88",
  createdAt: "col_posts_created_at_4c88",
  pk: "pk_posts_4c88",
  authorFk: "fk_posts_users_4c88",
  authorIdx: "idx_posts_4c88",
} as const;

const comments = {
  table: "tbl_comments_2a5e",
  id: "col_comments_id_2a5e",
  postId: "col_comments_post_id_2a5e",
  authorId: "col_comments_author_id_2a5e",
  body: "col_comments_body_2a5e",
  flags: "col_comments_flags_2a5e",
  createdAt: "col_comments_created_at_2a5e",
  pk: "pk_comments_2a5e",
  postFk: "fk_comments_posts_2a5e",
  authorFk: "fk_comments_users_2a5e",
  postIdx: "idx_comments_2a5e",
} as const;

const tags = {
  table: "tbl_tags_b7d2",
  id: "col_tags_id_b7d2",
  name: "col_tags_name_b7d2",
  pk: "pk_tags_b7d2",
  nameUnique: "uq_tags_b7d2",
} as const;

const postTags = {
  table: "tbl_post_tags_e3a9",
  postId: "col_post_tags_post_id_e3a9",
  tagId: "col_post_tags_tag_id_e3a9",
  pk: "pk_post_tags_e3a9",
  postFk: "fk_post_tags_posts_e3a9",
  tagFk: "fk_post_tags_tags_e3a9",
} as const;

/** Object ids, exported so the branched example and the 0002 merge fixtures reference the same ids. */
export const seedIds = { users, posts, comments, tags, postTags } as const;

// --- schema document -------------------------------------------------------------

export const seedSchema: SchemaDocument = {
  database: "app",
  tables: [
    {
      id: users.table,
      name: "users",
      columns: [
        { id: users.id, name: "id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: users.email, name: "email", type: { kind: "varchar", n: 255 }, nullable: false, default: null },
        { id: users.displayName, name: "display_name", type: { kind: "text" }, nullable: false, default: null },
        { id: users.createdAt, name: "created_at", type: { kind: "timestamptz" }, nullable: false, default: "now()" },
      ],
      primaryKey: { id: users.pk, name: "users_pkey", columnIds: [users.id] },
      foreignKeys: [],
      uniques: [{ id: users.emailUnique, name: "users_email_key", columnIds: [users.email] }],
      indexes: [],
    },
    {
      id: posts.table,
      name: "posts",
      columns: [
        { id: posts.id, name: "id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: posts.authorId, name: "author_id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: posts.title, name: "title", type: { kind: "text" }, nullable: false, default: null },
        { id: posts.body, name: "body", type: { kind: "text" }, nullable: true, default: null },
        { id: posts.published, name: "published", type: { kind: "boolean" }, nullable: false, default: "false" },
        { id: posts.viewCount, name: "view_count", type: { kind: "bigint" }, nullable: false, default: "0" },
        { id: posts.rating, name: "rating", type: { kind: "numeric", precision: 3, scale: 2 }, nullable: true, default: null },
        { id: posts.metadata, name: "metadata", type: { kind: "jsonb" }, nullable: true, default: null },
        { id: posts.createdAt, name: "created_at", type: { kind: "timestamptz" }, nullable: false, default: "now()" },
      ],
      primaryKey: { id: posts.pk, name: "posts_pkey", columnIds: [posts.id] },
      foreignKeys: [
        {
          id: posts.authorFk,
          name: "posts_author_id_fkey",
          columnIds: [posts.authorId],
          refTableId: users.table,
          refColumnIds: [users.id],
          onDelete: "cascade",
        },
      ],
      uniques: [],
      indexes: [{ id: posts.authorIdx, name: "posts_author_id_idx", columnIds: [posts.authorId], unique: false }],
    },
    {
      id: comments.table,
      name: "comments",
      columns: [
        { id: comments.id, name: "id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: comments.postId, name: "post_id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: comments.authorId, name: "author_id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: comments.body, name: "body", type: { kind: "text" }, nullable: false, default: null },
        { id: comments.flags, name: "flags", type: { kind: "int" }, nullable: false, default: "0" },
        { id: comments.createdAt, name: "created_at", type: { kind: "timestamptz" }, nullable: false, default: "now()" },
      ],
      primaryKey: { id: comments.pk, name: "comments_pkey", columnIds: [comments.id] },
      foreignKeys: [
        {
          id: comments.postFk,
          name: "comments_post_id_fkey",
          columnIds: [comments.postId],
          refTableId: posts.table,
          refColumnIds: [posts.id],
          onDelete: "cascade",
        },
        {
          id: comments.authorFk,
          name: "comments_author_id_fkey",
          columnIds: [comments.authorId],
          refTableId: users.table,
          refColumnIds: [users.id],
          onDelete: "restrict",
        },
      ],
      uniques: [],
      indexes: [{ id: comments.postIdx, name: "comments_post_id_idx", columnIds: [comments.postId], unique: false }],
    },
    {
      id: tags.table,
      name: "tags",
      columns: [
        { id: tags.id, name: "id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: tags.name, name: "name", type: { kind: "varchar", n: 50 }, nullable: false, default: null },
      ],
      primaryKey: { id: tags.pk, name: "tags_pkey", columnIds: [tags.id] },
      foreignKeys: [],
      uniques: [{ id: tags.nameUnique, name: "tags_name_key", columnIds: [tags.name] }],
      indexes: [],
    },
    {
      id: postTags.table,
      name: "post_tags",
      columns: [
        { id: postTags.postId, name: "post_id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: postTags.tagId, name: "tag_id", type: { kind: "uuid" }, nullable: false, default: null },
      ],
      // Composite primary key. Column order is significant: (post_id, tag_id).
      primaryKey: { id: postTags.pk, name: "post_tags_pkey", columnIds: [postTags.postId, postTags.tagId] },
      foreignKeys: [
        {
          id: postTags.postFk,
          name: "post_tags_post_id_fkey",
          columnIds: [postTags.postId],
          refTableId: posts.table,
          refColumnIds: [posts.id],
          onDelete: "cascade",
        },
        {
          id: postTags.tagFk,
          name: "post_tags_tag_id_fkey",
          columnIds: [postTags.tagId],
          refTableId: tags.table,
          refColumnIds: [tags.id],
          onDelete: "cascade",
        },
      ],
      uniques: [],
      indexes: [],
    },
  ],
};
