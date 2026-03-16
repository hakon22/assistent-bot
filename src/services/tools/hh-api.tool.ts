import { Singleton } from 'typescript-ioc';
import axios from 'axios';

export interface HhVacancy {
  id: string;
  name: string;
  employer: string;
  salary: string;
  area: string;
  url: string;
  snippet: string;
  published_at: string;
}

@Singleton
export class HhApiTool {
  private readonly TAG = 'HhApiTool';

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
      const dateFromStr = dateFrom.toISOString().split('T')[0];

      const params: Record<string, any> = {
        text: query,
        area,
        per_page: limit,
        page: 0,
        date_from: dateFromStr,
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

      const items = response.data?.items ?? [];
      return items.map((v: any) => ({
        id: v.id ?? '',
        name: v.name ?? '',
        employer: v.employer?.name ?? '',
        salary: this.formatSalary(v.salary),
        area: v.area?.name ?? '',
        url: v.alternate_url ?? `https://hh.ru/vacancy/${v.id}`,
        snippet: [v.snippet?.requirement ?? '', v.snippet?.responsibility ?? ''].filter(Boolean).join(' | '),
        published_at: v.published_at ?? '',
      }));
    } catch (e: any) {
      const detail = e?.response?.data ? JSON.stringify(e.response.data) : '';
      console.error(`[${this.TAG}] hh.ru API error:`, e, detail);
      return [];
    }
  };

  private formatSalary = (salary: any): string => {
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
