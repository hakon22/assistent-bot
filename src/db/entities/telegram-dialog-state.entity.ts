import { BaseEntity, Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { UserEntity } from '@/db/entities/user.entity';

export enum TelegramDialogStateEnum {
  /** Состояние ожидания */
  IDLE = 'IDLE',
  /** Ожидание загрузки резюме (PDF) */
  PROFILE_WAIT_RESUME = 'PROFILE_WAIT_RESUME',
  /** Ожидание уточнения от пользователя */
  USER_CLARIFICATION_WAITING = 'USER_CLARIFICATION_WAITING',
  /** Ожидание уточнения времени для напоминания */
  REMINDER_CLARIFICATION_WAITING = 'REMINDER_CLARIFICATION_WAITING',
  /** Ожидание нового значения при редактировании напоминания */
  REMINDER_EDIT_WAITING = 'REMINDER_EDIT_WAITING',
  /** Ожидание подтверждения изменения напоминания */
  REMINDER_EDIT_CONFIRM_WAITING = 'REMINDER_EDIT_CONFIRM_WAITING',
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

  /** Пользователь, которому принадлежит состояние диалога */
  @ManyToOne(() => UserEntity, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'user_id',
  })
  public user: UserEntity | null;

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
