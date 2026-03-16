import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

import { RequestEntity } from '@/db/entities/request.entity';
import { UserEntity } from '@/db/entities/user.entity';

/** Лог сессии веб-исследования агента */
@Entity({
  name: 'web_research_log',
})
export class WebResearchLogEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Запрос, инициировавший веб-исследование */
  @ManyToOne(() => RequestEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'request_id',
  })
  public request: RequestEntity | null;

  /** FK — id запроса */
  @Column('integer', {
    name: 'request_id',
    nullable: true,
  })
  public requestId: number | null;

  /** Пользователь, для которого проводилось исследование */
  @ManyToOne(() => UserEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'user_id',
  })
  public user: UserEntity | null;

  /** FK — id пользователя */
  @Column('integer', {
    name: 'user_id',
    nullable: true,
  })
  public userId: number | null;

  /** Цель исследования (что нужно найти) */
  @Column('text')
  public goal: string;

  /** Количество итераций агента */
  @Column('smallint', {
    default: 0,
  })
  public iterations: number;

  /** Количество страниц, загруженных в ходе исследования */
  @Column('smallint', {
    name: 'pages_fetched',
    default: 0,
  })
  public pagesFetched: number;

  /** Количество поисковых запросов, выполненных в ходе исследования */
  @Column('smallint', {
    name: 'searches_done',
    default: 0,
  })
  public searchesDone: number;

  /** Итоговый текст ответа, сформированный агентом */
  @Column('text', {
    name: 'response_text',
    nullable: true,
  })
  public responseText: string | null;

  /** Сырые результаты исследования в произвольном формате */
  @Column('jsonb', {
    default: '[]',
  })
  public results: any[];

  /** Название агента, проводившего исследование */
  @Column('character varying', {
    name: 'agent_name',
    default: 'tours_hotels_agent',
  })
  public agentName: string;

  /** Дата создания записи */
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
  })
  public createdAt: Date;
}
