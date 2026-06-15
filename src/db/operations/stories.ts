import { db } from '../client';
import { stories } from '../schema';
import { eq, desc, isNull } from 'drizzle-orm';
import * as Crypto from 'expo-crypto';

export type StoryRow = {
  id: string;
  tag_id: string | null;
  prompt: string | null;
  title: string;
  content: string;
  created_at: Date;
};

export async function fetchStories(tagId: string | null): Promise<StoryRow[]> {
  if (tagId) {
    return await db
      .select()
      .from(stories)
      .where(eq(stories.tag_id, tagId))
      .orderBy(desc(stories.created_at));
  } else {
    return await db
      .select()
      .from(stories)
      .where(isNull(stories.tag_id))
      .orderBy(desc(stories.created_at));
  }
}

export async function insertStory(
  tagId: string | null,
  prompt: string | null,
  title: string,
  content: string
): Promise<string> {
  const id = Crypto.randomUUID();
  await db.insert(stories).values({
    id,
    tag_id: tagId,
    prompt,
    title,
    content,
    created_at: new Date(),
  });
  return id;
}

export async function deleteStory(id: string): Promise<void> {
  await db.delete(stories).where(eq(stories.id, id));
}
