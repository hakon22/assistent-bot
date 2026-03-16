import { exec } from 'child_process';
import { promisify } from 'util';

class CreateMigrationHelper {
  private execAsync = promisify(exec);

  private readonly defaultMigrationPath = './server/db/migrations';

  private createMigration = async (migrationName: string): Promise<void> => {
    const migrationFullPath = `${this.defaultMigrationPath}/${migrationName}`;
    
    try {
      const { stdout, stderr } = await this.execAsync(`npm run migration:create ${migrationFullPath}`);
      console.log(stdout);
      if (stderr) {
        console.error('Error:', stderr);
      }
    } catch (error) {
      console.error('Failed to create migration:', error);
    }
  };

  public run = () => {
    const migrationName = process.argv[2];
    console.log('name', migrationName);

    if (!migrationName) {
      console.error('Provide name for the migration.');
      process.exit(1);
    }

    return this.createMigration(migrationName);
  };
}

const helper = new CreateMigrationHelper();

helper.run();
