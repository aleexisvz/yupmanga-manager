import { Command } from 'commander';
import { select, input } from '@inquirer/prompts';
import chalk from 'chalk';
import { BrowserManager } from './browser/BrowserManager.js';
import { GalleryNavigator } from './navigator/GalleryNavigator.js';
import { ReaderAutomation } from './reader/ReaderAutomation.js';
import { HumanInput } from './behavior/HumanInput.js';
import { BrowsingSimulator } from './behavior/BrowsingSimulator.js';
import { ActionScheduler } from './behavior/ActionScheduler.js';
import { MangaQueue } from './queue/MangaQueue.js';
import { ProgressTracker } from './storage/ProgressTracker.js';
import { SessionOrchestrator } from './core/SessionOrchestrator.js';
import { ConfigLoader } from './config/loader.js';
import { setupGracefulShutdown } from './utils/signals.js';
import { logger } from './logger.js';

const program = new Command();

program
  .name('yupmanga')
  .description('YupManga Manager — Autonomous reading and browsing simulator for yupmanga.com')
  .version('1.0.0');

program
  .command('setup')
  .description('Open Google Chrome in visible mode to resolve Cloudflare and log into your account')
  .action(async () => {
    const browser = new BrowserManager();
    await browser.setup();
    process.exit(0);
  });

program
  .command('check')
  .description('Check whether an account is currently logged in on YupManga')
  .action(async () => {
    await checkAccountStatus();
    process.exit(0);
  });

program
  .command('start')
  .description('Start the autonomous reading session in background')
  .action(async () => {
    await startSession();
  });

async function checkAccountStatus(): Promise<void> {
  const config = await ConfigLoader.load();
  const browser = new BrowserManager();
  console.log(chalk.cyan(`\n[AUTH] Verifying authentication on yupmanga.com (mode: ${config.runMode})...`));

  const page = await browser.launch(config);
  const auth = await browser.checkAuth(page);
  await browser.close();

  if (auth.isLoggedIn) {
    console.log(chalk.green('\n================================================='));
    console.log(chalk.green(`  CONNECTED ACCOUNT: ${chalk.bold(auth.username)}`));
    if (auth.streak) console.log(chalk.green(`  Reading Streak: ${auth.streak}`));
    if (auth.caps) console.log(chalk.green(`  Chapters Read: ${auth.caps}`));
    if (auth.series) console.log(chalk.green(`  Series Read: ${auth.series}`));
    console.log(chalk.green('=================================================\n'));
  } else {
    console.log(chalk.red('\n================================================='));
    console.log(chalk.red('  STATUS: NOT LOGGED IN (ANONYMOUS / GUEST MODE)'));
    console.log(chalk.yellow('  Warning: Progress will NOT be saved to any account!'));
    console.log(chalk.cyan('  Action: Run "Setup inicial" to log into your account.'));
    console.log(chalk.red('=================================================\n'));
  }
}

async function startSession(): Promise<void> {
  const config = await ConfigLoader.load();
  const queue = new MangaQueue();
  const tracker = new ProgressTracker();

  const entries = await queue.list();
  if (entries.length === 0) {
    console.log(chalk.yellow('\n[QUEUE] No manga in reading queue.'));
    console.log(chalk.cyan('Add a series using the interactive menu (npm run dev).\n'));
    return;
  }

  const browser = new BrowserManager();
  const humanInput = new HumanInput();
  const browsing = new BrowsingSimulator(humanInput);
  const gallery = new GalleryNavigator();
  const reader = new ReaderAutomation();
  const scheduler = new ActionScheduler(config);

  const orchestrator = new SessionOrchestrator(
    browser,
    gallery,
    reader,
    browsing,
    scheduler,
    queue,
    tracker,
    config
  );

  setupGracefulShutdown(async () => {
    await orchestrator.stop();
  });

  await orchestrator.start();
}

