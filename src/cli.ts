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
import { SPEED_PROFILES } from './config/defaults.js';
import type { ReadingSpeed, SeriesType } from './config/types.js';
import { SERIES_TYPE_LABELS } from './utils/seriesType.js';
import { parseSeriesTitle } from './utils/seriesTitle.js';
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

program
  .command('speed')
  .description('View or set reading speed preset (fast, normal, slow, very_slow)')
  .argument('[preset]', 'Speed preset: fast | normal | slow | very_slow')
  .action(async (preset?: string) => {
    const config = await ConfigLoader.load();
    if (!preset) {
      const current = SPEED_PROFILES[config.readingSpeed || 'normal'];
      console.log(chalk.cyan(`\nCurrent reading speed: ${current.icon} ${current.name} (${current.badge})`));
      console.log(chalk.gray(`Description: ${current.description}\n`));
      console.log('Available presets:');
      (Object.keys(SPEED_PROFILES) as ReadingSpeed[]).forEach((key) => {
        const p = SPEED_PROFILES[key];
        console.log(`  - ${chalk.bold(p.id)}: ${p.icon} ${p.name} (${p.badge}) - ${p.description}`);
      });
      console.log('');
      process.exit(0);
    }

    if (preset in SPEED_PROFILES) {
      config.readingSpeed = preset as ReadingSpeed;
      await ConfigLoader.save(config);
      const profile = SPEED_PROFILES[preset as ReadingSpeed];
      console.log(chalk.green(`\n✓ Reading speed set to: ${profile.icon} ${profile.name} (${profile.badge})\n`));
      process.exit(0);
    } else {
      console.log(chalk.red(`\nInvalid preset "${preset}". Choose from: fast, normal, slow, very_slow\n`));
      process.exit(1);
    }
  });

program
  .command('direction')
  .description('View or set reading direction (auto, rtl, ltr)')
  .argument('[dir]', 'Reading direction: auto | rtl | ltr')
  .action(async (dir?: string) => {
    const config = await ConfigLoader.load();
    if (!dir) {
      console.log(chalk.cyan(`\nCurrent reading direction: ${config.readingDirection || 'auto'}\n`));
      console.log('Available options:');
      console.log('  - auto: Auto-detect & self-calibrating (recommended)');
      console.log('  - rtl: Right-to-Left (Japanese manga, ArrowLeft = next)');
      console.log('  - ltr: Left-to-Right (Manhwa/western, ArrowRight = next)\n');
      process.exit(0);
    }
    const clean = dir.toLowerCase();
    if (['auto', 'rtl', 'ltr'].includes(clean)) {
      config.readingDirection = clean as any;
      await ConfigLoader.save(config);
      console.log(chalk.green(`\n✓ Reading direction set to: ${clean}\n`));
      process.exit(0);
    } else {
      console.log(chalk.red(`\nInvalid direction "${dir}". Choose from: auto, rtl, ltr\n`));
      process.exit(1);
    }
  });

/**
 * Opens the series page in the browser and reads its title. Returns null when the title
 * cannot be read, so the caller can fall back to the URL slug.
 */
