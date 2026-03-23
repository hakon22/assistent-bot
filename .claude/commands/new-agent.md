# New Agent

Create a new specialized agent for the assistent-bot project.

Ask the user for the agent name (in camelCase, e.g. `weatherAgent`) and a short description of what it does, if not already provided in the arguments.

Then perform the following steps:

## Step 1 — Create the agent file

Create `src/services/agents/<kebab-name>.agent.ts` following this exact structure:

```typescript
import { Singleton, Container } from 'typescript-ioc';
import { START, END, StateGraph, Annotation } from '@langchain/langgraph';
import { isEmpty } from 'lodash-es';

import { BaseService } from '@services/app/base.service';
import { ErrorLogService } from '@services/error/error-log.service';
import { ModelService } from '@services/model/model.service';

const StateAnnotation = Annotation.Root({
    userId: Annotation<number>(),
    telegramId: Annotation<string>(),
    message: Annotation<string>(),
    attachments: Annotation<{ type: string; content: string; }[]>(),
    response: Annotation<string>(),
});

@Singleton
export class <PascalName>AgentService extends BaseService {
    private readonly TAG = '<PascalName>AgentService';
    private readonly AGENT_NAME = '<name>';

    private readonly errorLogService = Container.get(ErrorLogService);
    private readonly modelService = Container.get(ModelService);

    public process = async (state: typeof StateAnnotation.State): Promise<string> => {
        this.loggerService.info(this.TAG, 'Starting processing', { telegramId: state.telegramId });

        try {
            const graph = this.buildGraph();
            const result = await graph.invoke(state);

            this.loggerService.info(this.TAG, 'Processing completed', { telegramId: state.telegramId });

            return result.response;
        } catch (error) {
            this.loggerService.error(this.TAG, 'process', error);
            throw error;
        }
    };

    private buildGraph = () => {
        const graph = new StateGraph(StateAnnotation)
            .addNode('process', this.processNode)
            .addEdge(START, 'process')
            .addEdge('process', END);

        return graph.compile();
    };

    private processNode = async (state: typeof StateAnnotation.State): Promise<Partial<typeof StateAnnotation.State>> => {
        this.loggerService.debug(this.TAG, 'processNode called', { message: state.message });

        const model = this.modelService.getModel();

        // TODO: implement agent logic here

        return { response: '' };
    };
}
```

## Step 2 — Register in ManagerAgent

Open `src/services/agents/manager.agent.ts` and:
1. Import the new agent service
2. Add it to the agents registry map with a name and description (used by the router LLM to decide when to delegate)
3. Add a new graph node and conditional edge

## Step 3 — Register in DI container

Check `src/bot.ts` or wherever services are bootstrapped — ensure the new agent is imported so typescript-ioc picks it up.

## Step 4 — Remind the user

After creating the files, remind the user to:
- Add agent description to the router prompt in `manager.agent.ts` so the LLM knows when to use it
- Run `npm run build` to verify no TypeScript errors
