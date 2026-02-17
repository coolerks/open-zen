const iconModules = import.meta.glob('../assets/icons/*.svg', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const iconMap = new Map<string, string>();
Object.entries(iconModules).forEach(([path, url]) => {
  const fileName = path.split('/').pop();
  if (!fileName) {
    return;
  }
  const key = fileName.replace(/\.svg$/i, '').toLowerCase();
  iconMap.set(key, url);
});

const FILE_ICON_ALIAS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'react',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'react',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
  sh: 'powershell',
  zsh: 'powershell',
  bash: 'powershell',
  lock: 'lock',
  txt: 'document',
};

const FILE_NAME_ICON_ALIAS: Record<string, string> = {
  'package.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'dockerfile': 'docker',
  'go.mod': 'go-mod',
  'go.sum': 'go',
  'readme.md': 'readme',
  'license': 'license',
  'makefile': 'makefile',
};

const FOLDER_ICON_ALIAS: Record<string, string> = {
  src: 'folder-src',
  test: 'folder-test',
  tests: 'folder-test',
  docs: 'folder-docs',
  doc: 'folder-docs',
  api: 'folder-api',
  component: 'folder-components',
  components: 'folder-components',
  config: 'folder-config',
  docker: 'folder-docker',
  public: 'folder-public',
  server: 'folder-server',
  client: 'folder-client',
  script: 'folder-scripts',
  scripts: 'folder-scripts',
  git: 'folder-git',
  github: 'folder-github',
};

function getIcon(iconName: string): string | null {
  return iconMap.get(iconName.toLowerCase()) ?? null;
}

export function resolveProjectFileIcon(fileName: string): string {
  const normalizedName = fileName.trim().toLowerCase();
  if (!normalizedName) {
    return getIcon('document') ?? '';
  }

  const byName = FILE_NAME_ICON_ALIAS[normalizedName];
  if (byName) {
    const icon = getIcon(byName);
    if (icon) {
      return icon;
    }
  }

  const extension = normalizedName.includes('.')
    ? normalizedName.split('.').pop()?.toLowerCase() ?? ''
    : '';
  const alias = extension ? FILE_ICON_ALIAS[extension] ?? extension : '';
  if (alias) {
    const icon = getIcon(alias);
    if (icon) {
      return icon;
    }
  }

  return getIcon('document') ?? '';
}

export function resolveProjectFolderIcon(folderName: string, open: boolean): string {
  const normalizedName = folderName.trim().toLowerCase();
  const alias = FOLDER_ICON_ALIAS[normalizedName] ?? 'folder-base';
  const openIcon = open ? getIcon(`${alias}-open`) : null;
  if (openIcon) {
    return openIcon;
  }
  return getIcon(alias) ?? getIcon('folder-base') ?? getIcon('document') ?? '';
}

export function resolveMonacoLanguageByFileName(fileName: string): string {
  const normalizedName = fileName.trim().toLowerCase();
  if (!normalizedName) {
    return 'plaintext';
  }

  const extension = normalizedName.includes('.')
    ? normalizedName.split('.').pop()?.toLowerCase() ?? ''
    : '';

  const languageByExtension: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    py: 'python',
    java: 'java',
    go: 'go',
    rs: 'rust',
    css: 'css',
    html: 'html',
    xml: 'xml',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'toml',
    sh: 'shell',
    bash: 'shell',
    sql: 'sql',
    c: 'c',
    cc: 'cpp',
    cxx: 'cpp',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    rb: 'ruby',
    vue: 'vue',
    svelte: 'svelte',
  };

  if (extension && languageByExtension[extension]) {
    return languageByExtension[extension];
  }

  if (normalizedName === 'dockerfile') {
    return 'dockerfile';
  }
  if (normalizedName === 'makefile') {
    return 'makefile';
  }

  return 'plaintext';
}
