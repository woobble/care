const localProjectNamePattern = /^care-platform-(?:dev|e2e(?:-[a-z0-9][a-z0-9-]*)?)$/;

export function resolveLocalComposeProject(environment = process.env) {
  const projectName = environment.COMPOSE_PROJECT_NAME ?? 'care-platform-dev';
  if (!localProjectNamePattern.test(projectName)) {
    throw new Error(
      'Local Compose commands require COMPOSE_PROJECT_NAME=care-platform-dev or an isolated care-platform-e2e name.',
    );
  }
  return projectName;
}
