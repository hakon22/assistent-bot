import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

import { RequestEntity } from '@/db/entities/request.entity';

export type RequestStatus = 'pending' | 'processing' | 'delegated' | 'completed' | 'failed';

/** Запись об изменении статуса запроса (история статусов) */
@Entity({
  name: 'request_status',
})
export class RequestStatusEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Запрос, к которому относится статус */
  @ManyToOne(() => RequestEntity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'request_id',
  })
  public request: RequestEntity;

  /** FK — id запроса */
  @Column('integer', {
    name: 'request_id',
  })
  public requestId: number;

  /** Статус запроса (pending / processing / delegated / completed / failed) */
  @Column('character varying')
  public status: RequestStatus;

  /** Название агента, установившего этот статус */
  @Column('character varying', {
    name: 'agent_name',
    nullable: true,
  })
  public agentName: string | null;

  /** Дополнительные заметки к смене статуса */
  @Column('text', {
    nullable: true,
  })
  public notes: string | null;

  /** Дата создания записи */
  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamp with time zone',
  })
  public createdAt: Date;
}