async function showInteractiveMenu(): Promise<void> {
  const queue = new MangaQueue();
  const tracker = new ProgressTracker();
  let config = await ConfigLoader.load();

  console.clear();
  console.log(
    chalk.magentaBright(`
  ================================================
     YUPMANGA MANAGER - Autonomous Reader
  ================================================
  `)
  );

  while (true) {
    const choice = await select({
      message: 'Choose an option:',
      choices: [
        { name: '1. Start autonomous reading session', value: 'start' },
        { name: '2. Check connected account status', value: 'check_auth' },
        { name: '3. View manga reading queue', value: 'list_queue' },
        { name: '4. Add manga to queue', value: 'add_manga' },
        { name: '5. Remove manga from queue', value: 'remove_manga' },
        { name: '6. View statistics & progress', value: 'stats' },
        { name: '7. Settings (runMode, intervals)', value: 'config' },
        { name: '8. Initial Setup (Manual login / Cloudflare)', value: 'setup' },
        { name: '9. Exit', value: 'exit' },
      ],
    });

    switch (choice) {
      case 'start':
        await startSession();
        return;

      case 'check_auth':
        await checkAccountStatus();
        break;

      case 'list_queue': {
        const entries = await queue.list();
        console.log(chalk.cyan('\nManga reading queue:'));
        if (entries.length === 0) {
          console.log(chalk.gray('  (Queue is currently empty)\n'));
        } else {
          entries.forEach((m, idx) => {
            console.log(
              `  ${idx + 1}. ${chalk.bold(m.title)} [${chalk.green(m.status)}] - ${chalk.gray(m.url)}`
            );
          });
          console.log('');
        }
        break;
      }

      case 'add_manga': {
        const url = await input({
          message: 'Enter manga URL on yupmanga.com:',
          validate: (val) => (val.includes('yupmanga.com') ? true : 'Must be a yupmanga.com URL'),
        });
        const title = await input({
          message: 'Manga title/name:',
          default: url.split('/').filter(Boolean).pop() || 'Manga',
        });
        await queue.add(url, title);
        console.log(chalk.green(`\nSuccessfully added "${title}" to queue.\n`));
        break;
      }

      case 'remove_manga': {
        const entries = await queue.list();
        if (entries.length === 0) {
          console.log(chalk.yellow('\nQueue is empty.\n'));
          break;
        }
        const toRemove = await select({
          message: 'Select manga to remove:',
          choices: entries.map((m) => ({ name: m.title, value: m.url })),
        });
        await queue.remove(toRemove);
        console.log(chalk.green('\nManga removed from queue.\n'));
        break;
      }

      case 'stats': {
        const records = await tracker.getAll();
        console.log(chalk.cyan('\nReading statistics & history:'));
        if (records.length === 0) {
          console.log(chalk.gray('  (No stats recorded yet)\n'));
        } else {
          records.forEach((r) => {
            console.log(`  ${chalk.bold(r.title)}:`);
            console.log(`     - Total pages read: ${r.totalPagesReadAccumulated}`);
            console.log(`     - Volumes completed: ${r.totalVolumesCompleted}`);
            console.log(`     - Sessions count: ${r.sessionsCount}`);
            console.log(`     - Last reading: ${new Date(r.lastReadTimestamp).toLocaleString()}\n`);
          });
        }
        break;
      }

      case 'config': {
        const newRunMode = await select({
          message: 'Browser execution mode:',
          choices: [
            { name: 'Headless (invisible in background)', value: 'headless' },
            { name: 'Off-screen (real headed window off-monitor)', value: 'offscreen' },
            { name: 'Headed (visible window)', value: 'headed' },
          ],
          default: config.runMode,
        });

        config.runMode = newRunMode as any;
        await ConfigLoader.save(config);
        console.log(chalk.green('\nConfiguration saved successfully.\n'));
        break;
      }

      case 'setup': {
        const browser = new BrowserManager();
        await browser.setup();
        break;
      }

      case 'exit':
        console.log(chalk.gray('\nGoodbye!\n'));
        process.exit(0);
    }
  }
}

if (process.argv.length <= 2) {
  showInteractiveMenu().catch((err) => {
    logger.error({ err }, 'Error in interactive menu');
  });
} else {
  program.parse();
}
