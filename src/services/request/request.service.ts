import { Singleton } from 'typescript-ioc';
import { randomUUID } from 'crypto';

import { RequestEntity, type MediaType } from '@/db/entities/request.entity';
import { RequestStatusEntity, type RequestStatus } from '@/db/entities/request-status.entity';
import { FileAttachmentEntity } from '@/db/entities/file-attachment.entity';
import { UserEntity } from '@/db/entities/user.entity';

export interface CreateRequestInput {
  userId: number;
  telegramMessageId?: string;
  telegramChatId?: string;
  rawText?: string;
  mediaType?: MediaType;
}

export interface FileAttachmentInput {
  userId: number;
  telegramFileId: string;
  fileType?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  downloadUrl?: string;
  extractedText?: string;
}

@Singleton
export class RequestService {
  /** Create a new request and insert 'pending' status */
  public create = async (input: CreateRequestInput): Promise<RequestEntity> => {
    const request = new RequestEntity();
    request.requestUuid = randomUUID();
    request.user = { id: input.userId } as UserEntity;
    request.telegramMessageId = input.telegramMessageId ?? null;
    request.telegramChatId = input.telegramChatId ?? null;
    request.rawText = input.rawText ?? null;
    request.mediaType = input.mediaType ?? 'text';
    await request.save();

    await this.addStatus(request.id, 'pending', null, 'Request received');
    return request;
  };

  /** Add a status transition */
  public addStatus = async (requestId: number, status: RequestStatus, agentName?: string | null, notes?: string): Promise<void> => {
    const requestStatus = new RequestStatusEntity();
    requestStatus.request = { id: requestId } as RequestEntity;
    requestStatus.status = status;
    requestStatus.agentName = agentName ?? null;
    requestStatus.notes = notes ?? null;
    await requestStatus.save();
  };

  /** Mark request as processing */
  public markProcessing = async (requestId: number): Promise<void> => {
    await RequestEntity.update({ id: requestId }, { processingStartedAt: new Date() });
    await this.addStatus(requestId, 'processing', null, 'Manager agent started');
  };

  /** Mark request as completed with agent result */
  public markCompleted = async (requestId: number, agentName: string, responseText: string): Promise<void> => {
    await RequestEntity.update({ id: requestId }, {
      agentHandled: agentName,
      finalResponse: responseText,
      processingCompletedAt: new Date(),
    });
    await this.addStatus(requestId, 'completed', agentName);
  };

  /** Mark request as failed */
  public markFailed = async (requestId: number, agentName?: string, notes?: string): Promise<void> => {
    await this.addStatus(requestId, 'failed', agentName ?? null, notes);
    const request = await RequestEntity.findOne({ where: { id: requestId } });
    if (request) {
      request.processingCompletedAt = new Date();
      await request.save();
    }
  };

  /** Save file attachment and return its ID */
  public saveFileAttachment = async (input: FileAttachmentInput, requestId?: number): Promise<FileAttachmentEntity> => {
    const fileAttachment = new FileAttachmentEntity();
    fileAttachment.user = { id: input.userId } as UserEntity;
    fileAttachment.request = requestId ? { id: requestId } as RequestEntity : null;
    fileAttachment.telegramFileId = input.telegramFileId;
    fileAttachment.fileType = input.fileType ?? null;
    fileAttachment.mimeType = input.mimeType ?? null;
    fileAttachment.fileName = input.fileName ?? null;
    fileAttachment.fileSize = input.fileSize ?? null;
    fileAttachment.downloadUrl = input.downloadUrl ?? null;
    fileAttachment.extractedText = input.extractedText ?? null;
    return fileAttachment.save();
  };

  /** Link existing attachment to request */
  public linkAttachmentToRequest = async (attachmentId: number, requestId: number): Promise<void> => {
    const attachment = await FileAttachmentEntity.findOne({ where: { id: attachmentId } });
    if (attachment) {
      attachment.request = { id: requestId } as RequestEntity;
      await attachment.save();
    }
  };
}
