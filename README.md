# ⚡ YupManga Manager

Aplicación autónoma inteligente para simulación de lectura y navegación realista en **yupmanga.com**, construida con **Node.js, TypeScript y Playwright**.

## 🚀 Características Principales

- 🧠 **Comportamiento Humano Simulado**:
  - `ActionScheduler`: Alterna automáticamente entre lectura de páginas, exploración de catálogo, visitas al perfil y descansos con tiempos orgánicos no-redondos.
  - `HumanInput`: Curvas de movimiento de mouse, scrolls suaves con velocidad variable y pausas naturales.
- 🛡️ **Tolerancia y Protección Anti-Detección**:
  - Soporte de sesión persistente vía Chrome real (`channel: 'chrome'`).
  - Evasión de huellas headless (`--disable-blink-features=AutomationControlled`, eliminación de `navigator.webdriver`).
  - Modo Headless con fallback automático o modo *"Off-screen"* (visible pero fuera del monitor).
- 📖 **Automatización Completa de Lector y Galería**:
  - Detección y espera automática del countdown publicitario pre-reader (*"Espera 6 segundos..."*).
  - Lectura de páginas (`page.keyboard.press('ArrowRight')`) con ritmo humanizado.
  - Detección de última página del tomo y cierre automático.
  - Navegación entre volúmenes y paginación de galería.
- 📋 **Cola de Mangas y Persistencia**:
  - Cola de lectura priorizada (`~/.yupmanga/queue.json`).
  - Al añadir un manga solo se pide la URL: el título se lee automáticamente de la página de la serie (si no se puede leer, se usa el slug de la URL), y después se elige el tipo (auto, manga, manhwa).
  - Seguimiento de progreso por manga (`~/.yupmanga/progress.json`).
- 💻 **CLI Interactiva**: Menús claros con `@inquirer/prompts` para gestionar mangas, configurar y ejecutar.

## 🛠️ Instalación y Requisitos

1. Node.js >= 20
2. Google Chrome instalado en el sistema

```bash
npm install
npx playwright install chromium
```

## 🎮 Comandos

```bash
# Setup inicial (login manual en ventana visible)
npm run dev -- setup

# Iniciar CLI interactiva
npm run dev
```
