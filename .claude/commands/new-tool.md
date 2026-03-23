# New Tool

Create a new external API integration tool for the assistent-bot project.

Ask the user for:
- Tool name (PascalCase, e.g. `OpenWeather`)
- What the tool does (brief description)
- API base URL and auth method (if known)

Then create `src/services/tools/<kebab-name>.tool.ts` following this structure:

```typescript
import { Singleton, Container } from 'typescript-ioc';
import { isEmpty, isNil } from 'lodash-es';
import { BaseService } from '@services/app/base.service';
import { ErrorLogService } from '@services/error/error-log.service';

export interface <PascalName>Result {
    // define result shape based on what user described
}

@Singleton
export class <PascalName>Tool extends BaseService {
    private readonly TAG = '<PascalName>Tool';
    private readonly BASE_URL = '<api_base_url>';
    private readonly API_KEY = process.env.<TOOL_NAME>_API_KEY ?? '';

    private readonly errorLogService = Container.get(ErrorLogService);

    public execute = async (query: string): Promise<<PascalName>Result[]> => {
        this.loggerService.info(this.TAG, 'Executing request', { query });

        try {
            const response = await this.fetchData(query);

            this.loggerService.info(this.TAG, 'Request completed', { resultCount: response.length });

            return response;
        } catch (error) {
            this.loggerService.error(this.TAG, 'execute', error);
            throw error;
        }
    };

    private fetchData = async (query: string): Promise<<PascalName>Result[]> => {
        const url = this.buildUrl(query);

        this.loggerService.debug(this.TAG, 'Fetching URL', { url });

        const response = await fetch(url, {
            headers: this.buildHeaders(),
        });

        if (!response.ok) {
            throw new Error(`${this.TAG}: HTTP error ${response.status}`);
        }

        const data = await response.json();

        return this.parseResponse(data);
    };

    private buildUrl = (query: string): string => {
        // TODO: implement URL construction
        return `${this.BASE_URL}?q=${encodeURIComponent(query)}`;
    };

    private buildHeaders = (): Record<string, string> => ({
        'Authorization': `Api-Key ${this.API_KEY}`,
        'Content-Type': 'application/json',
    });

    private parseResponse = (data: unknown): <PascalName>Result[] => {
        // TODO: implement response parsing
        return [];
    };
}
```

Rules to follow when creating the tool:
- All methods are arrow functions
- Private constants at the top of the class
- API key always from `process.env`, never hardcoded
- Log the start and end of every external call (with `loggerService.info`)
- Log URL/params at `debug` level
- Wrap main method in try/catch, always call `errorLogService.log` on failure
- Use lodash (`isNil`, `isEmpty`) for nil/empty checks
- No abbreviations anywhere

After creating the file, remind the user to:
- Add the API key variable to `.env` and document it in `CLAUDE.md`
- Inject the tool into the agent that will use it via the constructor
