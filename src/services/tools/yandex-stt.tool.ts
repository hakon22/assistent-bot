import { Singleton } from 'typescript-ioc';
import axios from 'axios';

@Singleton
export class YandexSttTool {
  private readonly TAG = 'YandexSttTool';

  private readonly apiKey = process.env.YANDEX_VOICE_API_KEY ?? '';

  private readonly folderId = process.env.YANDEX_SEARCH_FOLDER_ID ?? '';

  private readonly sttUrl = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';

  /**
   * Transcribe audio/video buffer via Yandex SpeechKit.
   * @param buffer  raw audio bytes (ogg/opus, mp3, mp4, wav)
   * @param format  'oggopus' for voice messages, 'mp4' for videos
   */
  public transcribe = async (buffer: Buffer, format: 'oggopus' | 'mp4' | 'lpcm' = 'oggopus'): Promise<string> => {
    if (!this.apiKey || !this.folderId) {
      throw new Error('Yandex STT: YANDEX_SEARCH_API_KEY or YANDEX_SEARCH_FOLDER_ID not configured');
    }

    const response = await axios.post(this.sttUrl, buffer, {
      headers: {
        Authorization: `Api-Key ${this.apiKey}`,
        'Content-Type': 'application/octet-stream',
      },
      params: {
        lang: 'ru-RU',
        format,
        folderId: this.folderId,
      },
      timeout: 60000,
    });

    const result = response.data?.result;
    if (!result) {
      throw new Error('Yandex STT returned empty result');
    }

    return result as string;
  };

  /** Detect format from mime type */
  public formatFromMime = (mimeType: string): 'oggopus' | 'mp4' | 'lpcm' => {
    if (mimeType.includes('ogg') || mimeType.includes('opus')) {
      return 'oggopus';
    }
    if (mimeType.includes('mp4') || mimeType.includes('video')) {
      return 'mp4';
    }
    return 'oggopus';
  };
}
