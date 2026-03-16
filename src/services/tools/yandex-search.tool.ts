import { Container, Singleton } from 'typescript-ioc';
import axios from 'axios';

import { SearchCacheService } from '@/services/search/search-cache.service';

export interface YandexSearchResult {
  title: string;
  url: string;
  snippet: string;
}

@Singleton
export class YandexSearchTool {
  private readonly TAG = 'YandexSearchTool';

  private readonly apiKey = process.env.YANDEX_SEARCH_API_KEY ?? '';

  private readonly folderId = process.env.YANDEX_SEARCH_FOLDER_ID ?? '';

  private readonly baseUrl = 'https://searchapi.api.cloud.yandex.net/v2/web/searchAsync';

  private readonly searchCacheService = Container.get(SearchCacheService);

  /** Search Yandex, with 6h cache */
  public search = async (query: string, limit = 5): Promise<YandexSearchResult[]> => {
    if (!this.apiKey || !this.folderId) {
      throw new Error('Yandex Search API key or folder ID is not configured');
    }

    // Check cache
    const cached = await this.searchCacheService.get(query);
    if (cached) {
      return (cached as YandexSearchResult[]).slice(0, limit);
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          query: {
            search_type: 'SEARCH_TYPE_RU',
            query_text: query,
            familyMode: 'FAMILY_MODE_NONE',
            page: 0,
          },
          sort_spec: { sort_mode: 'SORT_MODE_BY_RELEVANCE' },
          groups_spec: { attr: '', mode: 'FLAT', groups_on_page: limit, docs_in_group: 1 },
          max_passages: 2,
          region: '225',
          l10n: 'LOCALIZATION_RU',
          folder_id: this.folderId,
        },
        {
          headers: { Authorization: `Api-Key ${this.apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      );

      const operationId = response.data?.id;
      if (!operationId) {
        return [];
      }

      const results = await this.pollOperation(operationId);
      await this.searchCacheService.set(query, results);
      return results.slice(0, limit);
    } catch (e) {
      console.error(`[${this.TAG}] Search error:`, e);
      return [];
    }
  };

  private pollOperation = async (operationId: string, maxAttempts = 10): Promise<YandexSearchResult[]> => {
    const operationUrl = `https://operation.api.cloud.yandex.net/operations/${operationId}`;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(2000);

      const opResponse = await axios.get(operationUrl, {
        headers: { Authorization: `Api-Key ${this.apiKey}` },
        timeout: 15000,
      });

      const op = opResponse.data;
      if (!op.done) {
        continue;
      }

      if (op.error) {
        throw new Error(`Yandex Search operation failed: ${JSON.stringify(op.error)}`);
      }

      return this.parseResults(op.response);
    }

    return [];
  };

  private parseResults = (response: any): YandexSearchResult[] => {
    try {
      const groups = response?.result?.grouping?.[0]?.group ?? [];
      return groups.slice(0, 10).map((group: any) => {
        const doc = group.document?.[0] ?? {};
        const passages = doc.passages?.passage ?? [];
        const snippet = passages.map((p: any) => (typeof p === 'string' ? p : p['#text'] ?? '')).join(' ').trim();
        return {
          title: doc.title ?? '',
          url: doc.url ?? '',
          snippet: snippet || (doc.headline ?? ''),
        };
      });
    } catch {
      return [];
    }
  };

  private sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
}
