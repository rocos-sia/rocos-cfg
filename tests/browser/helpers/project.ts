import type { Page } from '@playwright/test';

/** Fail on stale/duplicated Vite store modules instead of comparing empty snapshots. */
export const projectSnapshot = (page: Page) => page.evaluate(async () => {
  const path = '/src/store.ts'; const { useProject } = await import(path);
  const state = useProject.getState(), project = state.project, shell = document.querySelector('.shell');
  if (!shell || project === undefined || shell.getAttribute('data-project-id') !== (project?.id ?? null)
    || shell.getAttribute('data-project-revision') !== (project ? String(project.revision) : null)
    || shell.getAttribute('data-workspace-epoch') !== String(state.workspaceEpoch)) {
    throw new Error('Project snapshot does not match the rendered workspace');
  }
  return JSON.stringify(project);
});
