import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

import { UserEntity } from '@/db/entities/user.entity';

export type MediaType = 'text' | 'photo' | 'document' | 'mixed' | 'voice' | 'video' | 'video_note' | 'audio' | 'callback';

/** Входящий запрос от пользователя */
@Entity({
  name: 'request',
})
export class RequestEntity extends BaseEntity {
  /** Уникальный идентификатор запроса */
  @PrimaryGeneratedColumn()
  public id: number;

  /** UUID запроса (уникален, генерируется автоматически) */
  @Column('uuid', {
    name: 'request_uuid',
    unique: true,
    default: () => 'gen_random_uuid()',
  })
  public requestUuid: string;

  /** Пользователь, от которого пришёл запрос */
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

  /** Telegram id сообщения, породившего запрос */
  @Column('bigint', {
    name: 'telegram_message_id',
    nullable: true,
  })
  public telegramMessageId: string | null;

  /** Telegram id чата, из которого пришёл запрос */
  @Column('bigint', {
    name: 'telegram_chat_id',
    nullable: true,
  })
  public telegramChatId: string | null;

  /** Исходный текст сообщения от пользователя */
  @Column('text', {
    name: 'raw_text',
    nullable: true,
  })
  public rawText: string | null;

  /** Тип медиа в сообщении (text / photo / document / voice и др.) */
  @Column('character varying', {
    name: 'media_type',
    nullable: true,
  })
  public mediaType: MediaType | null;

  /** Название агента, который обработал запрос */
  @Column('character varying', {
    name: 'agent_handled',
    nullable: true,
  })
  public agentHandled: string | null;

  /** Итоговый ответ, отправленный пользователю */
  @Column('text', {
    name: 'final_response',
    nullable: true,
  })
  public finalResponse: string | null;

  /** Идентификатор выполнения (execution id) для трассировки */
  @Column('character varying', {
    name: 'execution_id',
    nullable: true,
  })
  public executionId: string | null;

  /** Время начала обработки запроса */
  @Column('timestamp with time zone', {
    name: 'processing_started_at',
    nullable: true,
  })
  public processingStartedAt: Date | null;

  /** Время завершения обработки запроса */
  @Column('timestamp with time zone', {
    name: 'processing_completed_at',
    nullable: true,
  })
  public processingCompletedAt: Date | null;

  /** Дата создания записи */
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
  })
  public createdAt: Date;

  /** Дата последнего изменения записи */
  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamp with time zone',
  })
  public updatedAt: Date;
}
