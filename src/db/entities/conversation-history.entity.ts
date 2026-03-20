import { BaseEntity, Column, CreateDateColumn, Entity, ManyToOne, JoinColumn, PrimaryGeneratedColumn } from 'typeorm';

import { UserEntity } from '@/db/entities/user.entity';
import { RequestEntity } from '@/db/entities/request.entity';

export type ConversationRole = 'user' | 'assistant' | 'system' | 'tool';

/** Сообщение из истории диалога с агентом */
@Entity({
  name: 'conversation_history',
})
export class ConversationHistoryEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Дата создания записи */
  @CreateDateColumn({
    type: 'timestamp with time zone',
  })
  public created: Date;

  /** Пользователь, которому принадлежит диалог */
  @ManyToOne(() => UserEntity, {
    nullable: true,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'user_id',
  })
  public user: UserEntity | null;

  /** Telegram id пользователя (дублирует для быстрой выборки) */
  @Column('character varying', {
    name: 'telegram_id',
    nullable: true,
  })
  public telegramId: string | null;

  /** Запрос, в рамках которого создано это сообщение */
  @ManyToOne(() => RequestEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'request_id',
  })
  public request: RequestEntity | null;

  /** Роль автора сообщения (user / assistant / system / tool) */
  @Column('character varying')
  public role: ConversationRole;

  /** Текстовое содержимое сообщения */
  @Column('text')
  public content: string;

  /** Название агента, сгенерировавшего сообщение */
  @Column('character varying', {
    name: 'agent_name',
    nullable: true,
  })
  public agentName: string | null;

  /** Количество токенов в сообщении */
  @Column('integer', {
    name: 'token_count',
    nullable: true,
  })
  public tokenCount: number | null;
}
