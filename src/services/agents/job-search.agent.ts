import { Container, Singleton } from 'typescript-ioc';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

import { BaseAgentService } from '@/services/agents/base-agent.service';
import { ModelService } from '@/services/model/model.service';
import { HhApiTool, type HhVacancy } from '@/services/tools/hh-api.tool';
import { RequestEntity } from '@/db/entities/request.entity';
import { SearchHistoryEntity } from '@/db/entities/search-history.entity';
import { JobVacancyEntity } from '@/db/entities/job-vacancy.entity';
import { UserEntity } from '@/db/entities/user.entity';

// hh.ru area codes
const HH_AREAS: Record<string, number> = {
  москва: 1, moscow: 1,
  'санкт-петербург': 2, спб: 2, питер: 2, 'saint-petersburg': 2,
  екатеринбург: 3, новосибирск: 4, казань: 88, нижний: 66,
  самара: 78, ростов: 76, челябинск: 104, уфа: 99, волгоград: 24,
  краснодар: 53, воронеж: 26, пермь: 72, красноярск: 54, омск: 68,
};

export interface JobSearchAgentInput {
  telegramId: string;
  userId: number;
  requestId: number;
  messageText: string;
  resumeText?: string;
  fileText?: string;
  modelId?: string | null;
}

export interface JobSearchAgentResult {
  responseText: string;
  inlineKeyboard?: string | null;
}

@Singleton
export class JobSearchAgentService extends BaseAgentService {
  protected readonly TAG = 'JobSearchAgentService';

  protected readonly AGENT_NAME = 'job_search_agent';

  private readonly modelService = Container.get(ModelService);

  private readonly hhApiTool = Container.get(HhApiTool);

  public process = async (input: JobSearchAgentInput): Promise<JobSearchAgentResult> => {
    const { telegramId, userId, requestId, messageText, fileText, modelId } = input;

    // Если прислали файл — это новое резюме; иначе используем сохранённое
    const effectiveResume = fileText && fileText.length >= 100 ? fileText : input.resumeText;

    if (!effectiveResume || effectiveResume.trim().length < 100) {
      return {
        responseText: [
          'Для поиска вакансий мне нужно ваше резюме.',
          '',
          'Пожалуйста, прикрепите PDF-файл резюме командой /resume или прямо в этом сообщении.',
          'После загрузки резюме я найду наиболее подходящие вакансии.',
        ].join('\n'),
      };
    }

    // 1. Разбираем намерение через LLM
    const intent = await this.parseIntent(messageText, effectiveResume, modelId);

    if (intent.needsClarification) {
      return {
        responseText: 'Уточните, пожалуйста: какую должность или специальность вы ищете?',
      };
    }

    // 2. Строим URL для hh.ru
    const area = this.resolveArea(intent.location);
    const fetchedVacancies = await this.hhApiTool.searchVacancies(
      intent.hhQuery,
      area,
      50,
      intent.salaryMin ?? undefined,
      intent.experience ?? undefined,
      intent.schedule ?? undefined,
    );

    // 3. Логируем поиск
    await this.logSearch(requestId, userId, intent.hhQuery, area);

    if (!fetchedVacancies.length) {
      return {
        responseText: `По запросу «${intent.hhQuery}» вакансий за последние 7 дней не найдено. Попробуйте другой запрос.`,
      };
    }

    // 4. Фильтруем уже просмотренные вакансии
    const viewedIds = await this.loadViewedVacancyIds(userId);
    const unseenVacancies = fetchedVacancies.filter(({ id }) => !viewedIds.has(id));

    this.loggerService.info(this.TAG, 'Filtered unseen vacancies', {
      userId,
      total: fetchedVacancies.length,
      unseen: unseenVacancies.length,
      filtered: fetchedVacancies.length - unseenVacancies.length,
    });

    if (!unseenVacancies.length) {
      return {
        responseText: `По запросу «${intent.hhQuery}» все найденные вакансии вы уже просматривали. Попробуйте изменить параметры поиска.`,
      };
    }

    // 5. Скоринг через LLM
    const allScored = await this.scoreVacancies(unseenVacancies, effectiveResume, modelId);
    const scored = allScored.filter(({ matchScore }) => matchScore >= 50);

    this.loggerService.info(this.TAG, 'Filtered by match score', {
      userId,
      beforeFilter: allScored.length,
      afterFilter: scored.length,
    });

    if (!scored.length) {
      return {
        responseText: `По запросу «${intent.hhQuery}» не нашлось вакансий с достаточным совпадением по резюме (минимум 50%). Попробуйте другой запрос.`,
      };
    }

    // 6. Сохраняем в БД
    const savedVacancies = await this.saveVacancies(scored, requestId, userId);

    // 7. Помечаем первую страницу просмотренной
    await this.markVacanciesAsViewed(savedVacancies.slice(0, 5));

    // 8. Формируем ответ (первые 5, с пагинацией)
    const page0 = scored.slice(0, 5);
    const hasMore = scored.length > 5;

    const responseText = await this.formatResponse(page0, intent.hhQuery, scored.length, effectiveResume, modelId);

    // 9. Inline keyboard для пагинации
    let inlineKeyboard: string | null = null;
    if (hasMore) {
      inlineKeyboard = JSON.stringify({
        inline_keyboard: [[{
          text: 'Следующие 5 →',
          callback_data: `jobs:${requestId}:5`,
        }]],
      });
    }

    // 10. Сохраняем в историю
    await this.saveHistory(telegramId, userId, requestId, messageText, responseText);

    return { responseText, inlineKeyboard };
  };

