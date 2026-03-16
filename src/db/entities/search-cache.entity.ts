import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, BaseEntity } from 'typeorm';

/** Кэш результатов поисковых запросов */
@Entity({
  name: 'search_cache',
})
export class SearchCacheEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** SHA-256 хэш поискового запроса (ключ кэша) */
  @Column('char', {
    name: 'query_hash',
    length: 64,
    unique: true,
  })
  public queryHash: string;

  /** Исходный текст поискового запроса */
  @Column('text', {
    name: 'query_text',
  })
  public queryText: string;

  /** Поисковая система, для которой закэшированы результаты */
  @Column('character varying', {
    name: 'search_engine',
    default: 'yandex',
  })
  public searchEngine: string;

  /** Закэшированные результаты поиска */
  @Column('jsonb')
  public results: any;

  /** Количество обращений к этой записи кэша */
  @Column('integer', {
    name: 'hit_count',
    default: 0,
  })
  public hitCount: number;

  /** Время истечения кэша */
  @Column('timestamp with time zone', {
    name: 'expires_at',
  })
  public expiresAt: Date;

  /** Дата создания записи */
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
  })
  public createdAt: Date;
}
