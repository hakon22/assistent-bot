import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, BaseEntity } from 'typeorm';

export enum UserRoleEnum {
  USER = 'USER',
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
}

export enum UserStatusEnum {
  ACTIVE = 'ACTIVE',
  BANNED = 'BANNED',
  INACTIVE = 'INACTIVE',
}

/** Пользователь Telegram-бота */
@Entity({
  name: 'user',
})
export class UserEntity extends BaseEntity {
  /** Уникальный идентификатор пользователя */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Дата создания записи */
  @CreateDateColumn({
    type: 'timestamp with time zone',
  })
  public created: Date;

  /** Дата последнего изменения записи */
  @UpdateDateColumn({
    type: 'timestamp with time zone',
  })
  public updated: Date;

  /** Telegram id пользователя (обязателен, уникален) */
  @Column('bigint', {
    name: 'telegram_id',
    unique: true,
  })
  public telegramId: string;

  /** Username пользователя в Telegram */
  @Column('character varying', {
    nullable: true,
  })
  public username: string | null;

  /** Отображаемое имя пользователя */
  @Column('character varying', {
    name: 'display_name',
    nullable: true,
  })
  public displayName: string | null;

  /** Имя пользователя */
  @Column('character varying', {
    name: 'first_name',
    nullable: true,
  })
  public firstName: string | null;

  /** Фамилия пользователя */
  @Column('character varying', {
    name: 'last_name',
    nullable: true,
  })
  public lastName: string | null;

  /** Роль пользователя */
  @Column('enum', {
    enum: UserRoleEnum,
    enumName: 'user_role_enum',
    default: UserRoleEnum.USER,
  })
  public role: UserRoleEnum;

  /** Статус пользователя */
  @Column('enum', {
    enum: UserStatusEnum,
    enumName: 'user_status_enum',
    default: UserStatusEnum.ACTIVE,
  })
  public status: UserStatusEnum;

  /** Текст резюме пользователя */
  @Column('text', {
    name: 'resume_text',
    nullable: true,
  })
  public resumeText: string | null;

  /** Telegram file_id загруженного резюме */
  @Column('character varying', {
    name: 'resume_file_id',
    nullable: true,
  })
  public resumeFileId: string | null;

  /** Дополнительные произвольные данные пользователя */
  @Column('jsonb', {
    name: 'extra_data',
    default: '{}',
  })
  public extraData: Record<string, any>;

  /** ID выбранной пользователем модели (null = модель по умолчанию из env) */
  @Column('character varying', {
    name: 'model_id',
    nullable: true,
  })
  public modelId: string | null;

  /** Дата последней активности пользователя */
  @Column('timestamp with time zone', {
    name: 'last_seen_at',
    nullable: true,
  })
  public lastSeenAt: Date | null;
}
