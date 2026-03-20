import { Container, Singleton } from 'typescript-ioc';
import axios from 'axios';

import { LoggerService } from '@/services/app/logger.service';

export interface HhVacancy {
  id: string;
  name: string;
  employer: string;
  salary: string;
  area: string;
  url: string;
  snippet: string;
  publishedAt: string;
}

interface HhSalaryApiResponse {
  from: number | null;
  to: number | null;
  currency: string;
}

interface HhVacancyApiResponse {
  id: string;
  name: string;
  employer: { name: string; } | null;
  salary: HhSalaryApiResponse | null;
  area: { name: string; } | null;
  alternate_url: string | null;
  snippet: {
    requirement: string | null;
    responsibility: string | null;
  } | null;
  published_at: string | null;
}

interface HhSearchParams {
  text: string;
  area: number;
  per_page: number;
  page: number;
  date_from: string;
  order_by: string;
  salary?: number;
  experience?: string;
  schedule?: string;
}

@Singleton
export class HhApiTool {
  private readonly TAG = 'HhApiTool';

  private readonly loggerService = Container.get(LoggerService);

  private readonly baseUrl = 'https://api.hh.ru';

  private readonly defaultHeaders = {
    'User-Agent': 'AssistentBot/1.0 (hakonxak@gmail.com)',
    'Accept': 'application/json',
  };

  public searchVacancies = async (
    query: string,
    area = 113,
    limit = 20,
    salaryMin?: number,
    experience?: string | null,
    schedule?: string | null,
  ): Promise<HhVacancy[]> => {
    try {
      // Ищем вакансии за последние 7 дней
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 7);
      const dateFromString = dateFrom.toISOString().split('T')[0];

      const params: HhSearchParams = {
        text: query,
        area,
        per_page: limit,
        page: 0,
        date_from: dateFromString,
        order_by: 'publication_time', // 'relevance' конфликтует с date_from → 400
      };

      if (salaryMin) {
        params.salary = salaryMin;
      }
      if (experience) {
        params.experience = experience;
      }
      if (schedule) {
        params.schedule = schedule;
      }

      const response = await axios.get(`${this.baseUrl}/vacancies`, {
        headers: this.defaultHeaders,
        params,
        timeout: 15000,
      });

      const items: HhVacancyApiResponse[] = response.data?.items ?? [];
      return items.map((vacancyData) => ({
        id: vacancyData.id ?? '',
        name: vacancyData.name ?? '',
        employer: vacancyData.employer?.name ?? '',
        salary: this.formatSalary(vacancyData.salary),
        area: vacancyData.area?.name ?? '',
        url: vacancyData.alternate_url ?? `https://hh.ru/vacancy/${vacancyData.id}`,
        snippet: [vacancyData.snippet?.requirement ?? '', vacancyData.snippet?.responsibility ?? ''].filter(Boolean).join(' | '),
        publishedAt: vacancyData.published_at ?? '',
      }));
    } catch (error) {
      const detail = (error as any)?.response?.data ? JSON.stringify((error as any).response.data) : '';
      this.loggerService.error(this.TAG, `hh.ru API error: ${detail}`, error);
      return [];
    }
  };

  private formatSalary = (salary: HhSalaryApiResponse | null): string => {
    if (!salary) {
      return 'не указана';
    }
    const { from, to, currency } = salary;
    if (from && to) {
      return `${from}–${to} ${currency}`;
    }
    if (from) {
      return `от ${from} ${currency}`;
    }
    if (to) {
      return `до ${to} ${currency}`;
    }
    return 'не указана';
  };
}