  /** Обработчик callback — пагинация вакансий */
  public handleCallback = async (requestId: number, offset: number): Promise<JobSearchAgentResult> => {
    const vacancies = await JobVacancyEntity.find({
      where: { request: { id: requestId } },
      order: { matchScore: 'DESC' },
      take: 5,
      skip: offset,
    });

    if (!vacancies.length) {
      return { responseText: 'Больше вакансий нет.' };
    }

    await this.markVacanciesAsViewed(vacancies);

    const total = await JobVacancyEntity.count({ where: { request: { id: requestId } } });
    const page = vacancies.map((vacancy, index) => this.formatVacancyItem(offset + index + 1, {
      id: vacancy.hhVacancyId ?? '',
      name: vacancy.title,
      employer: vacancy.companyName ?? '',
      salary: this.formatSalary(vacancy.salaryFrom, vacancy.salaryTo, vacancy.salaryCurrency),
      area: vacancy.location ?? '',
      url: vacancy.url ?? '',
      snippet: vacancy.descriptionSnippet ?? '',
      publishedAt: '',
      matchScore: vacancy.matchScore ?? 0,
      matchReason: vacancy.matchReason ?? '',
    })).join('\n\n');

    const nextOffset = offset + 5;
    let inlineKeyboard: string | null = null;
    if (nextOffset < total) {
      inlineKeyboard = JSON.stringify({
        inline_keyboard: [[{ text: 'Следующие 5 →', callback_data: `jobs:${requestId}:${nextOffset}` }]],
      });
    }

    return { responseText: page, inlineKeyboard };
  };

