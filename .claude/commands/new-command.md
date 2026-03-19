# New Command

Add a new Telegram bot command to the assistent-bot project.

Ask the user for:
- Command name (without slash, e.g. `settings`)
- What the command does
- Whether it requires any dialog state (waiting for user input after the command)

Then perform the following steps:

## Step 1 — Add handler in TelegramBotCommandService

Open `src/services/telegram/telegram-bot-command.service.ts` and add a new command handler following the existing pattern:

```typescript
private register<PascalName>Command = (): void => {
    this.bot.command('<command_name>', async (context) => {
        const { id: telegramId } = context.from;

        this.loggerService.info(this.TAG, '/<command_name> called', { telegramId });

        if (!this.isAccessAllowed(telegramId)) {
            return;
        }

        try {
            // TODO: implement command logic

            await context.reply('<response text>', { parse_mode: 'HTML' });
        } catch (error) {
            this.loggerService.error(this.TAG, '<command_name>', error);
            await context.reply('Произошла ошибка. Попробуй ещё раз.');
        }
    });
};
```

If the command needs to wait for follow-up input from the user (dialog state):

```typescript
// Set dialog state after command
await this.telegramDialogStateRepository.save({
    telegramId: String(telegramId),
    state: 'waiting_for_<something>',
});
```

And handle the follow-up in the `on('text')` handler by checking the dialog state.

## Step 2 — Register the command in the init method

In the same file, find the method that calls all `register*Command()` methods (usually `registerCommands` or `init`) and add:

```typescript
this.register<PascalName>Command();
```

## Step 3 — Register with Telegram BotFather list

Open `src/bot.ts` or wherever `bot.telegram.setMyCommands(...)` is called and add the new command to the list:

```typescript
{ command: '<command_name>', description: '<Short description for BotFather>' },
```

## Step 4 — Remind the user

After making the changes, remind the user to:
- Update `/help` command response to mention the new command
- Run `npm run build` to verify no TypeScript errors
- If dialog state was added, ensure the `on('text')` handler checks and clears the state after use
