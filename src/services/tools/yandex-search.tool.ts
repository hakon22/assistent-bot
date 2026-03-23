import { Container, Singleton } from 'typescript-ioc';
import axios from 'axios';

import { BaseService } from '@/services/app/base.service';
import { SearchCacheService } from '@/services/search/search-cache.service';

export interface YandexSearchResult {
  title: string;
  url: string;
  snippet: string;
}

@Singleton
export class YandexSearchTool extends BaseService {
  private readonly TAG = 'YandexSearchTool';

  private readonly apiKey = process.env.YANDEX_SEARCH_API_KEY ?? '';

  private readonly folderId = process.env.YANDEX_SEARCH_FOLDER_ID ?? '';

  /** Синхронный эндпоинт — отвечает сразу, без polling */
  private readonly baseUrl = 'https://searchapi.api.cloud.yandex.net/v2/web/search';

  private readonly searchCacheService = Container.get(SearchCacheService);

  public search = async (query: string, limit = 10): Promise<YandexSearchResult[]> => {
    if (!this.apiKey || !this.folderId) {
      throw new Error('Yandex Search API key or folder ID is not configured');
    }

    const cached = await this.searchCacheService.get(query);
    if (cached) {
      return (cached as YandexSearchResult[]).slice(0, limit);
    }

    try {
      this.loggerService.info(this.TAG, 'Sending search request', { query });
      const response = await axios.post(
        this.baseUrl,
        {
          query: {
            searchType: 'SEARCH_TYPE_RU',
            queryText: query,
            familyMode: 'FAMILY_MODE_NONE',
            page: 0,
          },
          sortSpec: { sortMode: 'SORT_MODE_BY_RELEVANCE' },
          groupsSpec: { attr: 'd', mode: 'deep', groupsOnPage: limit, docsInGroup: 1 },
          maxPassages: 2,
          region: '225',
          l10n: 'LOCALIZATION_RU',
          folderId: this.folderId,
        },
        {
          headers: { Authorization: `Api-Key ${this.apiKey}`, 'Content-Type': 'application/json' },
          timeout: 15000,
        },
      );

      const rawData: string | undefined = response.data?.rawData;
      if (!rawData) {
        this.loggerService.warn(this.TAG, 'No rawData in response');
        return [];
      }

      const xml = Buffer.from(rawData, 'base64').toString('utf-8');
      const results = this.parseXmlResults(xml).slice(0, limit);
      await this.searchCacheService.set(query, results);
      return results;
    } catch (error) {
      const responseData = (error as any)?.response?.data;
      this.loggerService.error(this.TAG, 'Search error', responseData ? { message: (error as any).message, responseData } : error);
      return [];
    }
  };

  /** Парсим XML ответ Яндекс Поиска через regex (без внешних зависимостей) */
  private parseXmlResults = (xml: string): YandexSearchResult[] => {
    const results: YandexSearchResult[] = [];

    const docPattern = /<doc\b[^>]*>([\s\S]*?)<\/doc>/g;
    let docMatch: RegExpExecArray | null;

    while ((docMatch = docPattern.exec(xml)) !== null) {
      const block = docMatch[1];

      const url = this.extractXmlTag(block, 'url');
      const title = this.stripXmlTags(this.extractXmlTag(block, 'title'));
      const headline = this.stripXmlTags(this.extractXmlTag(block, 'headline'));

      const passagePattern = /<passage>([\s\S]*?)<\/passage>/g;
      const passages: string[] = [];
      let passageMatch: RegExpExecArray | null;
      while ((passageMatch = passagePattern.exec(block)) !== null) {
        passages.push(this.stripXmlTags(passageMatch[1]).trim());
      }
      const snippet = passages.join(' ').trim() || headline;

      if (url && title) {
        results.push({ url, title, snippet });
      }
    }

    this.loggerService.info(this.TAG, `Search results: ${results.length}`);
    return results;
  };

  private extractXmlTag = (xml: string, tag: string): string => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
    return match?.[1] ?? '';
  };

  private stripXmlTags = (text: string): string =>
    text
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .trim();
}
