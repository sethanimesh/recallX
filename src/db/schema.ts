import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['image', 'pdf', 'video'] }).notNull(),
  uri: text('uri').notNull(),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const words = sqliteTable('words', {
  id: text('id').primaryKey(),
  word: text('word').notNull(),
  definition: text('definition').notNull(),
  example_sentence: text('example_sentence').notNull(),
  source_id: text('source_id').references(() => sources.id),
  created_at: integer('created_at', { mode: 'timestamp' }).notNull(),
  updated_at: integer('updated_at', { mode: 'timestamp' }).notNull(),
  deleted_at: integer('deleted_at', { mode: 'timestamp' }),
  srs_interval: integer('srs_interval').notNull().default(0),
  srs_ease_factor: real('srs_ease_factor').notNull().default(2.5),
  srs_next_review_at: integer('srs_next_review_at', { mode: 'timestamp' }),
  srs_wrong_count: integer('srs_wrong_count').notNull().default(0),
  srs_consecutive_correct: integer('srs_consecutive_correct').notNull().default(0),
  fc_interval: integer('fc_interval').notNull().default(0),
  fc_ease_factor: real('fc_ease_factor').notNull().default(2.5),
  fc_next_review_at: integer('fc_next_review_at', { mode: 'timestamp' }),
  fc_wrong_count: integer('fc_wrong_count').notNull().default(0),
  fc_consecutive_correct: integer('fc_consecutive_correct').notNull().default(0),
});

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const wordTags = sqliteTable('word_tags', {
  word_id: text('word_id').notNull().references(() => words.id),
  tag_id: text('tag_id').notNull().references(() => tags.id),
});
