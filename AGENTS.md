# AGENTS.md

Guía para agentes (Claude Code, Codex, etc.) que trabajan en este repositorio.

## Flujo de Git

### En el repositorio local: libertad total
- Puedes hacer todos los commits que quieras, y crear o borrar ramas.
- **Cada cambio importante va en una rama nueva** creada desde `main` actualizado (por ejemplo `feat/...`, `fix/...`, `test/...`). No hagas commits de cambios importantes directamente en `main`.
- Usa mensajes de commit en formato Conventional Commits (`feat(scope): ...`, `fix: ...`, `test: ...`), siguiendo el historial existente.

### Antes de hacer push: consultar siempre
- **Nunca hagas `git push` sin la aprobación explícita del usuario.**
- Antes de hacer push, avisa de que los cambios están listos e indica la rama, los commits y cómo probarlos. Luego espera a que el usuario los pruebe y apruebe el push.
- La aprobación vale para ese push concreto, no para los siguientes.

### Pull Requests y merges
- Todo cambio llega a `main` mediante un **Pull Request**; nunca con push directo a `main`.
- El PR debe estar bien documentado:
  - **Summary**: qué problema resuelve.
  - **What changed**: los cambios principales.
  - **Reviewer notes**: decisiones, riesgos y limitaciones.
  - **Testing**: qué se probó (typecheck, tests, prueba real) y qué no.
- Haz el merge solo cuando el usuario lo pida. Usa un **merge commit**, como en el historial (`<título del PR> (#N)`), con un cuerpo que resuma los cambios del PR.
- Después del merge, actualiza `main` en local.

## Comandos útiles

```bash
npm run dev      # CLI interactiva
npm test         # vitest
npx tsc --noEmit # typecheck
```