  private parseIntent = async (messageText: string, resumeText: string, modelId?: string | null): Promise<{
    hhQuery: string;
    location: string;
    salaryMin: number | null;
    experience: string | null;
    schedule: string | null;
    needsClarification: boolean;
  }> => {
    try {
      const model = this.modelService.getChatModel(0.2, modelId);

      const systemPrompt = [
        'Ты — HR-ассистент. Составь оптимальный поисковый запрос для hh.ru на основе сообщения пользователя.',
        '',
        'ПРАВИЛА:',
        '1. Если пользователь указал конкретную должность — используй её.',
        '2. Если запрос расплывчатый — возьми должность из резюме.',
        '3. hh_query должен быть коротким и точным (1-3 слова, название должности).',
        '4. location — город на русском или "Россия" если не указан.',
        '5. experience: noExperience / between1And3 / between3And6 / moreThan6 / null.',
        '6. schedule: fullDay / shift / flexible / remote / flyInFlyOut / null.',
        '7. needs_clarification=true ТОЛЬКО если нет ни конкретики, ни резюме.',
        '',
        'Ответь ТОЛЬКО валидным JSON без лишних символов:',
        '{"hh_query":"...","location":"...","salary_min":null,"experience":null,"schedule":null,"needs_clarification":false}',
      ].join('\n');

      const userContent = `Сообщение: ${messageText}\n\nРезюме (первые 2000 символов):\n${resumeText.substring(0, 2000)}`;

      const res = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userContent)]);
      const content = typeof res.content === 'string' ? res.content.trim() : '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { hhQuery: messageText.substring(0, 50), location: 'Россия', salaryMin: null, experience: null, schedule: null, needsClarification: false };
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        hhQuery: parsed.hh_query || messageText.substring(0, 50),
        location: parsed.location || 'Россия',
        salaryMin: parsed.salary_min ?? null,
        experience: parsed.experience ?? null,
        schedule: parsed.schedule ?? null,
        needsClarification: parsed.needs_clarification ?? false,
      };
    } catch {
      return { hhQuery: messageText.substring(0, 50), location: 'Россия', salaryMin: null, experience: null, schedule: null, needsClarification: false };
    }
  };

  private resolveArea = (location: string): number => {
    const key = location.toLowerCase().trim();
    for (const [areaKey, areaCode] of Object.entries(HH_AREAS)) {
      if (key.includes(areaKey)) {
        return areaCode;
      }
    }
    return 113; // Russia
  };

  private scoreVacancies = async (vacancies: HhVacancy[], resumeText: string, modelId?: string | null): Promise<(HhVacancy & { matchScore: number; matchReason: string; })[]> => {
    try {
      const model = this.modelService.getChatModel(0.1, modelId);

      const systemPrompt = [
        'Ты — HR-эксперт. Оцени соответствие каждой вакансии резюме кандидата.',
        'Критерии: должность/уровень, технологии, опыт работы, отрасль.',
        'Верни JSON массив (все вакансии): [{"id":"...","match_score":0-100,"match_reason":"1-2 предложения"}]',
      ].join('\n');

      const vacanciesText = JSON.stringify(vacancies.map((vacancy) => ({
        id: vacancy.id, title: vacancy.name, company: vacancy.employer, snippet: vacancy.snippet,
      })));

      const res = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(`РЕЗЮМЕ:\n${resumeText.substring(0, 3000)}\n\nВАКАНСИИ:\n${vacanciesText}`),
      ]);
      const content = typeof res.content === 'string' ? res.content.trim() : '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return vacancies.slice(0, 5).map((vacancy) => ({ ...vacancy, matchScore: 50, matchReason: '' }));
      }

      const scores: { id: string; match_score: number; match_reason: string; }[] = JSON.parse(jsonMatch[0]);
      const scoreMap = new Map(scores.map((score) => [score.id, score]));

      return [...vacancies]
        .map((vacancy) => ({
          ...vacancy,
          matchScore: scoreMap.get(vacancy.id)?.match_score ?? 50,
          matchReason: scoreMap.get(vacancy.id)?.match_reason ?? '',
        }))
        .sort((vacancyA, vacancyB) => vacancyB.matchScore - vacancyA.matchScore);
    } catch {
      return vacancies.slice(0, 5).map((vacancy) => ({ ...vacancy, matchScore: 50, matchReason: '' }));
    }
  };

  private saveVacancies = async (
    vacancies: (HhVacancy & { matchScore: number; matchReason: string; })[],
    requestId: number,
    userId: number,
  ): Promise<JobVacancyEntity[]> => {
    const saved: JobVacancyEntity[] = [];
    try {
      for (const vacancy of vacancies) {
        const entity = new JobVacancyEntity();
        entity.request = { id: requestId } as RequestEntity;
        entity.user = { id: userId } as UserEntity;
        entity.hhVacancyId = vacancy.id;
        entity.title = vacancy.name.substring(0, 512);
        entity.companyName = vacancy.employer || null;
        entity.salaryCurrency = 'RUR';
        entity.location = vacancy.area || null;
        entity.url = vacancy.url || null;
        entity.descriptionSnippet = vacancy.snippet || null;
        entity.matchScore = vacancy.matchScore;
        entity.matchReason = vacancy.matchReason || null;
        entity.skills = [];

        // Parse salary
        const salaryMatch = vacancy.salary.match(/(\d+)/g);
        if (salaryMatch) {
          if (vacancy.salary.includes('–') || vacancy.salary.includes('-')) {
            entity.salaryFrom = parseInt(salaryMatch[0], 10);
            entity.salaryTo = parseInt(salaryMatch[1] ?? salaryMatch[0], 10);
          } else if (vacancy.salary.startsWith('от')) {
            entity.salaryFrom = parseInt(salaryMatch[0], 10);
          } else if (vacancy.salary.startsWith('до')) {
            entity.salaryTo = parseInt(salaryMatch[0], 10);
          }
        }

        await entity.save();
        saved.push(entity);
      }
    } catch (error) {
      this.loggerService.error(this.TAG, 'Failed to save vacancies', error);
    }
    return saved;
  };

  private loadViewedVacancyIds = async (userId: number): Promise<Set<string>> => {
    try {
      const viewed = await JobVacancyEntity.find({
        select: { hhVacancyId: true },
        where: { user: { id: userId }, isViewed: true },
      });
      return new Set(viewed.map(({ hhVacancyId }) => hhVacancyId).filter(Boolean) as string[]);
    } catch (error) {
      this.loggerService.error(this.TAG, 'Failed to load viewed vacancy ids', error);
      return new Set();
    }
  };

  private markVacanciesAsViewed = async (vacancies: JobVacancyEntity[]): Promise<void> => {
    if (!vacancies.length) return;
    try {
      for (const vacancy of vacancies) {
        vacancy.isViewed = true;
        await vacancy.save();
      }
      this.loggerService.info(this.TAG, 'Marked vacancies as viewed', { count: vacancies.length });
    } catch (error) {
      this.loggerService.error(this.TAG, 'Failed to mark vacancies as viewed', error);
    }
  };

  private logSearch = async (requestId: number, userId: number, query: string, area: number): Promise<void> => {
    try {
      const searchRecord = new SearchHistoryEntity();
      searchRecord.request = { id: requestId } as RequestEntity;
      searchRecord.user = { id: userId } as UserEntity;
      searchRecord.queryText = query;
      searchRecord.searchEngine = 'hh.ru';
      searchRecord.sourceUrl = `https://api.hh.ru/vacancies?text=${encodeURIComponent(query)}&area=${area}`;
      searchRecord.agentName = 'job_search_agent';
      await searchRecord.save();
    } catch { /* non-critical */ }
  };

  private formatResponse = async (
    vacancies: (HhVacancy & { matchScore: number; matchReason: string; })[],
    query: string,
    total: number,
    resumeText: string,
    modelId?: string | null,
  ): Promise<string> => {
    const items = vacancies.map((vacancy, index) => this.formatVacancyItem(index + 1, vacancy)).join('\n\n');

    try {
      const model = this.modelService.getChatModel(0.5, modelId);
      const res = await model.invoke([
        new SystemMessage('Напиши 1-2 предложения — вступление к списку вакансий. Русский язык. Упомяни должность и количество найденных позиций. Если есть резюме — кратко отметь соответствие. HTML теги Telegram.'),
        new HumanMessage(`Запрос: "${query}", найдено ${total} вакансий, показываю топ-5 по соответствию резюме.\n\nРезюме (первые 500 символов):\n${resumeText.substring(0, 500)}`),
      ]);
      const intro = typeof res.content === 'string' ? res.content.trim() : '';
      return `${intro}\n\n${items}`;
    } catch {
      return `🔍 <b>Вакансии по запросу: ${query}</b>\nНайдено: ${total}, показываю топ-5\n\n${items}`;
    }
  };

  private formatVacancyItem = (num: number, vacancy: HhVacancy & { matchScore?: number; matchReason?: string }): string => {
    const score = vacancy.matchScore != null ? ` · ${vacancy.matchScore}% совпадение` : '';
    const salary = vacancy.salary !== 'не указана' ? `\n💰 ${vacancy.salary}` : '';
    return [
      `${num}. <b>${vacancy.name}</b>`,
      `🏢 ${vacancy.employer}${score}`,
      `📍 ${vacancy.area}${salary}`,
      `<a href="${vacancy.url}">Открыть вакансию</a>`,
    ].join('\n');
  };

  private formatSalary = (from: number | null, to: number | null, currency: string): string => {
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