async function detectSeriesTitle(url: string): Promise<string | null> {
  const config = await ConfigLoader.load();
  const browser = new BrowserManager();
  try {
    const page = await browser.launch(config);
    await page.goto(url.startsWith('http') ? url : `https://${url}`, { waitUntil: 'domcontentloaded' });
    // Give a Cloudflare challenge a moment to clear before reading the title
    await page
      .waitForFunction(() => !document.title.includes('Just a moment'), undefined, { timeout: 15000 })
      .catch(() => {});
    return parseSeriesTitle(await page.title());
  } catch (error) {
    logger.warn({ error }, '[QUEUE] Could not read the series title from the page');
    return null;
  } finally {
    await browser.close();
  }
}

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
    console.log(chalk.cyan('  Action: Run option 8 ("Initial Setup / Sincronizar cuenta") to log into your account.'));
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

  const teardownSignals = setupGracefulShutdown(async () => {
    await orchestrator.stop();
  });

  try {
    await orchestrator.start();
  } finally {
    teardownSignals();
  }
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
    config = await ConfigLoader.load();
    const choice = await select({
      message: 'Choose an option:',
      choices: [
        { name: '1. Start autonomous reading session', value: 'start' },
        { name: '2. Check connected account status', value: 'check_auth' },
        { name: '3. View manga reading queue', value: 'list_queue' },
        { name: '4. Add manga to queue', value: 'add_manga' },
        { name: '5. Remove manga from queue', value: 'remove_manga' },
        { name: '6. View statistics & progress', value: 'stats' },
        { name: '7. Settings (reading speed, runMode)', value: 'config' },
        { name: '8. Initial Setup / Sincronizar cuenta (Manual login / Cloudflare)', value: 'setup' },
        { name: '9. Exit', value: 'exit' },
      ],
    });

    switch (choice) {
      case 'start':
        await startSession();
        break;

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
            const type = m.type ? SERIES_TYPE_LABELS[m.type] : 'Auto';
            console.log(
              `  ${idx + 1}. ${chalk.bold(m.title)} ${chalk.magenta(`(${type})`)} [${chalk.green(m.status)}] - ${chalk.gray(m.url)}`
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
        console.log(chalk.cyan('\n[QUEUE] Reading series title from the page...'));
        const title =
          (await detectSeriesTitle(url)) ?? url.split('/').filter(Boolean).pop() ?? 'Manga';
        console.log(chalk.gray(`  Title: ${title}`));
        const type = await select<SeriesType | 'auto'>({
          message: 'Series type:',
          choices: [
            { name: 'Auto-detect on first visit (recommended)', value: 'auto' },
            { name: 'Manga (horizontal pages)', value: 'manga' },
            { name: 'Manhwa (vertical scroll)', value: 'manhwa' },
            { name: 'Novel (not supported yet)', value: 'novel' },
          ],
        });
        await queue.add(url, title, type === 'auto' ? undefined : type);
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
        const currentSpeed = config.readingSpeed || 'normal';
        const currentProfile = SPEED_PROFILES[currentSpeed] || SPEED_PROFILES.normal;

        const subChoice = await select({
          message: 'Select setting to configure:',
          choices: [
            {
              name: `Reading Speed [Current: ${currentProfile.icon} ${currentProfile.name} (${currentProfile.badge})]`,
              value: 'speed',
            },
            {
              name: `Reading Direction [Current: ${config.readingDirection || 'auto'}]`,
              value: 'direction',
            },
            {
              name: `Browser Mode [Current: ${config.runMode}]`,
              value: 'runMode',
            },
            { name: 'Back to main menu', value: 'back' },
          ],
        });

        if (subChoice === 'speed') {
          const newSpeed = await select<ReadingSpeed>({
            message: 'Select page reading speed preset:',
            choices: [
              {
                name: `${SPEED_PROFILES.fast.icon} ${SPEED_PROFILES.fast.name} (${SPEED_PROFILES.fast.badge}) - ${SPEED_PROFILES.fast.description}`,
                value: 'fast',
              },
              {
                name: `${SPEED_PROFILES.normal.icon} ${SPEED_PROFILES.normal.name} (${SPEED_PROFILES.normal.badge}) - ${SPEED_PROFILES.normal.description}`,
                value: 'normal',
              },
              {
                name: `${SPEED_PROFILES.slow.icon} ${SPEED_PROFILES.slow.name} (${SPEED_PROFILES.slow.badge}) - ${SPEED_PROFILES.slow.description}`,
                value: 'slow',
              },
              {
                name: `${SPEED_PROFILES.very_slow.icon} ${SPEED_PROFILES.very_slow.name} (${SPEED_PROFILES.very_slow.badge}) - ${SPEED_PROFILES.very_slow.description}`,
                value: 'very_slow',
              },
            ],
            default: currentSpeed,
          });

          config.readingSpeed = newSpeed;
          await ConfigLoader.save(config);
          console.log(
            chalk.green(
              `\n✓ Reading speed set to: ${SPEED_PROFILES[newSpeed].icon} ${SPEED_PROFILES[newSpeed].name} (${SPEED_PROFILES[newSpeed].badge})\n`
            )
          );
        } else if (subChoice === 'direction') {
          const newDirection = await select({
            message: 'Reading direction (how pages turn):',
            choices: [
              { name: 'Auto-detect (Adaptive RTL/LTR with self-calibration) [Recommended]', value: 'auto' },
              { name: 'Manga RTL (Right-to-Left: ArrowLeft = next, standard for Japanese manga)', value: 'rtl' },
              { name: 'Comic/Manhwa LTR (Left-to-Right: ArrowRight = next)', value: 'ltr' },
            ],
            default: config.readingDirection || 'auto',
          });

          config.readingDirection = newDirection as any;
          await ConfigLoader.save(config);
          console.log(chalk.green(`\n✓ Reading direction set to: ${newDirection}\n`));
        } else if (subChoice === 'runMode') {
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
          console.log(chalk.green('\n✓ Browser execution mode updated.\n'));
        }
        break;
      }

      case 'setup': {
        const browser = new BrowserManager();
        await browser.setup();
        config = await ConfigLoader.load();
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
    // Ctrl+C at a prompt throws ExitPromptError: treat it like choosing "Exit".
    if (err instanceof Error && err.name === 'ExitPromptError') {
      console.log(chalk.gray('\nGoodbye!\n'));
      process.exit(0);
    }
    logger.error({ err }, 'Error in interactive menu');
  });
} else {
  program.parse();
}
