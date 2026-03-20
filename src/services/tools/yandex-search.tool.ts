import { Container, Singleton } from 'typescript-ioc';
import axios from 'axios';

import { SearchCacheService } from '@/services/search/search-cache.service';
import { LoggerService } from '@/services/app/logger.service';

export interface YandexSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface YandexPassage {
  '#text'?: string;
}

interface YandexDocument {
  title?: string;
  url?: string;
  headline?: string;
  passages?: {
    passage?: (string | YandexPassage)[];
  };
}

interface YandexGroup {
  document?: YandexDocument[];
}

interface YandexOperationResponse {
  done?: boolean;
  error?: unknown;
  response?: {
    result?: {
      grouping?: {
        group?: YandexGroup[];
      }[];
    };
  };
}

@Singleton
export class YandexSearchTool {
  private readonly TAG = 'YandexSearchTool';

  private readonly loggerService = Container.get(LoggerService);

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
    } catch (error) {
      this.loggerService.error(this.TAG, 'Search error', error);
      return [];
    }
  };

  private pollOperation = async (operationId: string, maxAttempts = 10): Promise<YandexSearchResult[]> => {
    const operationUrl = `https://operation.api.cloud.yandex.net/operations/${operationId}`;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(2000);

      const operationResponse = await axios.get(operationUrl, {
        headers: { Authorization: `Api-Key ${this.apiKey}` },
        timeout: 15000,
      });

      const operation: YandexOperationResponse = operationResponse.data;
      if (!operation.done) {
        continue;
      }

      if (operation.error) {
        throw new Error(`Yandex Search operation failed: ${JSON.stringify(operation.error)}`);
      }

      return this.parseResults(operation.response);
    }

    return [];
  };

  private parseResults = (response: YandexOperationResponse['response']): YandexSearchResult[] => {
    try {
      const groups = response?.result?.grouping?.[0]?.group ?? [];
      return groups.slice(0, 10).map((group) => {
        const document = group.document?.[0] ?? {};
        const passages = document.passages?.passage ?? [];
        const snippet = passages.map((passage) => (typeof passage === 'string' ? passage : passage['#text'] ?? '')).join(' ').trim();
        return {
          title: document.title ?? '',
          url: document.url ?? '',
          snippet: snippet || (document.headline ?? ''),
        };
      });
    } catch {
      return [];
    }
  };

  private sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
}
