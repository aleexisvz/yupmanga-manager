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
  .description('YupManga Manager — Simulador autónomo de lectura y navegación para yupmanga.com')
  .version('1.0.0');

program
  .command('setup')
  .description('Abre Google Chrome en modo visible para resolver Cloudflare e iniciar sesión manualmente')
  .action(async () => {
    const browser = new BrowserManager();
    await browser.setup();
    process.exit(0);
  });

program
  .command('start')
  .description('Inicia la sesión de lectura autónoma directamente en segundo plano')
  .action(async () => {
    await startSession();
  });

async function startSession() {
  const config = await ConfigLoader.load();
  const queue = new MangaQueue();
  const tracker = new ProgressTracker();

  const entries = await queue.list();
  if (entries.length === 0) {
    console.log(chalk.yellow('\n⚠️ No tienes mangas en la cola de lectura.'));
    console.log(chalk.cyan('👉 Agrega uno ejecutando la CLI interactiva (npm run dev) o usando la opción 3.\n'));
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

async function showInteractiveMenu() {
  const queue = new MangaQueue();
  const tracker = new ProgressTracker();
  let config = await ConfigLoader.load();

  console.clear();
  console.log(
    chalk.magentaBright(`
  ================================================
     📖  YUPMANGA MANAGER — Lector Autónomo
  ================================================
  `)
  );

  while (true) {
    const choice = await select({
      message: '¿Qué deseas hacer?',
      choices: [
        { name: '🚀 Iniciar sesión de lectura', value: 'start' },
        { name: '📋 Ver cola de mangas', value: 'list_queue' },
        { name: '➕ Agregar manga a la cola', value: 'add_manga' },
        { name: '🗑️  Eliminar manga de la cola', value: 'remove_manga' },
        { name: '📊 Ver estadísticas y progreso', value: 'stats' },
        { name: '⚙️  Configurar modo y tiempos', value: 'config' },
        { name: '🔑 Setup inicial (Login manual y Cloudflare)', value: 'setup' },
        { name: '🚪 Salir', value: 'exit' },
      ],
    });

    switch (choice) {
      case 'start':
        await startSession();
        return;

      case 'list_queue': {
        const entries = await queue.list();
        console.log(chalk.cyan('\n📋 Mangas en la cola de lectura:'));
        if (entries.length === 0) {
          console.log(chalk.gray('  (La cola está vacía)\n'));
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
          message: 'Introduce la URL de la serie/manga en yupmanga.com:',
          validate: (val) => (val.includes('yupmanga.com') ? true : 'Debe ser una URL de yupmanga.com'),
        });
        const title = await input({
          message: 'Nombre o título del manga:',
          default: url.split('/').filter(Boolean).pop() || 'Manga',
        });
        await queue.add(url, title);
        console.log(chalk.green(`\n✅ "${title}" agregado a la cola con éxito.\n`));
        break;
      }

      case 'remove_manga': {
        const entries = await queue.list();
        if (entries.length === 0) {
          console.log(chalk.yellow('\nNo hay mangas para eliminar.\n'));
          break;
        }
        const toRemove = await select({
          message: 'Selecciona el manga a eliminar:',
          choices: entries.map((m) => ({ name: m.title, value: m.url })),
        });
        await queue.remove(toRemove);
        console.log(chalk.green('\n✅ Manga eliminado de la cola.\n'));
        break;
      }

      case 'stats': {
        const records = await tracker.getAll();
        console.log(chalk.cyan('\n📊 Historial y estadísticas acumuladas:'));
        if (records.length === 0) {
          console.log(chalk.gray('  (Aún no hay estadísticas registradas)\n'));
        } else {
          records.forEach((r) => {
            console.log(`  📖 ${chalk.bold(r.title)}:`);
            console.log(`     - Páginas totales leídas: ${r.totalPagesReadAccumulated}`);
            console.log(`     - Volúmenes completados: ${r.totalVolumesCompleted}`);
            console.log(`     - Sesiones realizadas: ${r.sessionsCount}`);
            console.log(`     - Última lectura: ${new Date(r.lastReadTimestamp).toLocaleString()}\n`);
          });
        }
        break;
      }

      case 'config': {
        const newRunMode = await select({
          message: 'Modo de ejecución del navegador:',
          choices: [
            { name: '👻 Headless (Invisible en segundo plano)', value: 'headless' },
            { name: '🖥️  Off-screen (Headed real con GPU fuera de pantalla)', value: 'offscreen' },
            { name: '👀 Headed (Ventana visible)', value: 'headed' },
          ],
          default: config.runMode,
        });

        const newInterval = await input({
          message: 'Tiempo base entre páginas (milisegundos):',
          default: String(config.intervalMs),
          validate: (v) => (!isNaN(Number(v)) && Number(v) >= 1000 ? true : 'Debe ser >= 1000ms'),
        });

        config.runMode = newRunMode as any;
        config.intervalMs = Number(newInterval);
        await ConfigLoader.save(config);
        console.log(chalk.green('\n✅ Configuración guardada correctamente.\n'));
        break;
      }

      case 'setup': {
        const browser = new BrowserManager();
        await browser.setup();
        break;
      }

      case 'exit':
        console.log(chalk.gray('\n¡Hasta pronto! 👋\n'));
        process.exit(0);
    }
  }
}

// Si no se pasaron argumentos por terminal, mostrar el menú interactivo
if (process.argv.length <= 2) {
  showInteractiveMenu().catch((err) => {
    logger.error({ err }, 'Error en el menú interactivo');
  });
} else {
  program.parse();
}
