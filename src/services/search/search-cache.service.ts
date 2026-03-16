import { Singleton } from 'typescript-ioc';
import { createHash } from 'crypto';
import { LessThan } from 'typeorm';

import { SearchCacheEntity } from '@/db/entities/search-cache.entity';

const TTL_HOURS = 6;

@Singleton
export class SearchCacheService {
  private hashQuery = (query: string): string =>
    createHash('sha256').update(query.toLowerCase().trim()).digest('hex');

  /** Get cached results or null if miss/expired */
  public get = async (query: string, engine = 'yandex'): Promise<any | null> => {
    const hash = this.hashQuery(query);
    const cached = await SearchCacheEntity.findOne({ where: { queryHash: hash, searchEngine: engine } });

    if (!cached) {
      return null;
    }

    if (cached.expiresAt < new Date()) {
      await cached.remove();
      return null;
    }

    cached.hitCount += 1;
    await cached.save();
    return cached.results;
  };

  /** Store results in cache */
  public set = async (query: string, results: any, engine = 'yandex'): Promise<void> => {
    const hash = this.hashQuery(query);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + TTL_HOURS);

    let cached = await SearchCacheEntity.findOne({ where: { queryHash: hash } });
    if (!cached) {
      cached = new SearchCacheEntity();
      cached.queryHash = hash;
      cached.queryText = query;
      cached.searchEngine = engine;
      cached.hitCount = 0;
    }

    cached.results = results;
    cached.expiresAt = expiresAt;
    await cached.save();
  };

  /** Purge all expired entries */
  public purgeExpired = async (): Promise<void> => {
    await SearchCacheEntity.delete({ expiresAt: LessThan(new Date()) });
  };
}
