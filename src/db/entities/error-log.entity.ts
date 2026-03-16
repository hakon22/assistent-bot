import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

import { RequestEntity } from '@/db/entities/request.entity';

/** Лог ошибок, возникших при обработке запросов */
@Entity({
  name: 'error_log',
})
export class ErrorLogEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Запрос, при обработке которого возникла ошибка */
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

  /** Telegram id пользователя, связанного с ошибкой */
  @Column('bigint', {
    name: 'user_telegram_id',
    nullable: true,
  })
  public userTelegramId: string | null;

  /** Название сервиса, в котором произошла ошибка */
  @Column('character varying', {
    name: 'service_name',
    nullable: true,
  })
  public serviceName: string | null;

  /** Название узла (ноды) графа, в котором произошла ошибка */
  @Column('character varying', {
    name: 'node_name',
    nullable: true,
  })
  public nodeName: string | null;

  /** Текст сообщения ошибки */
  @Column('text', {
    name: 'error_message',
  })
  public errorMessage: string;

  /** Stack trace ошибки */
  @Column('text', {
    name: 'error_stack',
    nullable: true,
  })
  public errorStack: string | null;

  /** Дополнительные данные об ошибке в произвольном формате */
  @Column('jsonb', {
    name: 'error_data',
    nullable: true,
  })
  public errorData: any;

  /** Флаг: уведомление об ошибке уже отправлено администратору */
  @Column('boolean', {
    name: 'error_notified',
    default: false,
  })
  public errorNotified: boolean;

  /** Дата создания записи */
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
  })
  public createdAt: Date;
}
