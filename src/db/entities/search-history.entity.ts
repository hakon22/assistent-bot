import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

import { RequestEntity } from '@/db/entities/request.entity';
import { UserEntity } from '@/db/entities/user.entity';

/** Одиночный поисковый запрос агента с результатом */
@Entity({
  name: 'search_history',
})
export class SearchHistoryEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Запрос пользователя, в рамках которого выполнен поиск */
  @ManyToOne(() => RequestEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'request_id',
  })
  public request: RequestEntity | null;

  /** Пользователь, для которого выполнялся поиск */
  @ManyToOne(() => UserEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'user_id',
  })
  public user: UserEntity | null;

  /** Текст поискового запроса */
  @Column('text', {
    name: 'query_text',
  })
  public queryText: string;

  /** Поисковая система, которая использовалась */
  @Column('character varying', {
    name: 'search_engine',
    default: 'yandex',
  })
  public searchEngine: string;

  /** URL источника, из которого получен результат */
  @Column('text', {
    name: 'source_url',
    nullable: true,
  })
  public sourceUrl: string | null;

  /** Краткий сниппет результата поиска */
  @Column('text', {
    name: 'result_snippet',
    nullable: true,
  })
  public resultSnippet: string | null;

  /** Полное содержимое загруженной страницы */
  @Column('text', {
    name: 'page_content',
    nullable: true,
  })
  public pageContent: string | null;

  /** Название агента, выполнившего поиск */
  @Column('character varying', {
    name: 'agent_name',
    nullable: true,
  })
  public agentName: string | null;

  /** Дата создания записи */
  @CreateDateColumn({
    type: 'timestamp with time zone',
  })
  public created: Date;
}
