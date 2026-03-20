import { BaseEntity, Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

import { UserEntity } from '@/db/entities/user.entity';

export enum ReminderStatusEnum {
  /** Напоминание ожидает отправки */
  PENDING = 'PENDING',
  /** Напоминание отправлено */
  SENT = 'SENT',
  /** Напоминание отменено */
  CANCELLED = 'CANCELLED',
}

export enum ReminderTypeEnum {
  /** Напоминание для себя */
  SELF = 'SELF',
  /** Напоминание для партнёра */
  PARTNER = 'PARTNER',
}

/** Запланированное напоминание */
@Entity({
  name: 'reminder',
})
export class ReminderEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
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

  /** Пользователь, создавший напоминание */
  @ManyToOne(() => UserEntity, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'user_id',
  })
  public user: UserEntity;

  /** Telegram id отправителя (кто поставил напоминание) */
  @Column('character varying', {
    name: 'sender_telegram_id',
    nullable: false,
  })
  public senderTelegramId: string;

  /** Telegram id получателя (кому отправить напоминание) */
  @Column('character varying', {
    name: 'target_telegram_id',
    nullable: false,
  })
  public targetTelegramId: string;

  /** Текст напоминания */
  @Column('text', {
    name: 'reminder_text',
    nullable: false,
  })
  public reminderText: string;

  /** Дата и время отправки напоминания */
  @Column('timestamp with time zone', {
    nullable: false,
  })
  public scheduled: Date;

  /** Текущий статус напоминания */
  @Column('enum', {
    name: 'status',
    enum: ReminderStatusEnum,
    enumName: 'reminder_status_enum',
    default: ReminderStatusEnum.PENDING,
    nullable: false,
  })
  public status: ReminderStatusEnum;

  /** Дата мягкого удаления записи */
  @DeleteDateColumn({
    type: 'timestamp with time zone',
    nullable: true,
  })
  public deleted: Date | null;

  /** Тип напоминания: для себя или для партнёра */
  @Column('enum', {
    name: 'type',
    enum: ReminderTypeEnum,
    enumName: 'reminder_type_enum',
    default: ReminderTypeEnum.SELF,
    nullable: false,
  })
  public reminderType: ReminderTypeEnum;
}
