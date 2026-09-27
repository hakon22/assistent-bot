import { Singleton } from 'typescript-ioc';

import { BaseService } from '@/services/app/base.service';

export interface TelegramMediaGroupPhoto {
  messageId: number;
  fileId: string;
  fileUniqueId: string;
  caption: string;
}

export type TelegramMediaGroupFlushHandler = (photos: TelegramMediaGroupPhoto[], caption: string) => Promise<void>;

interface TelegramMediaGroupState {
  photos: TelegramMediaGroupPhoto[];
  timer: ReturnType<typeof setTimeout>;
  onFlush: TelegramMediaGroupFlushHandler;
}

@Singleton
export class TelegramMediaGroupBufferService extends BaseService {
  private readonly TAG = 'TelegramMediaGroupBufferService';

  private readonly DEBOUNCE_MILLISECONDS = 700;

  private readonly MAXIMUM_PHOTO_COUNT = 10;

  private readonly groups = new Map<string, TelegramMediaGroupState>();

  public schedulePhoto = (
    bufferKey: string,
    photo: TelegramMediaGroupPhoto,
    onFlush: TelegramMediaGroupFlushHandler,
  ): void => {
    const existingGroup = this.groups.get(bufferKey);

    if (!existingGroup) {
      this.loggerService.info(this.TAG, 'Начало сбора альбома', { bufferKey });
      const timer = setTimeout(() => {
        this.flushGroup(bufferKey);
      }, this.DEBOUNCE_MILLISECONDS);
      this.groups.set(bufferKey, {
        photos: [photo],
        timer,
        onFlush,
      });
      this.loggerService.debug(this.TAG, 'Фото добавлено в альбом', {
        bufferKey,
        messageId: photo.messageId,
        photoCount: 1,
      });
      return;
    }

    clearTimeout(existingGroup.timer);
    existingGroup.photos.push(photo);
    existingGroup.onFlush = onFlush;
    existingGroup.timer = setTimeout(() => {
      this.flushGroup(bufferKey);
    }, this.DEBOUNCE_MILLISECONDS);
    this.loggerService.debug(this.TAG, 'Фото добавлено в альбом', {
      bufferKey,
      messageId: photo.messageId,
      photoCount: existingGroup.photos.length,
    });
  };

  private flushGroup = async (bufferKey: string): Promise<void> => {
    const group = this.groups.get(bufferKey);
    if (!group) {
      return;
    }

    this.groups.delete(bufferKey);

    const sortedPhotos = [...group.photos].sort((a, b) => Number(a.messageId) - Number(b.messageId));
    const selectedPhotos = sortedPhotos.length > this.MAXIMUM_PHOTO_COUNT
      ? sortedPhotos.slice(0, this.MAXIMUM_PHOTO_COUNT)
      : sortedPhotos;

    if (sortedPhotos.length > this.MAXIMUM_PHOTO_COUNT) {
      this.loggerService.warn(this.TAG, 'Альбом превышает лимит фотографий, лишние отброшены', {
        bufferKey,
        receivedCount: sortedPhotos.length,
        keptCount: this.MAXIMUM_PHOTO_COUNT,
      });
    }

    const captions = [...new Set(
      selectedPhotos
        .map(({ caption }) => caption.trim())
        .filter(Boolean),
    )];
    const mergedCaption = captions.join('\n');

    this.loggerService.info(this.TAG, 'Альбом собран', {
      bufferKey,
      photoCount: selectedPhotos.length,
      hasCaption: Boolean(mergedCaption),
    });

    try {
      await group.onFlush(selectedPhotos, mergedCaption);
    } catch (error) {
      this.loggerService.error(this.TAG, 'Ошибка обработки альбома', error);
    }
  };
}
