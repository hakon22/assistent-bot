import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

import { RequestEntity } from '@/db/entities/request.entity';
import { UserEntity } from '@/db/entities/user.entity';

/** Вакансия, найденная и сохранённая для пользователя */
@Entity({
  name: 'job_vacancy',
})
export class JobVacancyEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Запрос, в рамках которого найдена вакансия */
  @ManyToOne(() => RequestEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'request_id',
  })
  public request: RequestEntity | null;

  /** Пользователь, для которого найдена вакансия */
  @ManyToOne(() => UserEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'user_id',
  })
  public user: UserEntity | null;

  /** Идентификатор вакансии на hh.ru */
  @Column('character varying', {
    name: 'hh_vacancy_id',
    nullable: true,
  })
  public hhVacancyId: string | null;

  /** Название вакансии */
  @Column('character varying', {
    length: 512,
  })
  public title: string;

  /** Название компании-работодателя */
  @Column('character varying', {
    name: 'company_name',
    nullable: true,
  })
  public companyName: string | null;

  /** Минимальная зарплата */
  @Column('integer', {
    name: 'salary_from',
    nullable: true,
  })
  public salaryFrom: number | null;

  /** Максимальная зарплата */
  @Column('integer', {
    name: 'salary_to',
    nullable: true,
  })
  public salaryTo: number | null;

  /** Валюта зарплаты */
  @Column('character varying', {
    name: 'salary_currency',
    default: 'RUR',
  })
  public salaryCurrency: string;

  /** Тип занятости (полная / частичная / проектная и др.) */
  @Column('character varying', {
    name: 'employment_type',
    nullable: true,
  })
  public employmentType: string | null;

  /** Требуемый опыт работы */
  @Column('character varying', {
    nullable: true,
  })
  public experience: string | null;

  /** Местоположение (город или регион) */
  @Column('character varying', {
    nullable: true,
  })
  public location: string | null;

  /** Ссылка на вакансию */
  @Column('text', {
    nullable: true,
  })
  public url: string | null;

  /** Краткое описание вакансии */
  @Column('text', {
    name: 'description_snippet',
    nullable: true,
  })
  public descriptionSnippet: string | null;

  /** Список навыков, указанных в вакансии */
  @Column('jsonb', {
    default: '[]',
  })
  public skills: string[];

  /** Оценка соответствия вакансии профилю пользователя (0–100) */
  @Column('numeric', {
    name: 'match_score',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  public matchScore: number | null;

  /** Обоснование оценки соответствия от LLM */
  @Column('text', {
    name: 'match_reason',
    nullable: true,
  })
  public matchReason: string | null;

  /** Флаг: вакансия сохранена пользователем */
  @Column('boolean', {
    name: 'is_saved',
    default: false,
  })
  public isSaved: boolean;

  /** Дата создания записи */
  @CreateDateColumn({
    type: 'timestamp with time zone',
  })
  public created: Date;
}
