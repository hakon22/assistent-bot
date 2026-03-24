import { Entity, Column, PrimaryColumn, BaseEntity } from 'typeorm';

/** Доступная LLM-модель */
@Entity({ name: 'model' })
export class ModelEntity extends BaseEntity {
  /** Идентификатор модели в API (например google/gemini-3.1-flash-lite-preview) */
  @PrimaryColumn('character varying', {
    name: 'model_id',
  })
  public modelId: string;

  /** Отображаемое имя */
  @Column('character varying')
  public name: string;

  /** Цена за 1M входящих токенов */
  @Column('character varying', {
    name: 'price_in',
  })
  public priceIn: string;

  /** Цена за 1M исходящих токенов */
  @Column('character varying', {
    name: 'price_out',
  })
  public priceOut: string;

  /** Поддерживаемые модальности (текст для отображения) */
  @Column('character varying')
  public modalities: string;

  /** Модель по умолчанию */
  @Column('boolean', {
    name: 'is_default',
    default: false,
  })
  public isDefault: boolean;

  /** Показывать ли модель пользователям */
  @Column('boolean', {
    name: 'is_active',
    default: true,
  })
  public isActive: boolean;

  /** Порядок сортировки в списке */
  @Column('integer', {
    name: 'sort_order',
    default: 0,
  })
  public sortOrder: number;

  /** Модель генерирует изображения (не текст) */
  @Column('boolean', {
    name: 'is_image_generation',
    default: false,
  })
  public isImageGeneration: boolean;
}
