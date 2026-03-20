import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, BaseEntity } from 'typeorm';

import { RequestEntity } from '@/db/entities/request.entity';
import { UserEntity } from '@/db/entities/user.entity';

/** Вложенный файл, прикреплённый к запросу */
@Entity({
  name: 'file_attachment',
})
export class FileAttachmentEntity extends BaseEntity {
  /** Уникальный идентификатор записи */
  @PrimaryGeneratedColumn()
  public id: number;

  /** Запрос, к которому прикреплён файл */
  @ManyToOne(() => RequestEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'request_id',
  })
  public request: RequestEntity | null;

  /** Пользователь, приславший файл */
  @ManyToOne(() => UserEntity, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({
    name: 'user_id',
  })
  public user: UserEntity | null;

  /** Telegram file_id файла */
  @Column('character varying', {
    name: 'telegram_file_id',
  })
  public telegramFileId: string;

  /** Тип файла (photo / document / voice и др.) */
  @Column('character varying', {
    name: 'file_type',
    nullable: true,
  })
  public fileType: string | null;

  /** MIME-тип файла */
  @Column('character varying', {
    name: 'mime_type',
    nullable: true,
  })
  public mimeType: string | null;

  /** Оригинальное имя файла */
  @Column('character varying', {
    name: 'file_name',
    nullable: true,
  })
  public fileName: string | null;

  /** Размер файла в байтах */
  @Column('integer', {
    name: 'file_size',
    nullable: true,
  })
  public fileSize: number | null;

  /** URL для скачивания файла */
  @Column('text', {
    name: 'download_url',
    nullable: true,
  })
  public downloadUrl: string | null;

  /** Текст, извлечённый из файла (OCR / парсинг) */
  @Column('text', {
    name: 'extracted_text',
    nullable: true,
  })
  public extractedText: string | null;

  /** Дата создания записи */
  @CreateDateColumn({
    type: 'timestamp with time zone',
  })
  public created: Date;
}
