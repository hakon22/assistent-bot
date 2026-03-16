import { BaseEntity, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum TelegramDialogStateEnum {
  /** Состояние ожидания */
  IDLE = 'IDLE',
  /** Ожидание загрузки резюме (PDF) */
  PROFILE_WAIT_RESUME = 'PROFILE_WAIT_RESUME',
  /** Ожидание уточнения от пользователя */
  USER_CLARIFICATION_WAITING = 'USER_CLARIFICATION_WAITING',
}

/** Текущее состояние диалога пользователя в Telegram */
@Entity({
  name: 'telegram_dialog_state',
})
export class TelegramDialogStateEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Дата создания записи */
  @CreateDateColumn({
    type: 'timestamp with time zone',
    nullable: false,
  })
  public created: Date;

  /** Дата последнего изменения записи */
  @UpdateDateColumn({
    type: 'timestamp with time zone',
    nullable: false,
  })
  public updated: Date;

  /** Telegram id пользователя (уникален — одна запись на пользователя) */
  @Column('character varying', {
    name: 'telegram_id',
    unique: true,
  })
  public telegramId: string;

  /** Текущее состояние диалога */
  @Column('enum', {
    nullable: false,
    enum: TelegramDialogStateEnum,
    enumName: 'telegram_dialog_state_enum',
    default: TelegramDialogStateEnum.IDLE,
  })
  public state: TelegramDialogStateEnum;

  /** Произвольные данные, связанные с текущим состоянием */
  @Column('jsonb', {
    nullable: true,
  })
  public data?: Record<string, any> | null;
}
