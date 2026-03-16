import { UserEntity } from '@/db/entities/user.entity';
import { ModelEntity } from '@/db/entities/model.entity';
import { RequestEntity } from '@/db/entities/request.entity';
import { RequestStatusEntity } from '@/db/entities/request-status.entity';
import { FileAttachmentEntity } from '@/db/entities/file-attachment.entity';
import { AgentDelegationLogEntity } from '@/db/entities/agent-delegation-log.entity';
import { ConversationHistoryEntity } from '@/db/entities/conversation-history.entity';
import { SearchHistoryEntity } from '@/db/entities/search-history.entity';
import { SearchCacheEntity } from '@/db/entities/search-cache.entity';
import { JobVacancyEntity } from '@/db/entities/job-vacancy.entity';
import { WebResearchLogEntity } from '@/db/entities/web-research-log.entity';
import { ErrorLogEntity } from '@/db/entities/error-log.entity';
import { TelegramDialogStateEntity } from '@/db/entities/telegram-dialog-state.entity';

export const entities = [
  UserEntity,
  ModelEntity,
  RequestEntity,
  RequestStatusEntity,
  FileAttachmentEntity,
  AgentDelegationLogEntity,
  ConversationHistoryEntity,
  SearchHistoryEntity,
  SearchCacheEntity,
  JobVacancyEntity,
  WebResearchLogEntity,
  ErrorLogEntity,
  TelegramDialogStateEntity,
];
