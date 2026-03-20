import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

import { RequestEntity } from '@/db/entities/request.entity';

/** Лог делегирования запросов между агентами */
@Entity({
  name: 'agent_delegation_log',
})
export class AgentDelegationLogEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Запрос, который был делегирован */
  @ManyToOne(() => RequestEntity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'request_id',
  })
  public request: RequestEntity;

  /** Агент-источник, от которого выполнено делегирование */
  @Column('character varying', {
    name: 'from_agent',
    default: 'manager',
  })
  public fromAgent: string;

  /** Агент-получатель, которому передан запрос */
  @Column('character varying', {
    name: 'to_agent',
  })
  public toAgent: string;

  /** Краткая причина делегирования */
  @Column('text', {
    nullable: true,
  })
  public reason: string | null;

  /** Развёрнутое объяснение LLM, почему был выбран этот агент */
  @Column('text', {
    name: 'llm_reasoning',
    nullable: true,
  })
  public llmReasoning: string | null;

  /** Дата создания записи */
  @CreateDateColumn({
    type: 'timestamp with time zone',
  })
  public created: Date;
}
